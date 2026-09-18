// #418 — the Mechanics note areas and their deficiency checklists.
//
// Cordell: "instead of hitting and pitching buttons ... have mechanics with
// a drop down menu for base running, hitting, pitching / throwing, catching
// and fielding. This is where each of those 5 sections will have the
// deficiencies list I emailed you for coaches to accurately diagnose and
// prescribe drills."
//
// ⚠️  The emailed lists are NOT in the repo. Paste each area's deficiencies
// into its `deficiencies` array below (plain strings, in the order they
// should appear). Until then the editor shows the area with an empty
// checklist and coaches can type deficiencies in by hand — those are stored
// the same way, so nothing has to be migrated when the lists land.
//
// `value` is written to player_notes.area and is CHECK-constrained in
// 20260918_player_notes_mechanics.sql — do not rename without a migration.
// `pitchLog` turns on the pitch-by-pitch table for that area.

export const MECHANICS_AREAS = [
  { value: 'base_running',      label: 'Base Running',        deficiencies: [] },
  { value: 'hitting',           label: 'Hitting',             deficiencies: [], pitchLog: 'hitting' },
  { value: 'pitching_throwing', label: 'Pitching / Throwing', deficiencies: [], pitchLog: 'pitching' },
  { value: 'catching',          label: 'Catching',            deficiencies: [] },
  { value: 'fielding',          label: 'Fielding',            deficiencies: [] },
];

export const mechanicsArea = (value) => MECHANICS_AREAS.find(a => a.value === value) || null;
export const mechanicsAreaLabel = (value) => mechanicsArea(value)?.label || value || '';
