// #437: PostgREST silently clamps EVERY query to the project's db-max-rows
// (1000) and returns the short list with NO error. `users` passed 1,000 rows
// on 2026-10-05, so any "list all users" query ordered by full_name quietly
// lost everyone from ~"W" onward — which is how Zach Robman vanished from the
// Schedule's "Select players" picker. A single wide `.range(0, 9999)` is
// clamped the same way; the only way past the cap is to page.
//
// Usage: pass a function that BUILDS the query (so each page gets a fresh
// builder), with an `.order()` already applied. The order must be stable
// across pages — names are not unique, so when ordering by full_name add
// `.order('id')` as a tiebreaker or a name that straddles a page boundary
// can be duplicated or skipped.
//
//   const { rows, error } = await readAllPages(() =>
//     supabase.from('users').select('id, full_name').order('full_name').order('id'));
//
// `rows` is always an array: on error it holds whatever pages came back
// before the failure, so callers that only log the error still render a
// partial list rather than nothing.

export const PAGE_SIZE = 1000;

export async function readAllPages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) return { rows: out, error };
    const page = data || [];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

export default readAllPages;
