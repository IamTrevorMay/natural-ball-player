// Issue #277 — "Practice / Game / Lifting RSVP addition".
//
// Shared RSVP plumbing + UI, kept in its own file so Schedule.js / MyTeam.js /
// PlayerDashboard.js each need only a small, surgical hook-up.
//
// ---------------------------------------------------------------------------
// WHERE THE EVENTS LIVE
// ---------------------------------------------------------------------------
// Team practices and games are rows in `schedule_events` (event_type
// 'practice' | 'game', team_id + team_ids, player_id NULL — the AddEventPanel
// "Team Event" branch). Team lifting sessions and any other team-tagged
// facility booking are rows in `facility_events` whose team_ids names the team
// (the #287 path that already renders them on the Team calendar and on a
// player's My Schedule). Both are supported here; `event_source` on the RSVP
// row says which table `event_id` points at.
//
// Per-athlete programming rows (schedule_events with player_id set — team
// programming writes one row per athlete) are deliberately NOT RSVP-able:
// they are individual assignments, not a shared event with a headcount.
//
// ---------------------------------------------------------------------------
// OCCURRENCE IDENTITY — the part that is easy to get wrong
// ---------------------------------------------------------------------------
// These events repeat, and each repeat needs its own RSVP. We use exactly the
// same occurrence identity the rest of the app already uses for per-occurrence
// data (see `event_signups` in Schedule.js FacilityEventDetail, lines with
// eventMasterId / occurrenceDate):
//
//     event_id   = ev._master_id || ev.id
//     event_date = ev.event_date
//
// Why that is right:
//   * A virtual occurrence produced by scheduleUtils.expandRecurringEvents has
//     a synthetic id (`${master.id}_${index}`) that is NOT a uuid, but carries
//     `_master_id` — so we key off the master's real uuid plus the occurrence's
//     own date.
//   * A standalone (non-recurring) event has no `_master_id`, so event_id is
//     its own uuid.
//   * schedule_events never goes through virtual expansion at all: every
//     occurrence of a repeating team event is already a real row with its own
//     uuid and its own event_date, so event_id is always that row's id.
//   * A facility_events exception row (a modified occurrence) is a real row and
//     keys off its own id + date — same as event_signups does. Consistency with
//     the existing sign-up feature matters more here than theoretical purity;
//     both features must agree on what "this occurrence" means.
//
// Only FUTURE occurrences (event_date >= today) can be answered.
//
// ---------------------------------------------------------------------------
// DEGRADING GRACEFULLY
// ---------------------------------------------------------------------------
// supabase/migrations/20260815_event_rsvps.sql IS applied — the event_rsvps
// table exists in production (0 rows as of 2026-08-16, nobody has answered yet,
// which is why every headcount currently reads "0 going / N no response"). The
// missing-table guard below is kept deliberately: it still covers a fresh/local
// database that has not run the migration, so every query here checks for the
// PostgREST error and shows RSVP_NOT_SET_UP_MESSAGE instead of looking broken.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { fetchUserDirectory } from './userDirectory';
import { Check, X, HelpCircle, Users, Bell, AlertTriangle, Calendar as CalendarIcon } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { expandRecurringEvents } from './scheduleUtils';

export const RSVP_MIGRATION_FILE = 'supabase/migrations/20260815_event_rsvps.sql';
export const RSVP_NOT_SET_UP_MESSAGE = `RSVP is not set up yet — apply ${RSVP_MIGRATION_FILE}`;

const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayStr = () => fmtLocalDate(new Date());

// PostgREST/Postgres "that table isn't there". 42P01 is undefined_table (raw
// PG); PGRST205 / PGRST106 are PostgREST's schema-cache misses. The message
// test is the belt-and-braces fallback for older PostgREST builds that only
// set a message.
export function isRsvpNotSetUp(err) {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST106') return true;
  const msg = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`;
  return /event_rsvps/i.test(msg) && /(does not exist|could not find|schema cache|unknown)/i.test(msg);
}

export const RSVP_CHOICES = [
  { value: 'going', label: 'Going', Icon: Check, on: 'bg-emerald-600 border-emerald-600 text-white', off: 'bg-white border-gray-300 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300' },
  { value: 'not_going', label: 'Not going', Icon: X, on: 'bg-rose-600 border-rose-600 text-white', off: 'bg-white border-gray-300 text-gray-700 hover:bg-rose-50 hover:border-rose-300' },
  { value: 'maybe', label: 'Maybe', Icon: HelpCircle, on: 'bg-amber-500 border-amber-500 text-white', off: 'bg-white border-gray-300 text-gray-700 hover:bg-amber-50 hover:border-amber-300' },
];

export const RSVP_LABELS = { going: 'Going', not_going: 'Not going', maybe: 'Maybe' };

// schedule_events types that are a shared team event worth an RSVP. 'meal' is
// excluded (it is a nutrition plan entry, not an attendance event). 'workout'
// is included for the day a coach schedules team lifting as a team-wide row.
export const RSVP_EVENT_TYPES = ['practice', 'game', 'workout'];

export function eventSourceOf(ev, explicit) {
  if (explicit) return explicit;
  return ev && ev._is_facility ? 'facility_events' : 'schedule_events';
}

export function teamIdsOf(ev) {
  const arr = Array.isArray(ev?.team_ids) ? ev.team_ids.filter(Boolean) : [];
  if (arr.length > 0) return arr;
  return ev?.team_id ? [ev.team_id] : [];
}

// See the OCCURRENCE IDENTITY block at the top of this file.
export function rsvpOccurrence(ev, explicitSource) {
  return {
    event_id: ev._master_id || ev.id,
    event_date: ev.event_date,
    event_source: eventSourceOf(ev, explicitSource),
  };
}

export const occurrenceKey = (o) => `${o.event_source}|${o.event_id}|${o.event_date}`;

export function isUpcomingOccurrence(occ) {
  return !!occ?.event_date && occ.event_date >= todayStr();
}

export function isRsvpableEvent(ev, explicitSource) {
  if (!ev || !ev.event_date) return false;
  const source = eventSourceOf(ev, explicitSource);
  if (teamIdsOf(ev).length === 0) return false;
  if (source === 'schedule_events') {
    if (ev.player_id) return false; // per-athlete assignment, not a shared event
    if (!RSVP_EVENT_TYPES.includes(ev.event_type)) return false;
  }
  return true;
}

export function eventTitleOf(ev) {
  return ev?.title || ev?.opponent || ev?.event_type || 'Team event';
}

export function eventTimeOf(ev) {
  return (ev?._is_facility || ev?.start_time) ? ev?.start_time : ev?.event_time;
}

export function fmtEventDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtEventTime(t) {
  if (!t) return 'TBD';
  const [h, m] = String(t).split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return 'TBD';
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

// ---------------------------------------------------------------------------
// DATA
// ---------------------------------------------------------------------------

// Upcoming RSVP-able events for the given teams, from BOTH tables, with
// facility recurrences expanded exactly the way the Team calendar expands them.
export async function fetchUpcomingTeamEvents(teamIds, { days = 60, limit = 40 } = {}) {
  const ids = (teamIds || []).filter(Boolean);
  if (ids.length === 0) return { events: [], error: null };

  const start = todayStr();
  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + days);
  const end = fmtLocalDate(rangeEnd);

  const [teamRes, directRes, masterRes] = await Promise.all([
    // Union team_ids with the legacy scalar team_id (mirrors MyTeam /
    // PlayerDashboard), and drop per-athlete rows.
    supabase.from('schedule_events').select('*')
      .or(`team_id.in.(${ids.join(',')}),team_ids.ov.{${ids.join(',')}}`)
      .is('player_id', null)
      .gte('event_date', start).lte('event_date', end),
    supabase.from('facility_events').select('*')
      .overlaps('team_ids', ids)
      .eq('is_recurring', false).eq('is_exception', false)
      .gte('event_date', start).lte('event_date', end),
    supabase.from('facility_events').select('*')
      .overlaps('team_ids', ids)
      .eq('is_recurring', true).is('recurrence_parent_id', null),
  ]);
  if (teamRes.error) console.error('fetchUpcomingTeamEvents: schedule_events query failed:', teamRes.error);
  if (directRes.error) console.error('fetchUpcomingTeamEvents: facility_events (direct) query failed:', directRes.error);
  if (masterRes.error) console.error('fetchUpcomingTeamEvents: facility_events (masters) query failed:', masterRes.error);

  const masters = masterRes.data || [];
  let expanded = [];
  if (masters.length > 0) {
    // Exceptions are fetched by parent (not by team) so a cancelled or moved
    // occurrence of an assigned series still applies when the child row's own
    // team_ids is empty — same reasoning as MyTeam/#287.
    const { data: exceptions, error: exErr } = await supabase.from('facility_events').select('*')
      .in('recurrence_parent_id', masters.map(m => m.id))
      .gte('event_date', start);
    if (exErr) console.error('fetchUpcomingTeamEvents: facility_events (exceptions) query failed:', exErr);
    // A modified occurrence is returned as the raw child row, whose own
    // team_ids is usually empty — inherit the series' teams so it isn't
    // silently dropped by isRsvpableEvent below.
    const teamsByMaster = new Map(masters.map(m => [String(m.id), m.team_ids || []]));
    expanded = expandRecurringEvents(masters, exceptions || [], rangeStart, rangeEnd)
      .filter(ev => ev.event_date >= start && ev.event_date <= end)
      .map(ev => (teamIdsOf(ev).length > 0
        ? ev
        : { ...ev, team_ids: teamsByMaster.get(String(ev.recurrence_parent_id)) || [] }));
  }

  const facilityRows = new Map();
  [...(directRes.data || []), ...expanded].forEach(ev => {
    // Facility masters carry their team_ids; expanded virtual rows inherit it.
    facilityRows.set(String(ev.id) + '|' + ev.event_date, { ...ev, _is_facility: true });
  });

  const merged = [...(teamRes.data || []), ...facilityRows.values()]
    .filter(ev => isRsvpableEvent(ev))
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))
      || String(eventTimeOf(a) || '').localeCompare(String(eventTimeOf(b) || '')))
    .slice(0, limit);

  const firstError = teamRes.error || directRes.error || masterRes.error || null;
  return { events: merged, error: firstError };
}

// Everyone's answers for a set of occurrences. Returns notSetUp=true (rather
// than an error) when the migration has not been applied yet.
export async function fetchRsvpRows(occurrences) {
  const list = occurrences || [];
  if (list.length === 0) return { rows: [], notSetUp: false, error: null };
  const ids = [...new Set(list.map(o => o.event_id))];
  const dates = [...new Set(list.map(o => o.event_date))];
  const { data, error } = await supabase
    .from('event_rsvps')
    .select('id, event_id, event_source, event_date, user_id, response, note, responded_at')
    .in('event_id', ids)
    .in('event_date', dates);
  if (error) {
    if (isRsvpNotSetUp(error)) return { rows: [], notSetUp: true, error: null };
    console.error('fetchRsvpRows: event_rsvps query failed:', error);
    return { rows: [], notSetUp: false, error };
  }
  // The .in()/.in() pair is a superset (every id crossed with every date), so
  // narrow to the exact occurrences we asked about.
  const wanted = new Set(list.map(occurrenceKey));
  return { rows: (data || []).filter(r => wanted.has(occurrenceKey(r))), notSetUp: false, error: null };
}

export async function saveMyRsvp(occurrence, userId, response, note = null) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('event_rsvps').upsert({
    event_id: occurrence.event_id,
    event_source: occurrence.event_source,
    event_date: occurrence.event_date,
    user_id: userId,
    response,
    note: note || null,
    responded_at: now,
    updated_at: now,
  }, { onConflict: 'event_id,event_date,user_id' });
  return error || null;
}

// Team roster (athletes only — staff on the team are not counted as
// non-responders). `team_members` is readable by any authenticated user;
// names come from `user_directory` rather than an embed on `users`, because a
// blocked embed returns row.users = null on every row and the RSVP board then
// shows a confident "0 going / 1 no response" — the athlete's own row — with
// no error to say the rest of the team went missing.
export async function fetchTeamPlayers(teamIds) {
  const ids = (teamIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, team_id')
    .in('team_id', ids);
  if (error) { console.error('fetchTeamPlayers: team_members query failed:', error); return []; }
  const directory = await fetchUserDirectory((data || []).map(r => r.user_id));
  const byId = new Map();
  (data || []).forEach(row => {
    const u = directory.get(row.user_id);
    if (!u || u.role === 'admin' || u.role === 'coach') return;
    byId.set(u.id, u);
  });
  return [...byId.values()].sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
}

export function tallyRsvps(players, rowsForOccurrence) {
  const byUser = new Map((rowsForOccurrence || []).map(r => [r.user_id, r]));
  const buckets = { going: [], not_going: [], maybe: [], no_response: [] };
  (players || []).forEach(p => {
    const r = byUser.get(p.id);
    if (r && buckets[r.response]) buckets[r.response].push({ ...p, _rsvp: r });
    else buckets.no_response.push(p);
  });
  return buckets;
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Map recipient -> the 1:1 direct conversation they already have with the
// sender, so a nudge lands in the existing thread instead of adding a new one
// to the athlete's Messages list every time. Same lookup AthleteOutreach.js
// sendInAppMessages does.
async function findDirectThreads(senderId, recipientIds) {
  const map = new Map();
  try {
    const { data: myParts, error: mpErr } = await supabase
      .from('conversation_participants').select('conversation_id').eq('user_id', senderId);
    if (mpErr) throw mpErr;
    const myConvIds = [...new Set((myParts || []).map(p => p.conversation_id).filter(Boolean))];
    const directIds = [];
    for (const ids of chunk(myConvIds, 150)) {
      const { data, error } = await supabase.from('conversations').select('id').eq('type', 'direct').in('id', ids);
      if (error) throw error;
      directIds.push(...(data || []).map(c => c.id));
    }
    const byConv = {};
    for (const ids of chunk(directIds, 150)) {
      const { data, error } = await supabase
        .from('conversation_participants').select('conversation_id, user_id').in('conversation_id', ids);
      if (error) throw error;
      (data || []).forEach(p => { (byConv[p.conversation_id] = byConv[p.conversation_id] || []).push(p.user_id); });
    }
    const wanted = new Set(recipientIds);
    Object.entries(byConv).forEach(([convId, uids]) => {
      const uniq = [...new Set(uids)];
      if (uniq.length === 2 && uniq.includes(senderId)) {
        const other = uniq.find(u => u !== senderId);
        if (other && wanted.has(other) && !map.has(other)) map.set(other, convId);
      }
    });
  } catch (e) {
    // A failed lookup only costs us thread reuse — fall through and create new
    // conversations rather than refusing to send.
    console.error('nudgeNonResponders: existing-conversation lookup failed:', e);
  }
  return map;
}

// The nudge. Reuses the Main Portal's in-app messaging path verbatim — the same
// three inserts NewMessageModal in Messages.js performs for a 'direct' message
// (conversations -> conversation_participants -> messages). That is what
// useNotifications.useMainPortalCounts counts and what NotificationBell shows,
// so the nudge lands in the bell and in Messages with no new transport.
//
// PRIVACY: one two-person thread per athlete, never one shared thread. Most of
// these athletes are minors — a single thread would show every non-responder
// the names of all the others and broadcast any reply to the whole list.
// Same send path as AthleteOutreach.js sendInAppMessages.
//
// Returns how many messages actually went out, so the screen can say the true
// number instead of assuming everything worked.
//
// HUMAN-TRIGGERED ONLY. Nothing here is scheduled or automatic; it runs when a
// coach clicks the button.
export async function nudgeNonResponders({ senderId, recipientIds, eventLabel }) {
  const recipients = [...new Set((recipientIds || []).filter(Boolean))].filter(id => id !== senderId);
  if (recipients.length === 0) return { sent: 0, failed: 0, error: null };

  const content = `RSVP reminder: we still need your answer for ${eventLabel}. `
    + `Open My Team → RSVP and pick Going, Not going or Maybe so your coach has an accurate headcount.`;

  const threadByUser = await findDirectThreads(senderId, recipients);
  let firstError = null;

  // One conversation per athlete who doesn't already have one. The rows are
  // identical and carry no recipient identity — the participants insert below
  // is what pairs each thread with its athlete.
  const needThread = recipients.filter(id => !threadByUser.has(id));
  for (const batch of chunk(needThread, 100)) {
    const { data, error } = await supabase
      .from('conversations')
      .insert(batch.map(() => ({ type: 'direct', created_by: senderId, is_pinned: false, replies_disabled: false })))
      .select('id');
    if (error || !data || data.length !== batch.length) {
      firstError = firstError || error || 'Could not open a conversation.';
      continue;
    }
    const participants = [];
    batch.forEach((id, idx) => {
      threadByUser.set(id, data[idx].id);
      participants.push({ conversation_id: data[idx].id, user_id: senderId });
      participants.push({ conversation_id: data[idx].id, user_id: id });
    });
    const { error: partError } = await supabase.from('conversation_participants').insert(participants);
    if (partError) {
      // QA: the conversations created just above now have nobody in them. Nobody
      // can open them, and every press of the button used to leave another set
      // behind. Remove the ones this pass created. Best-effort on purpose: a
      // failed cleanup is logged, never allowed to hide the real error.
      const orphanIds = data.map(row => row.id);
      batch.forEach(id => threadByUser.delete(id));
      firstError = firstError || partError;
      const { error: cleanupError } = await supabase.from('conversations').delete().in('id', orphanIds);
      if (cleanupError) console.error('nudgeNonResponders: could not clean up empty conversations:', cleanupError);
    }
  }

  // One message row per athlete, each in that athlete's own thread.
  let sent = 0;
  const deliverable = recipients.filter(id => threadByUser.has(id));
  for (const batch of chunk(deliverable, 100)) {
    const { error } = await supabase.from('messages').insert(
      batch.map(id => ({ conversation_id: threadByUser.get(id), sender_id: senderId, content }))
    );
    if (error) { firstError = firstError || error; continue; }
    sent += batch.length;
  }

  return { sent, failed: recipients.length - sent, error: firstError };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export function RsvpNotSetUpNotice({ className = '' }) {
  return (
    <div className={`flex items-start space-x-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800 ${className}`}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
      <span>{RSVP_NOT_SET_UP_MESSAGE}</span>
    </div>
  );
}

// Going / Not going / Maybe. Controlled — `value` is null when the player has
// not responded, which is the default and stays the default until they click.
export function RsvpButtons({ value, onSelect, disabled, saving, compact }) {
  return (
    <div className="flex flex-wrap gap-2">
      {RSVP_CHOICES.map(choice => {
        const active = value === choice.value;
        const Icon = choice.Icon;
        return (
          <button
            key={choice.value}
            type="button"
            onClick={() => onSelect(choice.value)}
            disabled={disabled || saving}
            className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${active ? choice.on : choice.off}`}
          >
            <Icon size={compact ? 13 : 15} />
            <span>{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// #277 — the four headcount buckets in the order Cordell reads them, so the
// summary row and the drill-down modal cannot drift apart. `noun` is the tail
// of the count text ("4 going"); `aria` is the tail of the button label.
const RSVP_BUCKETS = [
  { key: 'going', Icon: Check, tone: 'font-semibold text-emerald-700', titleTone: 'text-emerald-700', noun: 'going', aria: 'going' },
  { key: 'maybe', Icon: HelpCircle, tone: 'text-amber-700', titleTone: 'text-amber-700', noun: 'maybe', aria: 'answering maybe' },
  { key: 'not_going', Icon: X, tone: 'text-rose-700', titleTone: 'text-rose-700', noun: 'not going', aria: 'not going' },
  { key: 'no_response', Icon: Users, tone: 'text-gray-500', titleTone: 'text-gray-500', noun: 'no response', aria: 'with no response' },
];

// Titles for the drill-down. Reuses RSVP_LABELS for the three real responses so
// "Not going" is spelled the one way everywhere; no_response is not a stored
// response value, so it only exists here.
const RSVP_BUCKET_TITLES = { ...RSVP_LABELS, no_response: 'No response' };

// #277 — Cordell: "Admin and coaches need to have the ability to click on all of
// these to see who exactly is in each of these 4 categories." When `clickable`,
// each count becomes a button that opens RsvpBucketModal; the markup, colours
// and spacing are otherwise byte-for-byte what players have always seen.
export function RsvpHeadcount({ buckets, className = '', clickable = false, onSelect }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className}`}>
      {RSVP_BUCKETS.map(({ key, Icon, tone, noun, aria }) => {
        const n = buckets[key].length;
        const body = <><Icon size={13} />{n} {noun}</>;
        return clickable ? (
          <button
            key={key}
            type="button"
            onClick={() => onSelect?.(key)}
            aria-label={`Show the ${n} ${n === 1 ? 'person' : 'people'} ${aria}`}
            className={`inline-flex items-center gap-1 rounded transition hover:underline hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${tone}`}
          >
            {body}
          </button>
        ) : (
          <span key={key} className={`inline-flex items-center gap-1 ${tone}`}>{body}</span>
        );
      })}
    </div>
  );
}

// A stored RSVP's timestamp, shown next to the name in the drill-down so a coach
// can tell a fresh answer from a stale one. Bad/absent values render as nothing.
function fmtRespondedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// #277 — the drill-down: exactly who is in one bucket. Presentation only; every
// person object already came back with tallyRsvps (full user row + `_rsvp`), so
// there is no new query here. Standard app overlay (see Schedule.js AddEventPanel).
export function RsvpBucketModal({ bucketKey, buckets, onClose }) {
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  if (!bucketKey) return null;
  const people = buckets[bucketKey] || [];
  const meta = RSVP_BUCKETS.find(b => b.key === bucketKey);
  const title = RSVP_BUCKET_TITLES[bucketKey] || 'RSVP';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      {/* Stop the backdrop handler from firing for clicks inside the card. */}
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-200 p-4 flex items-center justify-between flex-shrink-0">
          <h3 className={`text-lg font-bold ${meta ? meta.titleTone : 'text-gray-900'}`}>{title} ({people.length})</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {people.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Nobody yet.</p>
          ) : (
            <ul className="space-y-2">
              {people.map(p => {
                // no_response people have no _rsvp row at all — names only.
                const when = fmtRespondedAt(p._rsvp?.responded_at);
                return (
                  <li key={p.id} className="text-sm text-gray-900">
                    <div className="font-medium truncate">{p.full_name || 'Unknown'}</div>
                    {p._rsvp?.note && <div className="text-xs text-gray-600 mt-0.5">{p._rsvp.note}</div>}
                    {when && <div className="text-xs text-gray-400 mt-0.5">Answered {when}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RosterColumn({ title, tone, people }) {
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${tone}`}>{title} ({people.length})</div>
      {people.length === 0 ? (
        <p className="text-xs text-gray-400 italic">None</p>
      ) : (
        // A full roster can be 130+ names, and with no RSVPs recorded they all
        // land in "No response" — uncapped that is thousands of pixels of one
        // column. Scroll inside the column; the headcount above opens the
        // full drill-down.
        <ul className="space-y-0.5 max-h-40 overflow-y-auto">
          {people.map(p => (
            <li key={p.id} className="text-xs text-gray-700 truncate">{p.full_name || 'Unknown'}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Coach / admin roster panel for one occurrence: who is Going / Not going /
// Maybe / No response, the headcount, and the human-clicked nudge.
export function RsvpRosterPanel({ buckets, eventLabel, userId, className = '', clickable = false }) {
  const [nudging, setNudging] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState('');
  // #277 — which bucket the staff member clicked in the headcount, or null.
  const [openBucket, setOpenBucket] = useState(null);
  const nonResponders = buckets.no_response;

  const handleNudge = async () => {
    if (nonResponders.length === 0) return;
    if (!window.confirm(`Send a private in-app RSVP reminder to each of the ${nonResponders.length} player${nonResponders.length === 1 ? '' : 's'} who haven't responded?`)) return;
    setNudging(true);
    setNudgeMsg('');
    const { sent, failed, error } = await nudgeNonResponders({
      senderId: userId,
      recipientIds: nonResponders.map(p => p.id),
      eventLabel,
    });
    setNudging(false);
    // Each player gets their own private message, and some can fail while
    // others go through — say the number that actually sent, not the number
    // we tried.
    if (sent === 0) { setNudgeMsg('Could not send: ' + formatUserError(error)); return; }
    setNudgeMsg(
      `Private reminder sent to ${sent} player${sent === 1 ? '' : 's'}. They'll see it in their bell and in Messages.`
      + (failed > 0 ? ` ${failed} could not be sent — please try again for those.` : '')
    );
  };

  return (
    <div className={className}>
      <RsvpHeadcount buckets={buckets} className="mb-3" clickable={clickable} onSelect={setOpenBucket} />
      {clickable && <RsvpBucketModal bucketKey={openBucket} buckets={buckets} onClose={() => setOpenBucket(null)} />}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RosterColumn title="Going" tone="text-emerald-700" people={buckets.going} />
        <RosterColumn title="Maybe" tone="text-amber-700" people={buckets.maybe} />
        <RosterColumn title="Not going" tone="text-rose-700" people={buckets.not_going} />
        <RosterColumn title="No response" tone="text-gray-500" people={buckets.no_response} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleNudge}
          disabled={nudging || nonResponders.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Bell size={15} />
          <span>{nudging ? 'Sending…' : `Nudge non-responders${nonResponders.length > 0 ? ` (${nonResponders.length})` : ''}`}</span>
        </button>
        {nudgeMsg && <span className="text-xs text-gray-600">{nudgeMsg}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-occurrence section, dropped into the event detail modals.
// ---------------------------------------------------------------------------
export function EventRsvpSection({ event, source, userId, userRole, className = '' }) {
  const occurrence = useMemo(() => rsvpOccurrence(event, source), [event, source]);
  const src = occurrence.event_source;
  const isStaff = userRole === 'admin' || userRole === 'coach';
  const upcoming = isUpcomingOccurrence(occurrence);

  // Synchronous shape check: is this the KIND of row that can carry an RSVP?
  // schedule_events must be a shared team event (no player_id) of an
  // attendance type; facility_events are fine as long as a team is attached.
  const shapeOk = src === 'facility_events'
    ? true
    : (!event.player_id && RSVP_EVENT_TYPES.includes(event.event_type));
  // A facility exception row (a modified/cancelled occurrence) often has an
  // empty team_ids of its own and inherits the series' teams — the only case
  // where we can't tell from the row in hand and have to ask the parent.
  const mightHaveTeam = teamIdsOf(event).length > 0
    || (src === 'facility_events' && !!event.recurrence_parent_id);
  const active = shapeOk && mightHaveTeam;

  const [teamIds, setTeamIds] = useState(() => teamIdsOf(event));
  const [players, setPlayers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    if (!active) { setLoading(false); return; }
    setLoading(true);
    let ids = teamIdsOf(event);
    if (ids.length === 0 && src === 'facility_events' && event.recurrence_parent_id) {
      const { data, error } = await supabase.from('facility_events')
        .select('team_ids').eq('id', event.recurrence_parent_id).maybeSingle();
      if (error) console.error('EventRsvpSection: parent facility_events lookup failed:', error);
      ids = ((data && data.team_ids) || []).filter(Boolean);
    }
    setTeamIds(ids);
    if (ids.length === 0) { setPlayers([]); setRows([]); setLoading(false); return; }
    const [roster, rsvps] = await Promise.all([
      fetchTeamPlayers(ids),
      fetchRsvpRows([occurrence]),
    ]);
    setPlayers(roster);
    setRows(rsvps.rows);
    setNotSetUp(rsvps.notSetUp);
    setLoading(false);
  }, [active, event, src, occurrence]);

  useEffect(() => { load(); }, [load]);

  const buckets = useMemo(() => tallyRsvps(players, rows), [players, rows]);
  const myRow = rows.find(r => r.user_id === userId) || null;
  const iAmOnRoster = players.some(p => p.id === userId);

  const handleSelect = async (response) => {
    setSaving(true);
    setSaveError('');
    const error = await saveMyRsvp(occurrence, userId, response, myRow?.note || null);
    setSaving(false);
    if (error) {
      if (isRsvpNotSetUp(error)) { setNotSetUp(true); return; }
      setSaveError(formatUserError(error));
      return;
    }
    await load();
  };

  // No team on this event → not a team practice / game / lifting session, so
  // nothing to RSVP to. (Keeps ordinary lane bookings and lessons untouched.)
  if (!active) return null;
  if (!loading && teamIds.length === 0) return null;

  const label = `${eventTitleOf(event)} on ${fmtEventDate(occurrence.event_date)}`;

  return (
    <div className={`pt-4 border-t border-gray-200 ${className}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">RSVP</h4>
      {notSetUp ? (
        <RsvpNotSetUpNotice />
      ) : loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          {!upcoming && (
            <p className="text-xs text-gray-500">This event has already happened — RSVPs are closed.</p>
          )}
          {iAmOnRoster && (
            <div>
              <p className="text-sm text-gray-700 mb-2">
                {myRow ? <>Your answer: <span className="font-semibold text-gray-900">{RSVP_LABELS[myRow.response]}</span></> : 'You have not responded yet.'}
              </p>
              <RsvpButtons value={myRow?.response || null} onSelect={handleSelect} disabled={!upcoming} saving={saving} />
              {saveError && <p className="text-xs text-red-600 mt-1">{saveError}</p>}
            </div>
          )}
          {players.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No players on this team yet, so there is no headcount to show.</p>
          ) : isStaff ? (
            // #277 — staff can click any of the four counts to see the names.
            <RsvpRosterPanel buckets={buckets} eventLabel={label} userId={userId} clickable />
          ) : (
            // Players keep the plain, non-clickable counts.
            <RsvpHeadcount buckets={buckets} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-event board: answer several upcoming events in one place ("any / all"
// from the issue). Used as MyTeam's RSVP tab and as the player's "My RSVPs".
// ---------------------------------------------------------------------------
function RsvpEventRow({ event, myRow, buckets, isStaff, canAnswer, userId, onSaved }) {
  const occurrence = rsvpOccurrence(event);
  const upcoming = isUpcomingOccurrence(occurrence);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showRoster, setShowRoster] = useState(false);
  // #277 — bucket drilled into from this row's headcount (staff only), or null.
  const [openBucket, setOpenBucket] = useState(null);
  const label = `${eventTitleOf(event)} on ${fmtEventDate(occurrence.event_date)}`;

  const handleSelect = async (response) => {
    setSaving(true);
    setError('');
    const err = await saveMyRsvp(occurrence, userId, response, myRow?.note || null);
    setSaving(false);
    if (err) {
      // QA 2026-08-15: if the table disappears mid-session, reload so the board
      // collapses to the notice instead of leaving live buttons behind — the
      // same thing EventRsvpSection does with its own notSetUp state.
      if (isRsvpNotSetUp(err)) { setError(RSVP_NOT_SET_UP_MESSAGE); onSaved?.(); return; }
      setError(formatUserError(err));
      return;
    }
    onSaved?.();
  };

  return (
    <li className="border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {event._is_facility ? 'Team session' : event.event_type}
            </span>
            {!upcoming && <span className="text-xs text-gray-400">(past)</span>}
          </div>
          <p className="text-sm font-semibold text-gray-900 truncate">{eventTitleOf(event)}</p>
          <p className="text-xs text-gray-600">
            {fmtEventDate(occurrence.event_date)} · {fmtEventTime(eventTimeOf(event))}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        {canAnswer && (
          <div className="text-right">
            <RsvpButtons value={myRow?.response || null} onSelect={handleSelect} disabled={!upcoming} saving={saving} compact />
            <p className="text-xs text-gray-500 mt-1">
              {myRow ? `Your answer: ${RSVP_LABELS[myRow.response]}` : 'No response yet'}
            </p>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <div className="mt-3">
        {/* #277 — same drill-down on the board rows as on the event detail, so a
            coach never has to find the "Show roster" toggle to get the names. */}
        <RsvpHeadcount buckets={buckets} clickable={isStaff} onSelect={setOpenBucket} />
        {isStaff && <RsvpBucketModal bucketKey={openBucket} buckets={buckets} onClose={() => setOpenBucket(null)} />}
      </div>
      {isStaff && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowRoster(v => !v)}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            {showRoster ? 'Hide roster' : 'Show roster & nudge'}
          </button>
          {showRoster && (
            <RsvpRosterPanel className="mt-3" buckets={buckets} eventLabel={label} userId={userId} clickable />
          )}
        </div>
      )}
    </li>
  );
}

// `teamIds` — the teams to pull events for. Pass a single team (MyTeam's RSVP
// tab) or every team the player is on (the "My RSVPs" list).
export function RsvpBoard({ teamIds, userId, userRole, days = 60, emptyHint }) {
  const isStaff = userRole === 'admin' || userRole === 'coach';
  const [events, setEvents] = useState([]);
  const [rows, setRows] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);

  const key = (teamIds || []).filter(Boolean).slice().sort().join(',');

  const load = useCallback(async () => {
    setLoading(true);
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setEvents([]); setRows([]); setPlayers([]); setLoading(false); return; }
    const [{ events: evs }, roster] = await Promise.all([
      fetchUpcomingTeamEvents(ids, { days }),
      fetchTeamPlayers(ids),
    ]);
    const { rows: rsvpRows, notSetUp: missing } = await fetchRsvpRows(evs.map(e => rsvpOccurrence(e)));
    setEvents(evs);
    setPlayers(roster);
    setRows(rsvpRows);
    setNotSetUp(missing);
    setLoading(false);
  }, [key, days]);

  useEffect(() => { load(); }, [load]);

  const rowsByOccurrence = useMemo(() => {
    const map = new Map();
    rows.forEach(r => {
      const k = occurrenceKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return map;
  }, [rows]);

  const canAnswer = userRole === 'player' && players.some(p => p.id === userId);

  if (loading) return <p className="text-sm text-gray-600">Loading RSVPs…</p>;

  // QA 2026-08-15: this used to render the notice AND the whole live board
  // underneath it — clicking Going/Not going/Maybe fired a real POST at the
  // missing event_rsvps table, the headcount read "0 going / N no response" as
  // if that were data, and a coach got an enabled "Nudge non-responders (N)"
  // button for RSVPs the system cannot store. Show the notice INSTEAD of the
  // board, exactly as EventRsvpSection already does above.
  if (notSetUp) {
    return (
      <div className="space-y-4">
        <RsvpNotSetUpNotice />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.length === 0 ? (
        <div className="text-center py-10">
          <CalendarIcon size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-900 font-medium">No upcoming events to RSVP to</p>
          <p className="text-sm text-gray-600 mt-1">
            {emptyHint || `Practices, games and team lifting sessions appear here as soon as a coach schedules them on the team calendar (looking ${days} days ahead).`}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map(ev => {
            const occ = rsvpOccurrence(ev);
            const k = occurrenceKey(occ);
            const forOcc = rowsByOccurrence.get(k) || [];
            return (
              <RsvpEventRow
                key={k}
                event={ev}
                myRow={forOcc.find(r => r.user_id === userId) || null}
                buckets={tallyRsvps(players, forOcc)}
                isStaff={isStaff}
                canAnswer={canAnswer}
                userId={userId}
                onSaved={load}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Player dashboard card: "My RSVPs" across every team the player is on.
export function MyRsvpsCard({ userId, userRole = 'player', days = 30 }) {
  const [teamIds, setTeamIds] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('team_members').select('team_id').eq('user_id', userId);
      if (error) console.error('MyRsvpsCard: team_members query failed:', error);
      if (!cancelled) setTeamIds((data || []).map(r => r.team_id).filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Check size={20} className="text-indigo-600" />
        <h2 className="text-lg font-bold text-gray-900">My RSVPs</h2>
      </div>
      {teamIds === null ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : teamIds.length === 0 ? (
        <p className="text-sm text-gray-600">You are not on a team yet, so there is nothing to RSVP to.</p>
      ) : (
        <RsvpBoard
          teamIds={teamIds}
          userId={userId}
          userRole={userRole}
          days={days}
          emptyHint="Nothing scheduled in the next 30 days. Practices, games and team lifting sessions show up here the moment a coach puts them on your team's calendar."
        />
      )}
    </div>
  );
}
