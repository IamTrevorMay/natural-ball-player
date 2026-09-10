import { supabase } from './supabaseClient';

// #393: every generator writes day_anchor: 'weekday' so handleProgramDrop knows
// to snap the program to Monday rather than treating the dropped day as day 1.
//
// WHY THIS WRAPPER EXISTS — deploy ordering.
//
// Migrations in this repo are written-not-run and applied by hand, but Vercel
// auto-deploys on push to main (CLAUDE.md). So there is a window where the new
// app code is live and 20260910_training_programs_day_anchor.sql has not been
// applied yet. In that window an insert naming day_anchor fails with Postgres
// 42703 (undefined_column) and takes the WHOLE program with it — all four
// generators would stop being able to save anything at all. Breaking program
// generation to fix a day-alignment bug is a bad trade.
//
// So: try with the column, and if the database says it doesn't have it, retry
// without. The program then saves as 'sequential' by default, which is exactly
// the pre-#393 behaviour — the days land where they land today. Once the
// migration runs, the first attempt succeeds and this fallback goes quiet by
// itself. Nothing needs to be cleaned up afterwards except programs generated
// during that window, which keep the old (wrong) anchoring and can simply be
// regenerated.
//
// Delete this wrapper once the migration is confirmed applied in production.
const UNDEFINED_COLUMN = '42703';

export async function insertTrainingProgram(fields) {
  const { day_anchor, ...withoutAnchor } = fields;

  const first = await supabase
    .from('training_programs')
    .insert(fields)
    .select('id')
    .single();

  // Only fall back for the one error this is guarding against. Anything else
  // (RLS, not-null, a bad created_by) is a real failure the caller must see —
  // retrying those without day_anchor would just fail again and bury the cause.
  const missingColumn =
    first.error &&
    (first.error.code === UNDEFINED_COLUMN ||
      /day_anchor/i.test(first.error.message || ''));
  if (!missingColumn) return first;

  console.warn(
    '#393: training_programs.day_anchor is missing — saving without it. ' +
    'Run supabase/migrations/20260910_training_programs_day_anchor.sql, or ' +
    'generated programs keep landing on the drop date instead of Monday.'
  );
  return supabase
    .from('training_programs')
    .insert(withoutAnchor)
    .select('id')
    .single();
}
