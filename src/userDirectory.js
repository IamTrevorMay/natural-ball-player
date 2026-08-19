// Looking people up by name, without being able to read the users table.
//
// See "49 - USERS PRIVACY" in the project notes for the whole story. The short
// version: `public.users` is readable by every signed-in person — 989 rows,
// 398 of them minors, with email, phone, date of birth and parent contacts.
// Stage 3 of that job closes it to "your own row, or staff". Two views cover
// what the app legitimately still needs:
//
//   user_directory   id, full_name, avatar_url, role                 — everyone
//   staff_directory  + title, email, phone, skills, show_on_...      — staff only
//
// ---------------------------------------------------------------------------
// WHY EMBEDS WERE REMOVED RATHER THAN REPOINTED
// ---------------------------------------------------------------------------
// The dangerous shape is the embedded join: `users:sender_id(full_name)`.
// When PostgREST is not allowed to follow an embed it does NOT return an
// error — it returns the outer row with `users: null`. The screen then renders
// "Unknown", or a headcount of 1, or an empty roster, and nothing anywhere
// says anything went wrong. That silent failure is exactly what makes this
// change risky, so every embed onto `users` was replaced with an explicit call
// to one of the two functions below, which check `error` and log loudly.
//
// It also removes a dependency on an unproven behaviour: whether PostgREST can
// embed through a view at all. These lookups work either way.
//
// Cost: one extra round trip per screen, on an `id IN (...)` primary-key
// lookup. Measured against the alternative — a live site that lies about who
// sent a message — that is a good trade.

import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// DEPLOY ORDER SAFETY NET
// ---------------------------------------------------------------------------
// The two views are created by a separate SQL step (Stage 1) that a human has
// to paste in. If this code ships FIRST, every one of these reads 404s — and
// the measured result is a facility-wide booking outage: "No coaches cover
// All", no coach selectable, no session bookable. With no branch protection on
// main that ordering is not something to leave to memory.
//
// So: if the view is missing, fall back to `users` once and say so loudly.
// Before Stage 1 `users` is still wide open, so the fallback works and the app
// behaves exactly as it does today. After Stage 3 the view exists and the
// fallback can never fire. It is dead code the moment the job is finished.
function isMissingRelation(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '') + ' ' + String(error.details || '');
  return code === '42P01' || code === 'PGRST205' ||
    /does not exist|schema cache|could not find the table/i.test(msg);
}

// `run` is called with a table name and must return the PostgREST builder for
// that table, so each call site keeps its own filters, ordering and
// .single()/.maybeSingle() shape.
export async function readDirectory(view, run) {
  const first = await run(view);
  if (!first.error) return first;
  if (isMissingRelation(first.error)) {
    console.warn(
      `[userDirectory] "${view}" does not exist — falling back to the users table. ` +
      'The Stage 1 privacy SQL has not been applied to this database yet.'
    );
    return await run('users');
  }
  console.error(`[userDirectory] ${view} query failed:`, first.error);
  return first;
}

// id -> { id, full_name, avatar_url, role } for any signed-in user.
// Never returns email, phone or date of birth. Use this for display names.
export async function fetchUserDirectory(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await readDirectory('user_directory', (t) => supabase
    .from(t)
    .select('id, full_name, avatar_url, role')
    .in('id', unique));
  if (error) {
    // Loud on purpose. If this ever fires in production it means either the
    // Stage 1 views were never created, or they were dropped.
    console.error('user_directory lookup failed:', error);
    return new Map();
  }
  return new Map((data || []).map(u => [u.id, u]));
}

// id -> staff row, including work email and phone. Coaches and admins are
// public-facing at the facility and athletes are legitimately shown a coach's
// work contact details (MyTeam CoachCard). Athletes are not in this view, so
// this can never return a teammate.
export async function fetchStaffDirectory(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await readDirectory('staff_directory', (t) => supabase
    .from(t)
    .select('id, full_name, avatar_url, role, title, email, phone, skills, show_on_facility_schedule')
    .in('id', unique));
  if (error) {
    console.error('staff_directory lookup failed:', error);
    return new Map();
  }
  return new Map((data || []).map(u => [u.id, u]));
}

// Small convenience so call sites don't each re-invent the fallback string.
export function directoryName(byId, id, fallback = 'Unknown') {
  return byId.get(id)?.full_name || fallback;
}
