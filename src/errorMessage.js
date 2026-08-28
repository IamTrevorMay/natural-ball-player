// CL2: shared error formatter for client-facing alerts. Supabase / PostgREST
// error messages frequently leak column names, constraint names, RLS policy
// hints, and 23xxx PG codes that don't help a user and do help an attacker
// map the schema. Translate the common patterns to plain language and fall
// back to a generic message for everything else.

import { trackError } from './usage';

// Only genuine "you are not allowed" errors belong here. A bare /violates/
// used to live in this list, which meant every CHECK / foreign-key failure was
// reported as "You do not have permission to do that." — telling an admin who
// owns the system that he lacks permission on something that was never a
// permission problem. Constraint failures are translated below instead.
const RLS_HINTS = [
  /row[- ]level security/i,
  /policy/i,
  /permission denied/i,
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
  // Constraint failures are a rejected VALUE, not a rejected PERSON. These sit
  // after the duplicate-key / not-null entries above so those keep their more
  // specific wording; the last line is the catch-all for anything else the
  // database refuses, so a raw constraint name never reaches the screen.
  [/violates check constraint/i, "That value isn't allowed here — please check what you entered and try again."],
  [/violates foreign key constraint/i, 'This is connected to another record, so that change was not allowed.'],
  [/violates .*constraint/i, "One of the values entered isn't allowed here."],
  // G2: the app is newer than the database — a migration has not been run, so a
  // column or table the code expects is missing, or PostgREST's schema cache is
  // stale. The person on screen cannot fix this and retrying will not help, so
  // say so without naming the table or column. The bare codes are here because
  // PostgREST puts 42703 / 42P01 / PGRST204 / PGRST205 on error.code, not in the
  // message text; the phrase alternatives cover the message form. This sits
  // after every entry above, so nothing that already translates is affected.
  [/^42703$|^42P01$|^PGRST20[45]$|column .* does not exist|could not find the .* (column|table)|schema cache/i,
    "This feature needs a database update that hasn't been applied yet. Nothing you did caused this and retrying won't help — please let Nicholas know."],
  [/network error|failed to fetch/i, 'Network error — check your connection.'],
];

export function formatUserError(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  const raw = typeof err === 'string' ? err : (err.message || err.error_description || '');
  // G2: Postgres/PostgREST put the SQLSTATE (42703) or PostgREST code (PGRST204)
  // on err.code, never in err.message, so the table is tested against both. No
  // existing pattern above is a bare code, so this cannot re-route an error that
  // already translates. Deliberately NOT applied to the \d{5}: guard below —
  // every PG error carries a code, and testing that against it would send every
  // one of them to the generic fallback.
  const code = typeof err === 'string' ? '' : String(err.code || '');
  // Categorize once so we both return a string AND record the bucket.
  let bucket = 'generic';
  let out = fallback;
  if (!raw && !code) {
    bucket = 'empty';
    out = fallback;
  } else {
    let matched = false;
    for (const [pattern, msg] of KNOWN_TRANSLATIONS) {
      if ((raw && pattern.test(raw)) || (code && pattern.test(code))) {
        out = msg; bucket = String(pattern).slice(0, 40); matched = true; break;
      }
    }
    if (!matched) {
      if (RLS_HINTS.some((p) => p.test(raw))) {
        out = 'You do not have permission to do that.';
        bucket = 'rls';
      } else if (/^\s*\d{5}\s*:/.test(raw)) {
        out = fallback;
        bucket = 'pg_sqlstate';
      } else if (!raw) {
        // H1: a code-carrying error that matched nothing above and has no usable
        // message must still land on the generic sentence. Letting it reach the
        // passthrough below returned '', which showed the user an alert that
        // stopped dead at the colon: "Error saving video link: ".
        out = fallback;
        bucket = 'empty';
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
