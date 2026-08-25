// Shared write-outcome classifier.
//
// This codebase has a documented production failure mode: a write refused by
// row-level security comes back as HTTP 200 with `error` null and zero rows.
// `const { error } = await supabase.from(t).update(...)` therefore reports
// success for a write that changed nothing at all. The only way to tell the
// difference is to end the statement in .select(...) and count what comes back.
//
// Callers must pass the `data` from a write that ended in .select(...), and
// `expected` = how many rows the statement targeted.
//
//   error present        -> 'errored'
//   no error, 0 rows     -> 'blocked'  (RLS silently matched nothing)
//   no error, < expected -> 'partial'  (some rows refused)
//   no error, >= expected-> 'written'
//
// `data` of null/undefined with no error means the server returned no
// representation at all, which we also treat as blocked rather than assumed.
//
// Lifted verbatim out of ExerciseVideoGaps.js (#170), which still re-exports it
// so nothing that imported it from there keeps working. It moved because #306
// needs the same guarantee on the package-extension write, and a safety check
// that decides whether staff are told their change landed must have exactly one
// definition — a second copy that drifts is worse than no check at all.

/**
 * @returns {{ outcome: 'errored'|'blocked'|'partial'|'written', written: number, blocked: number }}
 */
export function classifyWriteOutcome({ error, data, expected = 1 }) {
  const target = Math.max(0, Number(expected) || 0);
  if (error) return { outcome: 'errored', written: 0, blocked: 0 };
  const returned = Array.isArray(data) ? data.length : 0;
  if (returned === 0) return { outcome: 'blocked', written: 0, blocked: target };
  if (returned < target) return { outcome: 'partial', written: returned, blocked: target - returned };
  return { outcome: 'written', written: returned, blocked: 0 };
}
