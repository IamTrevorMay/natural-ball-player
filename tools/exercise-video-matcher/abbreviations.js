// Gym shorthand -> full word(s), expanded during normalization before any
// comparison happens (see normalize.js). Keys must be lowercase, single
// tokens (no spaces) — they are matched against individual words after
// punctuation stripping and filler-word removal.
//
// This list is intentionally small. Add to it as real exercise names turn
// up abbreviations we haven't seen yet — that's expected, not a sign
// something is broken.
module.exports = {
  db: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  sl: 'single leg',
  rdl: 'romanian deadlift',
  ohp: 'overhead press',
  bw: 'bodyweight',
  dl: 'deadlift',
  sa: 'single arm',
  alt: 'alternating',

  // Added against the real #170 exercise list (1,140 rows) and the real
  // 466-video playlist export.
  ssb: 'safety squat bar',
  oh: 'overhead', // real mismatch: exercises.csv and videos.csv both mix
                   // abbreviated "OH ..." with fully spelled-out "Overhead ..."
                   // for the same movements — without this, those rows only
                   // fuzzy-match on shared surrounding words instead of exactly.
  de: 'dynamic effort', // doesn't occur in the current filtered exercise
  me: 'max effort',     // list (both are common enough to already have videos
                         // and get filtered out upstream) — added anyway per
                         // request, and matches the "DE"/"ME" day-naming this
                         // codebase already uses in defaultProgram.js.

  // CAR/CARs (Controlled Articular Rotations, an FRC-family mobility drill)
  // appear as both singular and plural on both sides ("Shoulder CAR" /
  // "Shoulder CARS") — mapped to the same singular expansion so singular vs.
  // plural is never the reason two otherwise-identical names fail to match.
  car: 'controlled articular rotation',
  cars: 'controlled articular rotation',
  frc: 'functional range conditioning', // the CARs/PAILs-RAILs mobility system

  // PVC and TRX are equipment names that already function as complete,
  // standalone words in both files (nobody spells out "polyvinyl chloride"
  // or "suspension trainer") — kept as their own token rather than replaced,
  // with the occasional fuller phrasing added alongside so "PVC X" still
  // lines up with "PVC Pipe X", and likewise for TRX.
  pvc: 'pvc pipe',
  trx: 'trx suspension trainer',

  // Best-effort read of Cordell's own shorthand, inferred from context
  // ("ENG hip External Rotations", "Loaded ENG Shoulder IR") rather than
  // confirmed against a spelled-out counterpart anywhere in either file —
  // unlike the entries above, nothing in the real data proves this reading.
  // Flag to Cordell: correct this if "ENG" means something else to him.
  eng: 'engagement',
};
