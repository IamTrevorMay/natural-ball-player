/* ============================================================================
   throwingEngine.js — "The Ramp" arm-development / throwing-program engine.

   Dependency-free port of the pure logic from
   "NBP Systems Development/throwing_program_engine.jsx" (v2, data-grounded).
   Per-position / per-level throw counts are anchored to published game data
   (Saper/Fleisig, Axe/Windley/Snyder-Mackler, Freeston et al., MLB Pitch Smart).
   Every value is a tunable coaching default, not a validated constant. This is
   programming support, not medical advice; return-to-throw must be cleared
   clinically.

   The React console UI is rebuilt separately in src/ThrowingGenerator.js; this
   file holds only the pure engine + serializers into the app's program shape.

   ------------------------------------------------------------------------------
   V3 REWRITE — head-coach testing feedback (numbers honored as coaching targets):

   1. RELIEF-PITCHER VOLUME. Pitcher daily volume is driven off a role peak
      (ROLE_PEAK_VOL: SP 80, SW/TW 76, RP 50) ramped by phase/week
      (pitcherVolTarget). High-volume days (long-toss / med / high) for relievers
      in ON-RAMP + VELO now reach ~50 throws (up from ~22-25). dailyCeiling caps
      each non-outing day at ~role peak so nobody blows past their band.
   2. WHOOP -> VOLUME (geometric, replaces stepped buckets). readiness() now uses
      continuous multipliers: volMult = 1 - 0.50*0.5^(recovery/25) and the milder
      intentMult = 1 - 0.25*0.5^(recovery/25). Checkpoints: rec 0->.50, 25->.75,
      50->.875, 75->.9375, 100->~.969. soreness=high still forces a rest/low day.
   3. VELO-PHASE INTENT 90-100% by day. Two flavors: HIGH_INTENT (~94, 90-95%
      band) and VELO (~100, 95-100% band) replace the single fixed-96 HIGH day.
   4. PRE-SEASON RAMP. weekInPhase<3 -> 2x/wk build @50-75% + recovery; 3-5 ->
      3x/wk; >=6 -> 4x/wk with a live outing. A bullpen is NEVER the day before a
      live outing; it sits 3 days before for starters, 2 days before for relievers
      (preseasonPitcherWeek enforces the ordering).
   5. ON-RAMP / RETURN-TO-THROW build curve. Volume ladders per role up to ~75-80
      (closers/RP capped ~50) before long-toss / high-intent day types unlock
      (ROLE_LT_GATE gates the long-toss day until the volume base is reached).
   6. IN-SEASON MAINTENANCE. SP/SW = ONE live start/wk (<=90 pitches) + a midweek
      touch pen capped 40-45. TW = one start + a 20-25 pitch midweek pen, NO second
      live. RP stays multi-outing.
   7. POSITION PLAYERS never pitch: no MOUND/TOUCH/LIVE-pen day types; their LIVE
      is game at-bats (mound flag forced false, no pitch count, category 'other').
      Between games they get recovery / medium-intent throwing + defensive work.
   8. ACWR AUTO-IMPACT (feedback loop). When a chronic baseline is supplied,
      buildWeek scales the week's non-outing throwing volume: if projected ACWR
      (sum stressUnits / chronic) exceeds phase.acwr[1] it scales DOWN toward the
      ceiling; if below phase.acwr[0] it scales UP modestly (<=1.15x), never
      inflating game/pen outings and never past Pitch Smart. The UI ACWR readout
      reflects the post-adjustment number.
   9. PLYOS / DRILLS are structured exercise entries (PLYO_DRILL library), placed
      by day type (velo/plyo on high days, recovery plyos on care days, arm-action
      on long toss, command drills on pens, defensive drills on field days).
  10. MOVEMENT PREP / MOBILITY is a structured block on every throwing day,
      biased by the mob/str/bio assessment sliders (lower score -> more targeted
      work) via movementPrep().
  11. PHASE PLAN. buildThrowingPhases() mirrors hittingEngine.buildPhases: an
      array of {kind,name,focus,span:[startWeek,endWeek]} across the program.
  12. BENCHMARK-VS-DATA. THROW_BM/THROW_UNIV + throwStatusOf/gradeThrowing grade
      velocity (by level), spin & extension good/dev/def (mirrors hitting's
      BM/statusOf/gradeAll). A deficient velo grade biases day selection (extra
      velo exposure when cleared) and adds corrective plyo emphasis. Graceful when
      metrics are missing.
  13. PROGRAM LENGTH 1-16 WEEKS. buildProgram() builds N distinct microcycles with
      real week-over-week progression (onramp volume ladder, preseason 2-3x->4x,
      velo volume waves, EWMA-rolling chronic that drives ACWR waves).
      SERIALIZATION: programToProgramDays emits training_days with
      day_number = (w-1)*7 + weekdayIndex + 1 (1-based absolute calendar offset,
      Mon=0..Sun=6). Pure OFF days are skipped. duration_weeks = N.

   SAFETY: Pitch Smart caps (pitchSmart.js) are HARD ceilings — LIVE/MOUND/TOUCH
   pitch counts are clamped to the level max (ps.capped flags the clamp) and can
   never be inflated by the ACWR loop. Not medical advice.
   ========================================================================== */

import { pitchSmartByLevel } from './pitchSmart';

/* ---------- Levels ---------- */
export const LEVELS = [
  { id: '9-10', label: 'Youth 9–10' }, { id: '11-12', label: 'Youth 11–12' },
  { id: '13-14', label: 'Middle 13–14' }, { id: '15-16', label: 'HS 15–16' },
  { id: '17-18', label: 'HS 17–18' }, { id: '19-22', label: 'College 19–22' },
  { id: 'pro', label: 'Pro / Adult' },
];

/* ---------- Measured game demand ---------- */
const PITCHER_GAME = {
  '9-10': { SP: 45, RP: 15, warm: 20 }, '11-12': { SP: 52, RP: 18, warm: 22 },
  '13-14': { SP: 58, RP: 20, warm: 25 }, '15-16': { SP: 66, RP: 22, warm: 28 },
  '17-18': { SP: 78, RP: 24, warm: 30 }, '19-22': { SP: 90, RP: 22, warm: 32 },
  pro: { SP: 93, RP: 17, warm: 35 },
};
const FIELDER_GAME = {
  C: { total: 130, active: 5, meanIntent: 46, dist: 127, src: 'Returns ≈ battery pitch count + throwdowns' },
  MIF: { total: 55, active: 6, meanIntent: 64, dist: 120, src: 'Freeston: highest fielder total + hard throws' },
  CIF: { total: 45, active: 5, meanIntent: 67, dist: 127, src: '3B hardest cross-diamond; 1B receives more' },
  OF: { total: 38, active: 4, meanIntent: 73, dist: 0, src: 'Fewest but longest & hardest single throws' },
};
const OF_MAXDIST = { '9-10': 120, '11-12': 150, '13-14': 170, '15-16': 200, '17-18': 225, '19-22': 250, pro: 280 };
const LEVEL_INTENT = { '9-10': 0.88, '11-12': 0.92, '13-14': 0.95, '15-16': 0.98, '17-18': 1.0, '19-22': 1.02, pro: 1.05 };

/* ---------- Positions ---------- */
export const POSITIONS = {
  SP: { label: 'Starting Pitcher', group: 'P', pitch: 'SP', intentCap: 100, freq: 5, moundHeavy: true,
    band: 'Mound-centric, 5-day cycle', note: 'Low frequency, very high intensity. Week orbits the start.' },
  RP: { label: 'Relief Pitcher', group: 'P', pitch: 'RP', intentCap: 100, freq: 6, moundHeavy: true,
    band: 'Short high-intent bursts', note: 'Must survive back-to-backs; police cumulative bullpen load.' },
  SW: { label: 'Swingman / Long Relief', group: 'P', pitch: 'SP', intentCap: 100, freq: 5, moundHeavy: true,
    band: 'Hybrid start/relief', note: 'Program to the longest likely outing, not the average one.' },
  C: { label: 'Catcher', group: 'POS', fielder: 'C', intentCap: 90, freq: 6, moundHeavy: false,
    band: 'High volume, quick release, short–mid', note: 'Highest chronic arm-and-body exposure on the field.' },
  MIF: { label: 'Middle Infield (2B/SS)', group: 'POS', fielder: 'MIF', intentCap: 90, freq: 6, moundHeavy: false,
    band: 'Quick-release footwork throws', note: 'Most fielder throws of any position (MLB Statcast).' },
  CIF: { label: 'Corner Infield (1B/3B)', group: 'POS', fielder: 'CIF', intentCap: 95, freq: 6, moundHeavy: false,
    band: 'Cross-diamond, harder on-a-line', note: '3B carries the hardest routine fielding throw.' },
  OF: { label: 'Outfield', group: 'POS', fielder: 'OF', intentCap: 100, freq: 5, moundHeavy: false,
    band: 'Long crow-hop carry', note: 'Throws least often, hardest; distance scales with level.' },
  TW: { label: 'Two-Way Player', group: 'P', pitch: 'SP', fielder: 'MIF', intentCap: 100, freq: 6, moundHeavy: true,
    band: 'Pitching + position stacked', note: 'Total arm load = both roles summed. Police the sum.' },
};

/* Per-role high-volume-day peak throw target (before phase/week ramp + readiness).
   Closers (RP) intentionally cap ~50; starters / long relief / two-way build to ~75-80. */
const ROLE_PEAK_VOL = { SP: 80, SW: 76, TW: 76, RP: 50 };
/* On-ramp long-toss unlock gate: role must build to this base volume first. */
const ROLE_LT_GATE = { SP: 72, SW: 68, TW: 68, RP: 40 };

/* ---------- Phases (color dropped — UI maps from id) ---------- */
export const PHASES = {
  DELOAD: { label: 'Deload / Off Week', volMult: 0.30, intentCap: 60, acwr: [0.6, 0.9],
    goal: 'Dissipate fatigue, keep tissue tolerant. Nothing max.' },
  ONRAMP: { label: 'On-Ramp / Return to Throw', volMult: 0.55, intentCap: 80, acwr: [0.8, 1.2],
    goal: 'Rebuild tolerance through graduated distance. No max intent.' },
  VELO: { label: 'Velocity / Build', volMult: 1.05, intentCap: 100, acwr: [0.9, 1.3],
    goal: 'Develop arm speed with high-intent days on a tolerant base.' },
  PRESEASON: { label: 'Pre-Season Ramp', volMult: 0.95, intentCap: 100, acwr: [0.9, 1.25],
    goal: 'Convert intent to the mound / game; build to outing volume.' },
  INSEASON: { label: 'In-Season Maintenance', volMult: 0.85, intentCap: 100, acwr: [0.8, 1.2],
    goal: 'Hold velocity & command, recover between outings, respect caps.' },
  POSTSEASON: { label: 'Post-Season / Shutdown', volMult: 0.25, intentCap: 55, acwr: [0.5, 0.8],
    goal: 'Taper to a mandated block with zero overhead throwing.' },
};
export const PHASE_ORDER = ['POSTSEASON', 'DELOAD', 'ONRAMP', 'VELO', 'PRESEASON', 'INSEASON'];

export const ATHLETE_TYPES = {
  novice: { label: 'Novice', volAdj: 0.80, note: 'Slower ramp, lower ceiling, more recovery.' },
  intermediate: { label: 'Intermediate', volAdj: 1.00, note: 'Standard progression.' },
  advanced: { label: 'Advanced', volAdj: 1.12, note: 'Higher tolerance; can carry more high days.' },
};
const ITP_LADDER = [45, 60, 90, 120, 150, 180];

/* ---------- Benchmark tables (mirrors hittingEngine BM/UNIV) ---------- */
// Level-graded fastball velocity (release speed, mph).
export const THROW_BM = {
  velo: { dir: 'up', unit: 'mph', label: 'Fastball velocity', by: {
    '9-10': { dev: [40, 50], good: 50 }, '11-12': { dev: [50, 60], good: 60 },
    '13-14': { dev: [60, 70], good: 70 }, '15-16': { dev: [70, 80], good: 80 },
    '17-18': { dev: [78, 86], good: 86 }, '19-22': { dev: [85, 92], good: 92 },
    pro: { dev: [90, 95], good: 95 } } },
};
// Level-independent throwing metrics.
export const THROW_UNIV = {
  spin: { dir: 'up', unit: 'rpm', label: 'Fastball spin rate', dev: [1900, 2200], good: 2200 },
  ext: { dir: 'up', unit: 'ft', label: 'Release extension', dev: [5.5, 6.2], good: 6.2 },
};
// Metric input catalog for the UI.
export const THROW_METRICS = [
  { key: 'velo', label: 'Fastball velocity', unit: 'mph' },
  { key: 'spin', label: 'Fastball spin rate', unit: 'rpm' },
  { key: 'ext', label: 'Release extension', unit: 'ft' },
];

/* ---------- Movement-prep + plyo/drill libraries (structured blocks) ---------- */
const MOVEMENT_PREP = {
  general: ['Dynamic warm-up (leg swings, lunges, skips)', 'Arm circles + Jaeger band series', 'Wrist / forearm prep'],
  mobility: ['Shoulder CARs (ER/IR)', 'Sleeper & cross-body stretch', 'Thoracic open-books', '90/90 hip switches'],
  strength: ['Band pull-aparts + Y-T-W', 'Scap push-ups & serratus work', 'Rotator-cuff ER/IR bands'],
  bio: ['Wall arm-action drill', 'Hip–shoulder separation walkthrough', 'Deceleration / stride-block reps'],
};
const PLYO_DRILL = {
  recovery: ['Light rebounder plyos (green/blue ball)', 'Reverse-throw arm care', 'Wrist-weight recovery'],
  velo: ['Plyo-ball pulldowns (max intent)', 'Walking-windup velo throws', 'Roll-in / run-and-gun', 'Overload / underload plyo series'],
  command: ['Towel drill', 'Connection-ball pen', 'Target command ladder'],
  arm_action: ['Wall drill', 'Pivot-pickoff plyo throws', 'Rocker / marshall drills'],
  fielding: ['Footwork & exchange drills', 'Crow-hop carry throws', 'Quick-release transfer reps'],
};

/* ============================ ENGINE ============================ */

export function gameDemand(posId, levelId) {
  const p = POSITIONS[posId];
  if (p.group === 'P') {
    const pg = PITCHER_GAME[levelId];
    const pitches = pg[p.pitch];
    const innings = Math.max(1, Math.round(pitches / 15));
    const total = pitches + pg.warm + innings * 8;
    return { kind: 'P', pitches, total, meanIntent: 100, dist: p.pitch === 'RP' ? '≤300 ft warm' : '≤300 ft warm',
      note: `${pitches} pitches + ${pg.warm} warm-up + ~${innings * 8} between-inning` };
  }
  const f = FIELDER_GAME[p.fielder];
  const dist = p.fielder === 'OF' ? OF_MAXDIST[levelId] : f.dist;
  const meanIntent = Math.min(100, Math.round(f.meanIntent * LEVEL_INTENT[levelId]));
  return { kind: 'POS', pitches: 0, total: f.total, active: f.active, meanIntent, dist, note: f.src };
}

/* Continuous geometric readiness scaling (replaces the old stepped buckets).
   `recovery` is the WHOOP recovery score 0-100, nudged by HRV trend + soreness. */
export function readiness(whoop, hrv, soreness) {
  let score = whoop;
  if (hrv === 'down') score -= 12;
  if (hrv === 'up') score += 6;
  score += { none: 0, mild: -6, moderate: -18, high: -40 }[soreness];
  score = Math.max(0, Math.min(100, score));

  // volMult   = 1 − 0.50·0.5^(recovery/25): 0→.50, 25→.75, 50→.875, 75→.9375, 100→~.969
  // intentMult= 1 − 0.25·0.5^(recovery/25): a milder cut on intent than on volume.
  const decay = Math.pow(0.5, score / 25);
  const volMult = 1 - 0.5 * decay;
  const intentMult = 1 - 0.25 * decay;

  if (soreness === 'high') {
    return { status: 'REST', score, intentMult: 0, volMult: Math.min(volMult, 0.2), headline: 'Arm care & full rest',
      detail: 'High arm soreness overrides the plan — recovery work only. Joint pain or >24h soreness needs evaluation.' };
  }
  if (score >= 67) {
    return { status: 'GO', score, intentMult, volMult, headline: 'Green — execute as programmed',
      detail: 'Recovery supports today\'s intent and volume. Proceed.' };
  }
  if (score >= 40) {
    return { status: 'MODIFY', score, intentMult, volMult, headline: 'Amber — throttle intent & volume',
      detail: 'Recovery is soft — the geometric cut trims volume & intent. Keep movement, lose max effort.' };
  }
  return { status: 'CAUTION', score, intentMult, volMult, headline: 'Red — recovery-biased day',
    detail: 'Low readiness. Light catch / arm care at most. Don\'t chase velocity.' };
}

export function assessmentGates(mob, str, bio) {
  const notes = [];
  const priorities = [];
  let maxIntentTier = 100;
  let canVelo = true;
  if (mob < 60) {
    maxIntentTier = Math.min(maxIntentTier, 85); canVelo = false;
    priorities.push('Restore shoulder (ER/IR) + hip + T-spine mobility before high-intent work.');
    notes.push('Mobility below threshold — high-intent throwing is gated until it improves.');
  } else if (mob < 75) {
    priorities.push('Maintain mobility; watch total-motion so range doesn\'t drift under load.');
  }
  if (str < 55) {
    maxIntentTier = Math.min(maxIntentTier, 90);
    priorities.push('Build relative strength & posterior-chain capacity to accept throwing load.');
    notes.push('Strength below threshold — ramp volume slower; hold pulldowns / weighted-ball velo.');
    if (str < 40) canVelo = false;
  }
  if (bio < 55) {
    maxIntentTier = Math.min(maxIntentTier, 88);
    priorities.push('Address mechanical efficiency / arm-stress flags with lower-intent movement work.');
    notes.push('Biomechanics stress flag — reduce high-intent frequency, emphasize pattern quality.');
    if (bio < 40) canVelo = false;
  }
  if (!priorities.length) priorities.push('Green light: progress volume and intent per the phase plan.');
  return { maxIntentTier, canVelo, notes, priorities };
}

export function stressUnits(throws, intentPct, mound) {
  return throws * Math.pow(Math.max(1, intentPct) / 100, 1.6) * (mound ? 1.18 : 1.0);
}

/* Role peak throw target for a high-volume day, ramped by phase + week-in-phase. */
function pitcherVolTarget(posId, phaseId, weekInPhase) {
  const peak = ROLE_PEAK_VOL[posId] ?? 60;
  const w = Math.max(1, weekInPhase);
  let frac;
  switch (phaseId) {
    case 'ONRAMP': frac = Math.min(1, 0.45 + 0.11 * (w - 1)); break;   // wk1 .45 → wk6 1.0
    case 'VELO': frac = Math.min(1, 0.92 + 0.03 * (w - 1)); break;     // near-full, small build
    case 'PRESEASON': frac = Math.min(1, 0.70 + 0.06 * (w - 1)); break;
    case 'INSEASON': frac = 0.85; break;
    case 'DELOAD': frac = 0.40; break;
    case 'POSTSEASON': frac = 0.20; break;
    default: frac = 0.60;
  }
  return peak * frac;
}

/* Hard per-day non-outing throw ceiling so a role never blows past its band. */
function dailyCeiling(posId) {
  const peak = ROLE_PEAK_VOL[posId];
  return peak ? Math.round(peak * 1.06) : null;
}

/* Grading helper (mirrors hittingEngine.gradeUp). */
function tGradeUp(v, dev, good) { if (v >= good) return 'good'; if (v >= dev[0]) return 'dev'; return 'def'; }

export function throwStatusOf(key, v, levelId) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (THROW_BM[key]) {
    const b = THROW_BM[key].by[levelId];
    if (!b) return null;
    return { status: tGradeUp(v, b.dev, b.good), dev: b.dev, good: b.good, dir: 'up', unit: THROW_BM[key].unit, value: v };
  }
  const u = THROW_UNIV[key];
  if (!u) return null;
  return { status: tGradeUp(v, u.dev, u.good), dev: u.dev, good: u.good, dir: 'up', unit: u.unit, value: v };
}

/* Grade a bag of throwing metrics against level benchmarks. Missing/blank -> skipped. */
export function gradeThrowing(values, levelId) {
  const S = {};
  if (!values) return S;
  for (const k in values) {
    const raw = values[k];
    if (raw === null || raw === undefined || raw === '') continue;
    const s = throwStatusOf(k, Number(raw), levelId);
    if (s) S[k] = s;
  }
  return S;
}

/* Mound / bullpen pitch-count ramp toward the level's outing target. */
export function moundRamp(levelId, posId) {
  const p = POSITIONS[posId];
  const target = PITCHER_GAME[levelId][p.pitch] || PITCHER_GAME[levelId].SP;
  const plan = [
    { wk: 1, day: 'Pen A', pct: 0.28, intent: 70, note: 'Flat-ground → light pen, fastballs only' },
    { wk: 1, day: 'Pen B', pct: 0.34, intent: 75, note: 'All fastballs, rebuild mechanics & feel' },
    { wk: 2, day: 'Pen A', pct: 0.42, intent: 80, note: 'Add change-up' },
    { wk: 2, day: 'Pen B', pct: 0.48, intent: 82, note: 'Introduce breaking ball (age-appropriate)' },
    { wk: 3, day: 'Up/down sim', pct: 0.55, intent: 86, note: '2 sim innings, sit down & re-warm between' },
    { wk: 4, day: 'Sim game', pct: 0.66, intent: 90, note: '3 innings vs live hitters' },
    { wk: 5, day: 'Live', pct: 0.80, intent: 95, note: '4 innings, near game intent' },
    { wk: 6, day: 'Live', pct: 0.92, intent: 100, note: '5 innings → clear for competition' },
    { wk: 7, day: 'Game outing', pct: 1.00, intent: 100, note: 'Season outing at target count' },
  ];
  return plan.map((s) => {
    const pitches = Math.round(target * s.pct);
    const ps = pitchSmartByLevel(levelId, pitches);
    return { ...s, pitches, rest: ps.rest, over: ps.over };
  });
}

/* Pre-season pitcher week — enforces bullpen-before-live ordering (rule 4). */
function preseasonPitcherWeek(posId, w) {
  if (w <= 2) return ['PRE_THROW', 'RECOVERY', 'CARE', 'PRE_THROW', 'RECOVERY', 'OFF', 'OFF'];      // 2x/wk
  if (w <= 5) return ['PRE_THROW', 'RECOVERY', 'PRE_THROW', 'CARE', 'PRE_THROW', 'OFF', 'OFF'];      // 3x/wk
  // w >= 6: 4x/wk with a Saturday live outing; day before live is recovery.
  // Bullpen sits 3 days before (Wed) for starters, 2 days before (Thu) for relievers.
  return posId === 'RP'
    ? ['PRE_THROW', 'RECOVERY', 'PRE_THROW', 'MOUND', 'RECOVERY', 'LIVE', 'OFF']
    : ['PRE_THROW', 'RECOVERY', 'MOUND', 'PRE_THROW', 'RECOVERY', 'LIVE', 'OFF'];
}

/* Build a 7-day microcycle, data-anchored. Optional `chronic` enables the ACWR
   feedback loop; optional `bench` (graded metrics) biases velo-day selection. */
export function buildWeek({ levelId, posId, phaseId, typeId, mob, str, bio, ready, weekInPhase, chronic, bench }) {
  const pos = POSITIONS[posId];
  const phase = PHASES[phaseId];
  const at = ATHLETE_TYPES[typeId];
  const gates = assessmentGates(mob, str, bio);
  const isP = pos.group === 'P';
  const demand = gameDemand(posId, levelId);
  const intentCeiling = Math.min(phase.intentCap, pos.intentCap, gates.maxIntentTier);
  const veloBad = !!(bench && bench.velo && (bench.velo.status === 'def' || bench.velo.status === 'dev'));

  // Fielders scale off measured game total; pitchers off a role/week volume target.
  const baseDaily = demand.total * phase.volMult * at.volAdj;             // fielders
  const volTarget = isP ? pitcherVolTarget(posId, phaseId, weekInPhase) : 0; // pitchers
  const ceiling = dailyCeiling(posId);

  const DT = {
    OFF: { t: 0, m: false, label: 'Off', focus: 'Full rest', f: 0 },
    CARE: { t: 0, m: false, label: 'Arm care', focus: 'Bands / plyo recovery, mobility', f: 0 },
    RECOVERY: { t: 55, m: false, label: 'Recovery catch', focus: 'Light, short, easy', f: 0.5 },
    LOW: { t: 68, m: false, label: 'Low intent', focus: 'Extension catch / long-toss out', f: 0.85 },
    MED: { t: 82, m: false, label: 'Medium intent', focus: 'Hybrid: extension + light compression', f: 1.0 },
    HIGH: { t: 96, m: pos.moundHeavy, label: 'High intent', focus: 'Pulldowns / plyo-velo / mound velo', f: 0.9 },
    HIGH_INTENT: { t: 94, m: pos.moundHeavy, label: 'High-intent day', focus: 'Compression / plyo-velo — 90-95%', f: 0.9 },
    VELO: { t: 100, m: pos.moundHeavy, label: 'Velocity day', focus: 'Pulldowns / plyo-velo — 95-100%', f: 0.85 },
    LONGTOSS: { t: 85, m: false, label: 'Long toss', focus: 'Extension out, compression in', f: 1.1 },
    MOUND: { t: 88, m: true, label: 'Mound / pen', focus: 'Bullpen — build feel & count', f: 1.0 },
    LIVE: { t: 100, m: true, label: 'Live / outing', focus: 'Compete: game or live ABs', f: 1.15 },
    TOUCH: { t: 70, m: true, label: 'Touch-and-feel pen', focus: 'Short low pen, command', f: 0.5 },
    PRE_THROW: { t: 65, m: false, label: 'Build throw', focus: 'Catch progression 50–75%, extension out', f: 0.9 },
    FIELD: { t: 85, m: false, label: 'Position work', focus: 'Defensive reps at game intent', f: 0.9 },
    THROWDOWN: { t: 92, m: false, label: 'Throwdowns', focus: 'Pop-time / footwork throws', f: 0.8 },
  };

  function skeleton() {
    const w = Math.max(1, weekInPhase);
    switch (phaseId) {
      case 'DELOAD': return ['CARE', 'RECOVERY', 'OFF', 'RECOVERY', 'CARE', 'OFF', 'RECOVERY'];
      case 'ONRAMP': {
        if (!isP) return ['LOW', 'CARE', w >= 3 ? 'LONGTOSS' : 'LOW', 'OFF', 'FIELD', 'CARE', w >= 4 ? 'MED' : 'RECOVERY'];
        // Long toss unlocks only once the role's volume base is built (rule 5).
        const gate = ROLE_LT_GATE[posId] ?? 55;
        const ltReady = pitcherVolTarget(posId, 'ONRAMP', w) >= gate;
        return ['LOW', 'CARE', ltReady ? 'LONGTOSS' : 'LOW', 'OFF', 'MED', 'CARE', w >= 4 ? 'MED' : 'RECOVERY'];
      }
      case 'VELO': {
        if (!isP) {
          const hi = gates.canVelo ? 'VELO' : 'MED';
          const hiB = gates.canVelo ? 'HIGH_INTENT' : 'MED';
          return ['FIELD', hiB, 'RECOVERY', 'LONGTOSS', 'CARE', hi, 'OFF'];
        }
        if (!gates.canVelo) return ['MED', 'RECOVERY', 'LONGTOSS', 'CARE', 'MED', 'RECOVERY', 'OFF'];
        // Velo-deficient athletes who ARE cleared get extra true-velo exposure (rule 12 bias).
        const dayB = veloBad ? 'VELO' : 'HIGH_INTENT';
        return [dayB, 'RECOVERY', 'LONGTOSS', 'CARE', 'VELO', 'RECOVERY', 'OFF'];
      }
      case 'PRESEASON':
        return isP ? preseasonPitcherWeek(posId, w)
          : (posId === 'C'
            ? ['FIELD', 'THROWDOWN', 'RECOVERY', 'FIELD', 'CARE', 'LIVE', 'OFF']
            : ['FIELD', 'LONGTOSS', 'RECOVERY', 'FIELD', 'CARE', 'LIVE', 'OFF']);
      case 'INSEASON':
        // SP/SW: ONE live start/wk + a controlled midweek touch pen (rule 6).
        if (posId === 'SP' || posId === 'SW') return ['LIVE', 'RECOVERY', 'CARE', 'TOUCH', 'LONGTOSS', 'RECOVERY', 'OFF'];
        if (posId === 'RP') return ['LIVE', 'CARE', 'LIVE', 'RECOVERY', 'LIVE', 'CARE', 'OFF'];
        // TW: one start + a 20-25 pitch midweek pen, NO second live.
        if (posId === 'TW') return ['LIVE', 'RECOVERY', 'FIELD', 'TOUCH', 'FIELD', 'RECOVERY', 'OFF'];
        // Position players: games are LIVE at-bats only; recovery/medium throwing between (rule 7).
        return posId === 'C'
          ? ['LIVE', 'RECOVERY', 'THROWDOWN', 'MED', 'LIVE', 'FIELD', 'OFF']
          : ['LIVE', 'RECOVERY', 'FIELD', 'MED', 'LIVE', 'FIELD', 'OFF'];
      case 'POSTSEASON':
        return w >= 3 ? ['OFF', 'CARE', 'OFF', 'OFF', 'CARE', 'OFF', 'OFF']
          : ['RECOVERY', 'CARE', 'OFF', 'RECOVERY', 'OFF', 'CARE', 'OFF'];
      default: return Array(7).fill('OFF');
    }
  }

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const week = skeleton().map((key, i) => {
    const spec = DT[key] || DT.OFF;
    let intent = Math.min(spec.t, intentCeiling);
    if (spec.t > 0) intent = Math.round(intent * ready.intentMult);

    // Pitchers: shape day off the role volume target (long toss f≈1.1 is the top day).
    let throws = isP
      ? Math.round(volTarget * (spec.f / 1.1) * at.volAdj * ready.volMult)
      : Math.round(baseDaily * spec.f * ready.volMult);

    // Outing / pen overrides (pitchers only — position players never pitch).
    if (isP && key === 'LIVE') {
      if (phaseId === 'PRESEASON') {
        const frac = Math.min(1, 0.55 + 0.10 * (Math.max(6, weekInPhase) - 6)); // ramp to outing volume
        throws = Math.round(demand.pitches * frac * ready.volMult);
      } else {
        throws = Math.round(demand.pitches * ready.volMult);
        if (posId === 'SP' || posId === 'SW' || posId === 'TW') throws = Math.min(throws, 90); // single start cap
      }
    } else if (isP && key === 'MOUND') {
      throws = Math.round(demand.pitches * 0.5 * ready.volMult);
    } else if (isP && key === 'TOUCH') {
      throws = posId === 'TW'
        ? Math.round(22 * ready.volMult)                                   // 20-25 pitch two-way pen
        : Math.min(45, Math.round(demand.pitches * 0.45 * ready.volMult)); // SP/SW midweek pen ≤45
    } else if (isP && ceiling != null && spec.t > 0) {
      throws = Math.min(throws, ceiling); // hard non-outing ceiling
    }
    if (spec.t === 0) throws = 0;

    // Position players never carry a mound flag / pitch count (rule 7).
    const mound = isP ? spec.m : false;

    let distance = null;
    if (phaseId === 'ONRAMP' && spec.t > 0) {
      const idx = Math.min(ITP_LADDER.length - 1, Math.floor((weekInPhase - 1) / 1.2) + (key === 'LONGTOSS' ? 2 : 0));
      distance = `${ITP_LADDER[Math.max(0, Math.min(ITP_LADDER.length - 1, idx))]} ft`;
    } else if (key === 'LONGTOSS') {
      distance = isP ? '≤300 ft pulldown' : `150–${demand.dist || 250} ft`;
    } else if (['MOUND', 'LIVE', 'TOUCH'].includes(key) && isP) {
      distance = 'Mound 60\'6"';
    } else if (spec.t > 0) {
      distance = isP ? '60–120 ft' : (posId === 'OF' ? `150–${demand.dist} ft` : `≤${demand.dist} ft`);
    }

    // Pitch Smart HARD ceiling on live / mound / pen days (rule: never exceed).
    let ps = null;
    if (isP && (key === 'LIVE' || key === 'MOUND' || key === 'TOUCH')) {
      const base = pitchSmartByLevel(levelId, throws);
      const capped = base.max != null && throws > base.max;
      if (capped) throws = base.max;
      ps = pitchSmartByLevel(levelId, throws);
      ps.pitches = throws;
      ps.capped = capped;
    }

    return { day: days[i], code: key, label: spec.label, focus: spec.focus, intent, throws,
      mound, distance, su: Math.round(stressUnits(throws, intent || 1, mound)), ps };
  });

  // ---- ACWR auto-impact (rule 8): scale non-outing throwing volume into range. ----
  if (chronic && chronic > 0) {
    const acute = week.reduce((s, d) => s + d.su, 0);
    const acwr = acute / chronic;
    let scale = 1;
    if (acwr > phase.acwr[1]) scale = (phase.acwr[1] * chronic) / (acute || 1);           // too hot → trim
    else if (acwr < phase.acwr[0]) scale = Math.min(1.15, (phase.acwr[0] * chronic) / (acute || 1)); // too cold → nudge up
    scale = Math.max(0.5, Math.min(1.15, scale));
    if (Math.abs(scale - 1) > 0.02) {
      week.forEach((d) => {
        // Adjust throwing volume, but never touch a Pitch-Smart-governed outing
        // (LIVE / MOUND / TOUCH carry d.ps) — those counts are fixed & clamped.
        if (d.throws > 0 && !d.ps) {
          const scaled = ceiling != null && scale > 1 ? Math.min(ceiling, Math.round(d.throws * scale)) : Math.round(d.throws * scale);
          d.throws = Math.max(0, scaled);
          d.su = Math.round(stressUnits(d.throws, d.intent || 1, d.mound));
        }
      });
    }
  }

  return week;
}

/* Build an N-week (1-16) program of distinct microcycles with real progression:
   week-in-phase advances each week and a EWMA-rolling chronic drives ACWR waves. */
export function buildProgram({ levelId, posId, phaseId, typeId, mob, str, bio, ready, weekInPhase, weeks, chronic, bench }) {
  const N = Math.max(1, Math.min(16, weeks || 1));
  const out = [];
  let chronicRoll = chronic && chronic > 0 ? chronic : 0;
  for (let w = 1; w <= N; w += 1) {
    const wip = (weekInPhase || 1) + (w - 1);
    const wkDays = buildWeek({ levelId, posId, phaseId, typeId, mob, str, bio, ready,
      weekInPhase: wip, chronic: chronicRoll || undefined, bench });
    const acute = wkDays.reduce((s, d) => s + d.su, 0);
    const acwr = chronicRoll > 0 ? acute / chronicRoll : null;
    out.push({ week: w, weekInPhase: wip, days: wkDays, acute, acwr });
    // Roll chronic ~4-week EWMA so the following week's ACWR reflects accumulated load.
    chronicRoll = chronicRoll > 0 ? Math.round(chronicRoll * 0.75 + acute * 0.25) : acute;
  }
  return out;
}

/* ---------- Phase plan (mirrors hittingEngine.buildPhases) ---------- */
export const THROW_KIND_COLOR = {
  reintro: 'blue', build: 'green', extend: 'green', base: 'blue', velo: 'amber', peak: 'red',
  mound: 'amber', game: 'green', inseason: 'blue', deload: 'gray', shutdown: 'gray',
};
const THROW_PHASE_PLAN = {
  ONRAMP: [
    { kind: 'reintro', name: 'Re-introduction', focus: 'Light catch, tissue tolerance, restore range of motion.' },
    { kind: 'build', name: 'Volume build', focus: 'Extend distance & throw count toward the role\'s base volume.' },
    { kind: 'extend', name: 'Long-toss extension', focus: 'Add long toss / compression once the volume base is built.' },
  ],
  VELO: [
    { kind: 'base', name: 'Tolerant base', focus: 'Confirm volume tolerance before adding intent.' },
    { kind: 'velo', name: 'Velocity build', focus: 'High-intent days 90-100%: pulldowns, plyo-velo, mound velo.' },
    { kind: 'peak', name: 'Peak & express', focus: 'Express new arm speed; manage cumulative high-day load.' },
  ],
  PRESEASON: [
    { kind: 'reintro', name: 'Throwing re-entry', focus: '2-3x/wk at 50-75%, recovery between sessions.' },
    { kind: 'mound', name: 'Mound progression', focus: 'Add bullpens 2-3 days before live outings.' },
    { kind: 'game', name: 'Game readiness', focus: 'Build to outing pitch count; clear for competition.' },
  ],
  INSEASON: [
    { kind: 'inseason', name: 'In-season maintenance', focus: 'Hold velocity & command; one start + a controlled midweek pen.' },
  ],
  DELOAD: [{ kind: 'deload', name: 'Deload', focus: 'Dissipate fatigue; keep tissue tolerant, nothing max.' }],
  POSTSEASON: [{ kind: 'shutdown', name: 'Shutdown', focus: 'Taper to a mandated no-overhead-throwing block.' }],
};

export function buildThrowingPhases(phaseId, weeks) {
  const N = Math.max(1, Math.min(16, weeks || 1));
  const tmpl = THROW_PHASE_PLAN[phaseId] || THROW_PHASE_PLAN.VELO;
  const n = tmpl.length;
  if (N <= n) return tmpl.slice(0, N).map((p, i) => ({ ...p, span: [i + 1, i + 1] }));
  const per = Math.floor(N / n);
  let rem = N - per * n;
  const out = [];
  let w = 1;
  tmpl.forEach((p) => {
    const span = per + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    out.push({ ...p, span: [w, w + span - 1] });
    w += span;
  });
  return out;
}

/* Seed ~28 days of representative load so a chronic baseline is meaningful when
   no real throw history (Trackman) is available. */
export function seedLog() {
  const patT = [60, 0, 45, 70, 0, 85, 30];
  const patI = [70, 0, 65, 80, 0, 96, 55];
  const patM = [0, 0, 0, 0, 0, 1, 0];
  const out = [];
  for (let d = 27; d >= 0; d -= 1) {
    const k = d % 7;
    out.push({ id: `seed${d}`, dayAgo: d, throws: patT[k], intent: patI[k], mound: !!patM[k] });
  }
  return out;
}

/* --------------------------------------------------------------------------- *
 *  Serialization: microcycle day -> the app's relational program shape.
 *  training_exercises.category is a CHECK enum
 *  (hitting|pitching|fielding|conditioning|recovery|other) — block type is
 *  carried in the exercise NAME, not a new category.
 * --------------------------------------------------------------------------- */
function categoryForCode(code) {
  if (['MOUND', 'LIVE', 'TOUCH'].includes(code)) return 'pitching';
  if (['FIELD', 'THROWDOWN'].includes(code)) return 'fielding';
  if (['CARE', 'OFF'].includes(code)) return 'recovery';
  return 'conditioning'; // RECOVERY, LOW, MED, HIGH, HIGH_INTENT, VELO, LONGTOSS, PRE_THROW
}

/* Movement-prep block, biased by the mob/str/bio sliders (rule 10). */
function movementPrep(mob, str, bio) {
  const m = mob == null ? 70 : mob;
  const s = str == null ? 70 : str;
  const b = bio == null ? 70 : bio;
  const items = [MOVEMENT_PREP.general[0]];
  items.push(...(m < 60 ? MOVEMENT_PREP.mobility.slice(0, 3) : m < 75 ? MOVEMENT_PREP.mobility.slice(0, 2) : MOVEMENT_PREP.mobility.slice(0, 1)));
  items.push(...(s < 60 ? MOVEMENT_PREP.strength.slice(0, 2) : MOVEMENT_PREP.strength.slice(0, 1)));
  if (b < 60) items.push(...MOVEMENT_PREP.bio.slice(0, 2));
  else if (b < 75) items.push(MOVEMENT_PREP.bio[0]);
  return [...new Set(items)];
}

/* Plyo / drill block appropriate to the day type (rule 9). */
function plyoFor(code, isP, veloBad) {
  if (['VELO', 'HIGH_INTENT', 'HIGH'].includes(code)) {
    return { category: 'conditioning',
      name: veloBad ? 'Plyo / velo work (corrective — velocity below level)' : 'Plyo / velo work',
      items: PLYO_DRILL.velo.slice(0, veloBad ? 4 : 2) };
  }
  if (['RECOVERY', 'CARE'].includes(code)) return { category: 'recovery', name: 'Recovery plyos & arm care', items: PLYO_DRILL.recovery };
  if (code === 'LONGTOSS') return { category: 'conditioning', name: 'Arm-action / plyo drills',
    items: PLYO_DRILL.arm_action.slice(0, 2).concat(veloBad ? PLYO_DRILL.velo.slice(0, 1) : []) };
  if (['MOUND', 'TOUCH'].includes(code) && isP) return { category: 'pitching', name: 'Command / pen drills', items: PLYO_DRILL.command };
  if (code === 'LIVE' && isP) return { category: 'pitching', name: 'Compete — pre-outing prep', items: PLYO_DRILL.command.slice(0, 2) };
  if (['FIELD', 'THROWDOWN'].includes(code)) return { category: 'fielding', name: 'Defensive throwing drills', items: PLYO_DRILL.fielding };
  if (['LOW', 'MED', 'PRE_THROW'].includes(code)) return { category: 'conditioning', name: 'Throwing drills', items: PLYO_DRILL.arm_action.slice(0, 2) };
  return null;
}

/* Map a single built day -> one program day (structured exercise blocks). */
function dayToProgramDay(d, opts) {
  const o = opts || {};
  const veloBad = !!(o.bench && o.bench.velo && (o.bench.velo.status === 'def' || o.bench.velo.status === 'dev'));
  const bits = [d.focus];
  if (d.distance) bits.push(d.distance);
  if (d.intent > 0) bits.push(`${d.intent}% intent`);
  if (d.ps) bits.push(d.ps.capped ? `Pitch Smart: capped to ${d.ps.max}` : `Pitch Smart: ${d.ps.rest}d rest`);

  const ex = [];
  let so = 0;
  // 1) Movement prep on every active day (rule 10).
  if (d.code !== 'OFF') {
    ex.push({ category: 'recovery', name: 'Movement prep & mobility',
      description: movementPrep(o.mob, o.str, o.bio).join(' · '), reps: '8–12 min', sort_order: so });
    so += 1;
  }
  // 2) Main session block.
  let mainCat = categoryForCode(d.code);
  if (!o.isP && d.code === 'LIVE') mainCat = 'other'; // position-player game (at-bats), not pitching
  if (d.code === 'CARE') mainCat = 'recovery';
  ex.push({ category: mainCat, name: d.label, description: bits.join(' · '),
    reps: d.throws ? `${d.throws} throws` : '—', sort_order: so });
  so += 1;
  // 3) Plyo / drill block (rule 9).
  const pl = plyoFor(d.code, o.isP, veloBad);
  if (pl) {
    ex.push({ category: pl.category, name: pl.name, description: pl.items.join(' · '), reps: 'as prescribed', sort_order: so });
    so += 1;
  }

  return { title: `${d.day} — ${d.label}`, notes: d.focus, exercises: ex };
}

/**
 * Map a built week (array of 7 day objects from buildWeek) to program days.
 * Preserved single-week serializer; opts = { mob, str, bio, isP, bench }.
 * @returns {Array<{title, notes, exercises: Array<{category,name,description,reps,sort_order}>}>}
 */
export function weekToProgramDays(week, opts) {
  return week.map((d) => dayToProgramDay(d, opts));
}

/**
 * Multi-week serializer (rule 13). Emits rows with a 1-based ABSOLUTE calendar
 * day_number = (week-1)*7 + weekdayIndex + 1 (Mon=0..Sun=6). Pure OFF days are
 * skipped so the schedule lands sessions on the correct calendar days.
 * @param program output of buildProgram
 * @param opts { mob, str, bio, isP, bench }
 * @returns {Array<{day_number, title, notes, exercises}>}
 */
export function programToProgramDays(program, opts) {
  const rows = [];
  program.forEach((wk) => {
    wk.days.forEach((d, di) => {
      if (d.code === 'OFF') return; // skip pure off days
      const one = dayToProgramDay(d, opts);
      rows.push({
        day_number: (wk.week - 1) * 7 + di + 1,
        title: `Wk ${wk.week} · ${one.title}`,
        notes: one.notes,
        exercises: one.exercises,
      });
    });
  });
  return rows;
}
