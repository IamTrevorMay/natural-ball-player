// CL2: shared error formatter for client-facing alerts. Supabase / PostgREST
// error messages frequently leak column names, constraint names, RLS policy
// hints, and 23xxx PG codes that don't help a user and do help an attacker
// map the schema. Translate the common patterns to plain language and fall
// back to a generic message for everything else.

import { trackError } from './usage';

const RLS_HINTS = [
  /row[- ]level security/i,
  /policy/i,
  /permission denied/i,
  /violates/i,
];

const KNOWN_TRANSLATIONS = [
  [/invalid login credentials/i, 'Incorrect email or password.'],
  [/email not confirmed/i, 'Confirm your email address before signing in.'],
  [/email rate limit/i, 'Too many emails sent recently. Try again shortly.'],
  [/over_email_send_rate_limit/i, 'Too many emails sent recently. Try again shortly.'],
  [/new password should be different/i, 'Pick a password different from your current one.'],
  [/duplicate key/i, 'That value is already in use.'],
  [/value too long/i, 'One of the entered values is too long.'],
  [/not[- ]null constraint/i, 'A required field was left blank.'],
  [/network error|failed to fetch/i, 'Network error — check your connection.'],
];

export function formatUserError(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  const raw = typeof err === 'string' ? err : (err.message || err.error_description || '');
  // Categorize once so we both return a string AND record the bucket.
  let bucket = 'generic';
  let out = fallback;
  if (!raw) {
    bucket = 'empty';
    out = fallback;
  } else {
    let matched = false;
    for (const [pattern, msg] of KNOWN_TRANSLATIONS) {
      if (pattern.test(raw)) { out = msg; bucket = String(pattern).slice(0, 40); matched = true; break; }
    }
    if (!matched) {
      if (RLS_HINTS.some((p) => p.test(raw))) {
        out = 'You do not have permission to do that.';
        bucket = 'rls';
      } else if (/^\s*\d{5}\s*:/.test(raw)) {
        out = fallback;
        bucket = 'pg_sqlstate';
      } else if (raw.length > 160) {
        out = fallback;
        bucket = 'too_long';
      } else {
        out = raw;
        bucket = 'passthrough';
      }
    }
  }
  // Fire-and-forget; tracker is feature-flagged + no-ops if disabled.
  try { trackError('format_user_error', { bucket }); } catch { /* ignore */ }
  return out;
}
