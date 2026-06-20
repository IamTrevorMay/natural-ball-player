// Anonymous usage tracking for the 2-week V2 research experiment.
//
// No PII. session_id is a random UUID stored in sessionStorage (resets on tab
// close). Only `role`, `secondary_role`, `portal`, event name, and event
// duration go to the server. meta payloads must stay enum-like (no user
// names, emails, message contents — only view/tab/action identifiers).
//
// Feature-flag gate: set REACT_APP_USAGE_TRACKING=1 in Vercel for the window.
// When the experiment ends, flip the flag off, drop public.usage_events, and
// delete this file.

import { useEffect } from 'react';
import { supabase, supabaseUrl } from './supabaseClient';

const ENABLED = process.env.REACT_APP_USAGE_TRACKING === '1';
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 20;
const SESSION_KEY = 'nbp_usage_session_id';

let sessionId = null;
let role = null;
let secondaryRole = null;
let portal = 'main';

let buffer = [];
let flushTimer = null;

// view_enter timestamps keyed by view name so view_exit can compute duration.
const viewEnterAt = new Map();
// modal_open timestamps keyed by modal name.
const modalOpenAt = new Map();

function ensureSessionId() {
  if (sessionId) return sessionId;
  if (typeof window === 'undefined') return null;
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    sessionId = id;
    return id;
  } catch {
    sessionId = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return sessionId;
  }
}

export function initUsage({ role: r, secondary_role: sr, portal: p } = {}) {
  if (!ENABLED) return;
  ensureSessionId();
  role = r || null;
  secondaryRole = sr || null;
  portal = p || 'main';
  if (typeof window !== 'undefined' && !window.__usageFlushBound) {
    window.addEventListener('beforeunload', () => flushUsage(true));
    window.addEventListener('error', (e) => trackError('window.onerror', { message: String(e.message || '').slice(0, 200) }));
    window.addEventListener('unhandledrejection', (e) => trackError('unhandled_rejection', { reason: String(e.reason?.message || e.reason || '').slice(0, 200) }));
    window.__usageFlushBound = true;
  }
}

export function setUsageContext({ role: r, secondary_role: sr, portal: p }) {
  if (!ENABLED) return;
  if (r !== undefined) role = r;
  if (sr !== undefined) secondaryRole = sr;
  if (p !== undefined) portal = p;
}

function push(event_type, event_name, meta, duration_ms) {
  if (!ENABLED) return;
  if (!role) return; // role required by NOT NULL constraint
  ensureSessionId();
  if (!sessionId) return;
  buffer.push({
    session_id: sessionId,
    role,
    secondary_role: secondaryRole,
    portal,
    event_type,
    event_name: String(event_name).slice(0, 120),
    duration_ms: duration_ms ?? null,
    meta: meta && typeof meta === 'object' ? meta : null,
  });
  if (buffer.length >= FLUSH_BATCH_SIZE) {
    flushUsage();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushUsage, FLUSH_INTERVAL_MS);
  }
}

export function flushUsage(viaBeacon = false) {
  if (!ENABLED) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (viaBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    // Use Beacon for the final flush so it survives a tab close. PostgREST
    // accepts a JSON body at /rest/v1/usage_events with a Bearer token.
    try {
      const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' });
      const url = `${supabaseUrl}/rest/v1/usage_events`;
      // Beacon doesn't support custom headers everywhere; fall back to
      // sending without the auth header when Beacon is used. Server-side
      // RLS will then reject anon writes, so we still try the normal path
      // first as a best-effort.
      navigator.sendBeacon(url, blob);
    } catch { /* swallow */ }
    return;
  }
  try {
    supabase.from('usage_events').insert(batch).then(({ error }) => {
      if (error) {
        // Avoid feedback loop — log only, don't re-emit an error event.
        console.warn('[usage] flush failed:', error.message);
      }
    });
  } catch (err) {
    console.warn('[usage] flush threw:', err);
  }
}

export function trackView(name, meta) {
  if (!ENABLED || !name) return;
  viewEnterAt.set(name, Date.now());
  push('view_enter', name, meta);
}

export function trackViewExit(name, meta) {
  if (!ENABLED || !name) return;
  const enteredAt = viewEnterAt.get(name);
  const duration_ms = enteredAt ? Date.now() - enteredAt : null;
  viewEnterAt.delete(name);
  push('view_exit', name, meta, duration_ms);
}

export function trackModalOpen(name, meta) {
  if (!ENABLED || !name) return;
  modalOpenAt.set(name, Date.now());
  push('modal_open', name, meta);
}

export function trackModalClose(name, meta) {
  if (!ENABLED || !name) return;
  const openedAt = modalOpenAt.get(name);
  const duration_ms = openedAt ? Date.now() - openedAt : null;
  modalOpenAt.delete(name);
  push('modal_close', name, meta, duration_ms);
}

export function trackAction(name, meta) {
  if (!ENABLED || !name) return;
  push('action_click', name, meta);
}

export function trackError(name, meta) {
  if (!ENABLED || !name) return;
  push('error', name, meta);
}

// Convenience for environments where we want a runtime check.
export const usageEnabled = ENABLED;

// Drop into the BODY of a conditionally-mounted modal:
//   if (!show) return null;
//   useModalTracking('EditUserModal');
// Fires modal_open on mount, modal_close on unmount with duration.
export function useModalTracking(name, meta) {
  useEffect(() => {
    if (!ENABLED || !name) return undefined;
    trackModalOpen(name, meta);
    return () => { trackModalClose(name, meta); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}
