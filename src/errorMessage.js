// CL2: shared error formatter for client-facing alerts. Supabase / PostgREST
// error messages frequently leak column names, constraint names, RLS policy
// hints, and 23xxx PG codes that don't help a user and do help an attacker
// map the schema. Translate the common patterns to plain language and fall
// back to a generic message for everything else.

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
  if (!raw) return fallback;
  for (const [pattern, msg] of KNOWN_TRANSLATIONS) {
    if (pattern.test(raw)) return msg;
  }
  if (RLS_HINTS.some((p) => p.test(raw))) return 'You do not have permission to do that.';
  // PostgreSQL SQLSTATE codes like "23505" — drop the rest of the message.
  if (/^\s*\d{5}\s*:/.test(raw)) return fallback;
  // Generic Supabase code-prefixed messages can leak schema. Cap length.
  return raw.length > 160 ? fallback : raw;
}
