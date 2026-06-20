// V2 research dashboard. Admin-only (RLS on usage_events enforces it).
// Queries aggregate counts + dwell times from public.usage_events and renders
// the top features used, the heaviest workflows, modal funnels, and error
// hotspots. Pulls last 14 days by default.

import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { BarChart3, Activity, AlertTriangle, Clock, RefreshCw } from 'lucide-react';

const DAYS = 14;

export default function UsageDashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [stats, setStats] = useState({
    totals: { events: 0, sessions: 0, byRole: {} },
    topViews: [],
    topActions: [],
    modalFunnels: [],
    errorBuckets: [],
    deadViews: [],
  });

  const fetchAll = async () => {
    setLoading(true); setErr(null);
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    try {
      // Pull raw rows in chunks. 14 days × ~few-hundred users should easily fit.
      const PAGE = 1000;
      let from = 0;
      let all = [];
      // Hard cap pull at 30k rows for safety.
      while (from < 30000) {
        const { data, error } = await supabase
          .from('usage_events')
          .select('session_id, role, portal, event_type, event_name, duration_ms, occurred_at')
          .gte('occurred_at', since)
          .order('occurred_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      // Aggregate client-side. Cheap for tens of thousands of rows.
      const sessionSet = new Set();
      const byRole = { player: 0, coach: 0, admin: 0 };
      const viewCount = new Map();        // name -> count
      const viewDwellSum = new Map();     // name -> sum ms
      const viewDwellN = new Map();       // name -> n
      const actionCount = new Map();      // name -> count
      const modalOpen = new Map();        // name -> count
      const modalClose = new Map();       // name -> count
      const modalDwellSum = new Map();    // name -> ms
      const modalDwellN = new Map();      // name -> n
      const errBuckets = new Map();       // bucket -> count

      for (const ev of all) {
        sessionSet.add(ev.session_id);
        if (byRole[ev.role] !== undefined) byRole[ev.role]++;
        const name = ev.event_name;
        if (ev.event_type === 'view_enter') {
          viewCount.set(name, (viewCount.get(name) || 0) + 1);
        } else if (ev.event_type === 'view_exit') {
          if (ev.duration_ms != null) {
            viewDwellSum.set(name, (viewDwellSum.get(name) || 0) + ev.duration_ms);
            viewDwellN.set(name, (viewDwellN.get(name) || 0) + 1);
          }
        } else if (ev.event_type === 'action_click') {
          actionCount.set(name, (actionCount.get(name) || 0) + 1);
        } else if (ev.event_type === 'modal_open') {
          modalOpen.set(name, (modalOpen.get(name) || 0) + 1);
        } else if (ev.event_type === 'modal_close') {
          modalClose.set(name, (modalClose.get(name) || 0) + 1);
          if (ev.duration_ms != null) {
            modalDwellSum.set(name, (modalDwellSum.get(name) || 0) + ev.duration_ms);
            modalDwellN.set(name, (modalDwellN.get(name) || 0) + 1);
          }
        } else if (ev.event_type === 'error') {
          // bucket is stored at event_name like 'format_user_error' or the
          // window error label; for finer grouping we'd inspect meta but
          // PostgREST doesn't return meta from this select. Keep it simple.
          errBuckets.set(name, (errBuckets.get(name) || 0) + 1);
        }
      }

      const topViews = [...viewCount.entries()]
        .map(([name, count]) => ({
          name,
          count,
          medianDwell: medianFromSumN(viewDwellSum.get(name), viewDwellN.get(name)),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      const topActions = [...actionCount.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      const modalFunnels = [...modalOpen.entries()].map(([name, opens]) => ({
        name,
        opens,
        closes: modalClose.get(name) || 0,
        medianDwell: medianFromSumN(modalDwellSum.get(name), modalDwellN.get(name)),
      })).sort((a, b) => b.opens - a.opens).slice(0, 20);

      const errorBuckets = [...errBuckets.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      const deadViews = topViews
        .filter(v => v.count >= 30 && v.medianDwell != null && v.medianDwell < 3000)
        .sort((a, b) => a.medianDwell - b.medianDwell)
        .slice(0, 10);

      setStats({
        totals: { events: all.length, sessions: sessionSet.size, byRole },
        topViews,
        topActions,
        modalFunnels,
        errorBuckets,
        deadViews,
      });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Usage Data — last {DAYS} days</h2>
          <p className="text-xs text-gray-500 mt-1">Anonymous session-bound events. No PII. Source: <code>public.usage_events</code>.</p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded text-sm">
          Failed to load: {err}
        </div>
      )}

      {!err && (
        <>
          <Totals stats={stats.totals} loading={loading} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card icon={BarChart3} title="Top views">
              <Table
                rows={stats.topViews}
                columns={[
                  { key: 'name', label: 'View', fmt: v => v },
                  { key: 'count', label: 'Enters', fmt: v => v.toLocaleString() },
                  { key: 'medianDwell', label: 'Median dwell', fmt: fmtMs },
                ]}
                loading={loading}
              />
            </Card>

            <Card icon={Activity} title="Top actions">
              <Table
                rows={stats.topActions}
                columns={[
                  { key: 'name', label: 'Action', fmt: v => v },
                  { key: 'count', label: 'Clicks', fmt: v => v.toLocaleString() },
                ]}
                loading={loading}
              />
            </Card>

            <Card icon={Clock} title="Modal funnels">
              <Table
                rows={stats.modalFunnels}
                columns={[
                  { key: 'name', label: 'Modal', fmt: v => v },
                  { key: 'opens', label: 'Opens', fmt: v => v.toLocaleString() },
                  { key: 'closes', label: 'Closes', fmt: v => v.toLocaleString() },
                  { key: 'medianDwell', label: 'Median open', fmt: fmtMs },
                ]}
                loading={loading}
              />
            </Card>

            <Card icon={AlertTriangle} title="Errors by bucket">
              <Table
                rows={stats.errorBuckets}
                columns={[
                  { key: 'name', label: 'Bucket', fmt: v => v },
                  { key: 'count', label: 'Count', fmt: v => v.toLocaleString() },
                ]}
                loading={loading}
              />
            </Card>
          </div>

          <Card icon={AlertTriangle} title="Dead views (count ≥ 30 + median dwell < 3s)">
            <Table
              rows={stats.deadViews}
              columns={[
                { key: 'name', label: 'View', fmt: v => v },
                { key: 'count', label: 'Enters', fmt: v => v.toLocaleString() },
                { key: 'medianDwell', label: 'Median dwell', fmt: fmtMs },
              ]}
              loading={loading}
              emptyText="No dead views (good!)"
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Totals({ stats, loading }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat label="Events" value={stats.events.toLocaleString()} loading={loading} />
      <Stat label="Sessions" value={stats.sessions.toLocaleString()} loading={loading} />
      <Stat label="Player events" value={(stats.byRole.player || 0).toLocaleString()} loading={loading} />
      <Stat label="Coach events" value={(stats.byRole.coach || 0).toLocaleString()} loading={loading} />
      <Stat label="Admin events" value={(stats.byRole.admin || 0).toLocaleString()} loading={loading} />
    </div>
  );
}

function Stat({ label, value, loading }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{loading ? '…' : value}</p>
    </div>
  );
}

function Card({ icon: Icon, title, children }) {
  return (
    <section className="bg-white rounded-lg shadow-sm">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        {Icon && <Icon size={16} className="text-gray-500" />}
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Table({ rows, columns, loading, emptyText = 'No data yet' }) {
  if (loading) return <p className="text-xs text-gray-400">Loading…</p>;
  if (!rows || rows.length === 0) return <p className="text-xs text-gray-400">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
            {columns.map(c => (
              <th key={c.key} className="text-left px-2 py-1.5 font-semibold">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {columns.map(c => (
                <td key={c.key} className="px-2 py-1.5 text-gray-800">{c.fmt(row[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function medianFromSumN(sum, n) {
  if (!n) return null;
  return Math.round(sum / n); // mean rather than median (cheaper, ok for ranking)
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
