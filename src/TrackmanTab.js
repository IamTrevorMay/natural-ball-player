// Trackman stats tab (#44). Shows the viewed athlete's Trackman sessions — as a
// pitcher and/or a batter — with per-session summaries and pitch-by-pitch
// detail. RLS returns only rows where this athlete is the pitcher or batter
// (staff see everyone's via their own role), so this component just renders
// whatever comes back.

import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ChevronDown, ChevronRight, Activity, Target } from 'lucide-react';

const n1 = (v) => (v == null || v === '' ? '—' : Number(v).toFixed(1));
const n0 = (v) => (v == null || v === '' ? '—' : Math.round(Number(v)).toString());
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const max = (arr) => (arr.length ? Math.max(...arr) : null);
const nums = (rows, key) => rows.map((r) => r[key]).filter((v) => v != null && v !== '').map(Number);

const dateLabel = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date';

export default function TrackmanTab({ userId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all | pitching | hitting
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      const { data, error } = await supabase
        .from('trackman_pitches')
        .select('id, session_row_id, thrown_date, pitch_no, pitcher_user_id, batter_user_id, pitcher_throws, batter_side, tagged_pitch_type, pitch_call, rel_speed, spin_rate, tilt, induced_vert_break, horz_break, extension, rel_height, rel_side, exit_speed, launch_angle, distance, hit_type, session:trackman_sessions(session_date, session_type)')
        .or(`pitcher_user_id.eq.${userId},batter_user_id.eq.${userId}`)
        .order('thrown_date', { ascending: false })
        .order('pitch_no', { ascending: true });
      if (cancelled) return;
      if (error) setError(error.message);
      setRows(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Group rows into sessions, tagging the athlete's role in each.
  const sessions = (() => {
    const byId = new Map();
    for (const r of rows) {
      const isPitcher = r.pitcher_user_id === userId;
      const isBatter = r.batter_user_id === userId;
      if (!byId.has(r.session_row_id)) {
        byId.set(r.session_row_id, {
          id: r.session_row_id,
          date: r.session?.session_date || r.thrown_date,
          type: r.session?.session_type || '',
          pitcherRows: [], batterRows: [],
        });
      }
      const s = byId.get(r.session_row_id);
      if (isPitcher) s.pitcherRows.push(r);
      if (isBatter && r.exit_speed != null && r.exit_speed !== '') s.batterRows.push(r);
      else if (isBatter) s.batterRows.push(r);
    }
    return [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  })();

  const hasPitching = sessions.some((s) => s.pitcherRows.length);
  const hasHitting = sessions.some((s) => s.batterRows.length);

  const visible = sessions.filter((s) =>
    filter === 'all' ? true : filter === 'pitching' ? s.pitcherRows.length : s.batterRows.length
  );

  // Personal bests across everything.
  const allPitch = rows.filter((r) => r.pitcher_user_id === userId);
  const allHit = rows.filter((r) => r.batter_user_id === userId);
  const bestVelo = max(nums(allPitch, 'rel_speed'));
  const bestExit = max(nums(allHit, 'exit_speed'));

  if (loading) return <p className="text-sm text-gray-500 py-6">Loading Trackman data…</p>;
  if (error) return <p className="text-sm text-red-600 py-6">Error loading Trackman data: {error}</p>;
  if (!sessions.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Activity size={40} className="mx-auto mb-3 text-gray-300" />
        <p className="font-medium text-gray-700">No Trackman sessions yet</p>
        <p className="text-sm">Sessions appear here once this athlete's name is mapped in Admin → Trackman.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Personal bests */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {bestVelo != null && <BestTile label="Top Velocity" value={`${n1(bestVelo)} mph`} icon={<Activity size={16} />} tone="blue" />}
        {bestExit != null && <BestTile label="Top Exit Velo" value={`${n1(bestExit)} mph`} icon={<Target size={16} />} tone="orange" />}
        <BestTile label="Sessions" value={sessions.length} tone="gray" />
      </div>

      {/* Pitching / Hitting filter (only if both exist) */}
      {hasPitching && hasHitting && (
        <div className="flex space-x-2">
          {[{ k: 'all', l: 'All' }, { k: 'pitching', l: 'Pitching' }, { k: 'hitting', l: 'Hitting' }].map((t) => (
            <button key={t.k} onClick={() => setFilter(t.k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${filter === t.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t.l}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {visible.map((s) => (
          <SessionCard key={s.id} session={s} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} />
        ))}
      </div>
    </div>
  );
}

function BestTile({ label, value, icon, tone }) {
  const tones = { blue: 'bg-blue-50 text-blue-700', orange: 'bg-orange-50 text-orange-700', gray: 'bg-gray-50 text-gray-700' };
  return (
    <div className={`rounded-lg p-3 ${tones[tone] || tones.gray}`}>
      <div className="flex items-center space-x-1.5 text-xs font-medium opacity-80">{icon}<span>{label}</span></div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function SessionCard({ session, open, onToggle }) {
  const isPitch = session.pitcherRows.length > 0;
  const isHit = session.batterRows.length > 0;
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition text-left">
        <div className="flex items-center space-x-3 min-w-0">
          {open ? <ChevronDown size={18} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />}
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 truncate">{dateLabel(session.date)}</div>
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {session.type && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{session.type}</span>}
              {isPitch && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{session.pitcherRows.length} pitches</span>}
              {isHit && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">{session.batterRows.length} swings</span>}
            </div>
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3 space-y-4 bg-gray-50/50">
          {isPitch && <PitchingDetail rows={session.pitcherRows} />}
          {isHit && <HittingDetail rows={session.batterRows} />}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-sm font-bold text-gray-900">{value}</div>
    </div>
  );
}

function PitchingDetail({ rows }) {
  // Summary by pitch type.
  const byType = {};
  for (const r of rows) {
    const t = r.tagged_pitch_type || 'Untagged';
    (byType[t] = byType[t] || []).push(r);
  }
  const velos = nums(rows, 'rel_speed');
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Pitches" value={rows.length} />
        <Stat label="Avg Velo" value={`${n1(avg(velos))} mph`} />
        <Stat label="Max Velo" value={`${n1(max(velos))} mph`} />
        <Stat label="Avg Spin" value={`${n0(avg(nums(rows, 'spin_rate')))} rpm`} />
      </div>
      <div className="mb-3 space-y-1">
        {Object.entries(byType).sort((a, b) => b[1].length - a[1].length).map(([type, tr]) => {
          const v = nums(tr, 'rel_speed');
          return (
            <div key={type} className="flex items-center justify-between text-xs bg-white rounded border border-gray-200 px-2.5 py-1.5">
              <span className="font-medium text-gray-800">{type} <span className="text-gray-400">×{tr.length}</span></span>
              <span className="text-gray-600">avg {n1(avg(v))} / max {n1(max(v))} mph · IVB {n1(avg(nums(tr, 'induced_vert_break')))}" · HB {n1(avg(nums(tr, 'horz_break')))}"</span>
            </div>
          );
        })}
      </div>
      <DetailTable
        cols={['#', 'Type', 'Velo', 'Spin', 'IVB', 'HB', 'Tilt', 'Ext', 'Result']}
        rows={rows.map((r) => [r.pitch_no ?? '', r.tagged_pitch_type || '—', n1(r.rel_speed), n0(r.spin_rate), n1(r.induced_vert_break), n1(r.horz_break), r.tilt || '—', n1(r.extension), r.pitch_call || '—'])}
      />
    </div>
  );
}

function HittingDetail({ rows }) {
  const hits = rows.filter((r) => r.exit_speed != null && r.exit_speed !== '');
  const ev = nums(hits, 'exit_speed');
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Swings" value={rows.length} />
        <Stat label="Avg Exit Velo" value={`${n1(avg(ev))} mph`} />
        <Stat label="Max Exit Velo" value={`${n1(max(ev))} mph`} />
        <Stat label="Max Distance" value={`${n0(max(nums(hits, 'distance')))} ft`} />
      </div>
      <DetailTable
        cols={['#', 'Exit Velo', 'Launch°', 'Dist', 'Type']}
        rows={rows.map((r) => [r.pitch_no ?? '', n1(r.exit_speed), n1(r.launch_angle), n0(r.distance), r.hit_type || '—'])}
      />
    </div>
  );
}

function DetailTable({ cols, rows }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600">
          <tr>{cols.map((c) => <th key={c} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {r.map((cell, j) => <td key={j} className="px-2 py-1 whitespace-nowrap text-gray-800">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
