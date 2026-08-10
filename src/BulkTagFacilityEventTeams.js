import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { Users, CheckSquare, Square, AlertTriangle, CheckCircle2, XCircle, ShieldOff } from 'lucide-react';
import { formatUserError } from './errorMessage';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Postgres undefined_column. Thrown when is_non_team_activity hasn't been
// added yet — see supabase/migrations/20260810_facility_events_non_team_activity.sql.
function isMissingColumnError(err) {
  return !!err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''));
}

// #308 (#287 follow-up): bulk-assign teams to facility_events instead of
// opening each one individually. 27 of 110 facility events have a team;
// the other 83 need review. Deliberately built as its own component, not
// shared with BulkTagSessions.js (the training-slot version) — same
// row-selection SHAPE (filters, checkboxes, select-all-shown, running
// count, confirm-before-apply, per-row success/failure), different table
// and a genuinely different attribute (team_ids is a multi-value array
// with a "deliberately no team" sentinel; that tool's product reference
// is a single value with a different ownership rule). See BulkTagSessions.js
// for the sibling tool this one is modeled on.
export default function BulkTagFacilityEventTeams() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [events, setEvents] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [teams, setTeams] = useState([]);

  const [coachFilter, setCoachFilter] = useState('');
  const [publicFilter, setPublicFilter] = useState('all'); // all | public | private
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState(new Set());
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);

  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null); // { action, succeeded, failed: [{id, title, message}] }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setMigrationMissing(false);
    try {
      const [{ data: eventRows, error: evErr }, { data: coachRows, error: coachErr }, { data: teamRows, error: teamErr }] = await Promise.all([
        supabase
          .from('facility_events')
          // Masters + standalone events only (recurrence_parent_id IS NULL) —
          // per-occurrence exception children (#279/#292-style rows) inherit
          // the series' team assignment; FacilityEventDetail's own "apply to
          // all" already propagates team_ids to children when staff assign
          // one at a time, so this tool doesn't need to touch them separately.
          //
          // facility_events has NO legacy singular team_id column — team_ids
          // (uuid[]) is the only team attribute this table has ever had.
          // (schedule_events has both team_id and team_ids; do not confuse
          // the two tables' shapes.)
          .select('id, title, event_date, start_time, end_time, location, is_public, coach_id, coach_ids, team_ids, is_non_team_activity')
          .is('recurrence_parent_id', null)
          .order('event_date', { ascending: false })
          .limit(2000),
        supabase.from('users').select('id, full_name').eq('role', 'coach'),
        supabase.from('teams').select('id, name').order('name'),
      ]);
      if (evErr) {
        if (isMissingColumnError(evErr)) {
          setMigrationMissing(true);
          setEvents([]);
          return;
        }
        throw evErr;
      }
      if (coachErr) throw coachErr;
      if (teamErr) throw teamErr;
      setEvents(eventRows || []);
      setCoaches(coachRows || []);
      setTeams(teamRows || []);
    } catch (e) {
      setError(formatUserError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const teamNameById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t.name])), [teams]);

  // "Needs review" = no team assigned AND not deliberately marked team-less.
  // team_ids is a uuid[]; PostgREST's not-null check passes an empty array
  // (CoachTools.js hits the same trap for schedule_events), so emptiness has
  // to be checked here in JS rather than filtered in the query.
  const needsReview = useMemo(
    () => events.filter(e => !(Array.isArray(e.team_ids) && e.team_ids.length > 0) && !e.is_non_team_activity),
    [events]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return needsReview.filter(e => {
      if (coachFilter && e.coach_id !== coachFilter && !(Array.isArray(e.coach_ids) && e.coach_ids.includes(coachFilter))) return false;
      if (publicFilter === 'public' && !e.is_public) return false;
      if (publicFilter === 'private' && e.is_public) return false;
      if (q) {
        const hay = `${e.title || ''} ${e.location || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [needsReview, coachFilter, publicFilter, search]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allShownSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));
  const selectAllShown = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allShownSelected) {
        filtered.forEach(e => next.delete(e.id));
      } else {
        filtered.forEach(e => next.add(e.id));
      }
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setSelectedTeamIds([]);
  };

  const toggleTeam = (id) => {
    setSelectedTeamIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const runApply = async (action, patch) => {
    setApplying(true);
    setApplyResult(null);
    const ids = [...selected];
    let succeeded = 0;
    const failed = [];
    for (const id of ids) {
      const { error: updErr } = await supabase.from('facility_events').update(patch).eq('id', id);
      if (updErr) {
        const ev = events.find(e => e.id === id);
        failed.push({ id, title: ev?.title || 'Untitled event', message: updErr.message });
      } else {
        succeeded++;
      }
    }
    setApplying(false);
    setApplyResult({ action, succeeded, failed });
    clearSelection();
    await load();
  };

  const assignTeams = async () => {
    if (selected.size === 0 || selectedTeamIds.length === 0) return;
    const teamNames = selectedTeamIds.map(id => teamNameById[id]).filter(Boolean);
    const ok = window.confirm(
      `Assign ${teamNames.join(', ')} to ${selected.size} event${selected.size === 1 ? '' : 's'}?`
    );
    if (!ok) return;
    await runApply('assign', { team_ids: selectedTeamIds });
  };

  const markNonTeamActivity = async () => {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Mark ${selected.size} event${selected.size === 1 ? '' : 's'} as "Non team activity"?\n\n` +
      `They'll drop off this review list — use this for events that genuinely have no team, not as a way to skip tagging them.`
    );
    if (!ok) return;
    await runApply('non-team', { is_non_team_activity: true });
  };

  if (migrationMissing) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">This tool isn't set up in the database yet.</p>
          <p className="mt-1">
            It needs a column that hasn't been added: <code className="bg-amber-100 px-1 rounded">facility_events.is_non_team_activity</code>.
            Run the migration in <code className="bg-amber-100 px-1 rounded">supabase/migrations/20260810_facility_events_non_team_activity.sql</code>, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
        <Users size={18} className="text-indigo-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-indigo-800">
          Events listed here have no team assigned and aren't marked as non-team activity. Select the ones that need
          a team, assign it to all of them at once — or mark a batch "Non team activity" if they genuinely have none.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
      )}

      {applyResult && (
        <div className={`border rounded-lg px-4 py-3 text-sm space-y-1 ${applyResult.failed.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center gap-2 font-medium text-gray-800">
            {applyResult.failed.length ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-green-600" />}
            <span>
              {applyResult.succeeded} event{applyResult.succeeded === 1 ? '' : 's'}{' '}
              {applyResult.action === 'non-team' ? 'marked Non team activity.' : 'assigned successfully.'}
            </span>
          </div>
          {applyResult.failed.length > 0 && (
            <div className="pl-6 space-y-1">
              <div className="text-amber-700 font-medium">{applyResult.failed.length} failed:</div>
              <ul className="space-y-0.5">
                {applyResult.failed.map(f => (
                  <li key={f.id} className="flex items-start gap-1.5 text-amber-700">
                    <XCircle size={12} className="flex-shrink-0 mt-0.5" />
                    <span><span className="font-medium">{f.title}</span> — {f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Coach</label>
          <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">All coaches</option>
            {coaches.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Visibility</label>
          <select value={publicFilter} onChange={(e) => setPublicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="all">Public + Private</option>
            <option value="public">Public only</option>
            <option value="private">Private only</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Search title / location</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Cage Rental"
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div className="text-sm text-gray-500 pb-1.5">
          {loading ? 'Loading…' : `${filtered.length} event${filtered.length === 1 ? '' : 's'} need review`}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={selectAllShown} disabled={loading || filtered.length === 0} className="flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:text-indigo-800 disabled:opacity-50">
          {allShownSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          <span>{allShownSelected ? 'Unselect all shown' : 'Select all shown'}</span>
        </button>
        <div className="text-sm text-gray-600">
          {selected.size} selected
          {selected.size > 0 && (
            <button onClick={clearSelection} className="ml-2 text-gray-400 hover:text-gray-600 underline">clear</button>
          )}
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg max-h-[420px] overflow-y-auto divide-y divide-gray-100">
        {loading ? (
          <p className="text-sm text-gray-500 text-center py-8">Loading events…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">Nothing matches these filters.</p>
        ) : filtered.map(e => (
          <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} className="w-4 h-4 text-indigo-600 border-gray-300 rounded flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{e.title || 'Untitled event'}</div>
              <div className="text-xs text-gray-500">
                {fmtDate(e.event_date)} {fmtTime(e.start_time)}
                {e.location ? ` · ${e.location}` : ''}
              </div>
            </div>
            <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border ${e.is_public ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
              {e.is_public ? 'Public' : 'Private'}
            </span>
          </label>
        ))}
      </div>

      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700">Act on the selected events</h4>
          {selected.size === 0 && <span className="text-xs text-gray-400">Select events above first</span>}
        </div>

        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">Assign team(s)</div>
          {teams.length === 0 ? (
            <p className="text-xs text-gray-400">No teams found.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {teams.map(t => (
                <label key={t.id} className="flex items-center space-x-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={selectedTeamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} disabled={selected.size === 0} className="w-4 h-4 text-indigo-600 border-gray-300 rounded" />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
          )}
          <button
            onClick={assignTeams}
            disabled={applying || selected.size === 0 || selectedTeamIds.length === 0}
            className="mt-2 w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {applying ? 'Applying…' : `Assign to ${selected.size} event${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>

        <div className="border-t border-gray-100 pt-3">
          <button
            onClick={markNonTeamActivity}
            disabled={applying || selected.size === 0}
            className="w-full flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-50 transition disabled:opacity-50"
          >
            <ShieldOff size={14} />
            {applying ? 'Applying…' : `Mark ${selected.size} event${selected.size === 1 ? '' : 's'} as Non team activity`}
          </button>
        </div>
      </div>
    </div>
  );
}
