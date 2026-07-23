/* ============================================================================
   scProgramEngine.js — Baseball Strength & Conditioning program generator.

   Dependency-free JavaScript engine. Conjugate PRINCIPLES (Max-Effort /
   Dynamic-Effort / Repetition rotation, accommodating resistance, med-ball /
   jump power) blended with a full explosive-lifting toolbox.

   ----------------------------------------------------------------------------
   2026 REWRITE — head-coach testing feedback. New rules (read before editing):

   1. PITCHERS ARE NO LONGER EXCLUDED from explosive / max-strength lifts.
      Being a pitcher is not, by itself, a reason to withhold Olympic lifts,
      heavy straight-bar bench, overhead press or their derivatives. Healthy,
      competent throwers receive the full toolbox to test & build force capacity.
      Guarding is now driven ONLY by:
        - genuine active injury flags (wrist / elbow / UCL / shoulder / labrum /
          TJ-surgery) — see injuryFlags() + per-exercise `contra` lists, and
        - movement-competency + maturity (PHV) gating for novices / youth.
      `allowFullOlympicLifts()` returns true for pitchers when healthy/competent.

   2. PRESSING VARIETY. Throwers get a real mix of pressing — barbell (bench,
      incline, OHP, close-grip), dumbbell, kettlebell, cable/machine and
      bodyweight. Upper days select MORE than one press (main + horizontal +
      vertical accessory presses). See ME_UPPER + PRESS pools + upperMeDay().

   3. ARM FARM. Dedicated arm / elbow hypertrophy & resilience: wrist & forearm
      FLEXORS and EXTENSORS (wrist curls, reverse curls, wrist roller, flexbar /
      Tyler-twist), TRICEPS, BICEPS, TRAPS (shrugs, carries) and elbow-specific
      work. See the ARM_FARM pool; several arm-farm movements are programmed on
      every upper / dynamic-upper day for throwers (cuff work stays via ARM_CARE).

   4. VOLUME. Session volume is ~3-4x the old engine — BOTH more movements per
      day (rich 7-12 movement lower / upper / dynamic days) AND more sets per
      movement (bumped accessory/main set counts in prescriptionFor).

   5. WEEKLY STRUCTURE + DAY TYPES.
        Off-season (accumulation/strength/power/pre-season/transition): 4 lifts —
          Lower (Mon), Upper (Tue), Dynamic-Effort Lower (Thu), DE Upper (Fri).
        In-season: 3 lifts — Lower (Mon), Upper (Tue), DE SPLIT (Thu).
      Day builders: lowerMeDay, upperMeDay, dynamicLowerDay, dynamicUpperDay,
      dynamicSplitDay. Every day carries a `weekday` index (Mon=0 … Sun=6).

   6. PROGRAM LENGTH 1-16 WEEKS w/ true week-over-week progression. generateProgram
      builds N distinct weeks over a lifting phase plan (accumulation → strength →
      power → peak) with an accumulation→intensification→deload wave every 4th
      week. programToProgramDays() serializes with day_number = 1-BASED ABSOLUTE
      CALENDAR-DAY OFFSET across the whole program: (week-1)*7 + weekday + 1.
      Rest days emit no rows. duration_weeks = N. (Fixes the schedule placement
      bug: the calendar drops each day at start_date + (day_number-1) days.)

   7. BENCHMARK-VS-DATA. gradeStrength() grades the athlete's force metrics
      (vertical / broad jump, relative squat & trap-bar deadlift) good/dev/def vs
      level benchmarks (SC_BM). strengthBias() turns that into an emphasis bias
      that shapes phase allocation & selection. Graceful when metrics are missing.

   8. PHASE PLAN. buildLiftingPhases() returns {kind,name,focus,span:[start,end]}
      across the selected length for a timeline display.

   SAFETY: real wrist/elbow/UCL/shoulder/labrum/TJ injuries still restrict the
   contraindicated lifts, and novices / pre-PHV athletes are still gated off
   maximal & Olympic loading. This is coaching decision support, not medical advice.
   ========================================================================== */

// Pitch Smart caps + required rest live in the shared module (one source of
// truth across both engines). Imported for internal use by armStatusNote and
// re-exported so existing importers of scProgramEngine keep working unchanged.
import { requiredRestDays, dailyPitchMax } from './pitchSmart';

export { requiredRestDays, dailyPitchMax } from './pitchSmart';

/* --------------------------------------------------------------------------- *
 *  Enumerations (plain string constants)
 * --------------------------------------------------------------------------- */
export const Position = {
  PITCHER: 'pitcher',
  POSITION: 'position_player',
  CATCHER: 'catcher',
  TWO_WAY: 'two_way',
};

export const Sex = { MALE: 'male', FEMALE: 'female' };

export const Phase = {
  TRANSITION: 'transition_active_rest',
  ACCUMULATION: 'off_season_accumulation',
  STRENGTH: 'off_season_max_strength',
  POWER: 'off_season_power',
  PRE_SEASON: 'pre_season',
  IN_SEASON: 'in_season',
};

export const PHASE_LABEL = {
  [Phase.TRANSITION]: 'Transition / Active Rest',
  [Phase.ACCUMULATION]: 'Off-Season Accumulation',
  [Phase.STRENGTH]: 'Off-Season Max Strength',
  [Phase.POWER]: 'Off-Season Power',
  [Phase.PRE_SEASON]: 'Pre-Season',
  [Phase.IN_SEASON]: 'In-Season',
};

export const Effort = {
  MAX_EFFORT: 'max_effort',
  DYNAMIC_EFFORT: 'dynamic_effort',
  REPETITION: 'repetition',
  POWER: 'power_expression',
  CORRECTIVE: 'corrective',
  ARM_CARE: 'arm_care',
  CONDITIONING: 'conditioning',
};

export const LoadStyle = { RPE: 'rpe', PERCENT: 'percent' };

// Lifting phase-plan colours (mirrors the hitting engine KIND_COLOR pattern).
export const SC_KIND_COLOR = {
  accumulation: 'cyan', strength: 'violet', power: 'amber', peak: 'green', inseason: 'blue', deload: 'gray',
};

// Weekday indices (Mon=0 … Sun=6) — used for day layout + absolute serialization.
const WD = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
const WD_NAME = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* --------------------------------------------------------------------------- *
 *  Small set helpers (equipment / targets are stored as string arrays)
 * --------------------------------------------------------------------------- */
function subsetOf(sub, sup) {
  const s = new Set(sup);
  return sub.every((x) => s.has(x));
}
function overlapCount(a, b) {
  const s = new Set(b);
  let n = 0;
  for (const x of a) if (s.has(x)) n += 1;
  return n;
}
function overlaps(a, b) {
  return overlapCount(a, b) > 0;
}

/* --------------------------------------------------------------------------- *
 *  Assessment — the input that actually drives selection.
 *  Fields left null/undefined = "not screened" -> conservatively assume the
 *  common thrower deficit exists (OPP thrower weakness profile).
 * --------------------------------------------------------------------------- */
export function makeAssessment(a = {}) {
  return {
    shoulder_er_dom: a.shoulder_er_dom ?? null,
    shoulder_ir_dom: a.shoulder_ir_dom ?? null,
    shoulder_ir_nondom: a.shoulder_ir_nondom ?? null,
    total_rom_deficit: a.total_rom_deficit ?? null,
    hip_ir_deg: a.hip_ir_deg ?? null,
    ankle_dorsiflexion_cm: a.ankle_dorsiflexion_cm ?? null,
    tspine_rotation_deg: a.tspine_rotation_deg ?? null,
    rel_squat: a.rel_squat ?? null,
    rel_trap_bar_dl: a.rel_trap_bar_dl ?? null,
    broad_jump_cm: a.broad_jump_cm ?? null,
    vertical_jump_cm: a.vertical_jump_cm ?? null,
    single_leg_stability: a.single_leg_stability ?? null, // "poor" | "fair" | "good"
    movement_competency: a.movement_competency ?? 'developing', // novice|developing|competent
  };
}

export function girdFlag(asm) {
  if (asm.shoulder_ir_dom == null || asm.shoulder_ir_nondom == null) return false;
  return asm.shoulder_ir_nondom - asm.shoulder_ir_dom >= 18.0;
}
export function totalRomFlag(asm) {
  return asm.total_rom_deficit != null && asm.total_rom_deficit >= 5.0;
}

export function weaknessTags(asm) {
  const tags = new Set();
  if (girdFlag(asm) || totalRomFlag(asm) || asm.shoulder_ir_dom == null) {
    tags.add('posterior_shoulder');
    tags.add('scap_upward_rotation');
  }
  if (asm.hip_ir_deg == null || asm.hip_ir_deg < 30) tags.add('hip_mobility');
  if (asm.ankle_dorsiflexion_cm == null || asm.ankle_dorsiflexion_cm < 10) tags.add('ankle_mobility');
  if (asm.tspine_rotation_deg == null || asm.tspine_rotation_deg < 45) tags.add('tspine_rotation');
  if (asm.single_leg_stability == null || asm.single_leg_stability === 'poor' || asm.single_leg_stability === 'fair') {
    tags.add('glute_ham');
    tags.add('single_leg_stability');
  }
  // Rotational power is the sport quality — always trained.
  tags.add('rotational_power');
  tags.add('anti_rotation_core');
  return tags;
}

/* --------------------------------------------------------------------------- *
 *  Athlete — normalize input + expose derived state.
 * --------------------------------------------------------------------------- */
export function makeAthlete(a = {}) {
  const at = {
    name: a.name ?? 'Athlete',
    chrono_age: a.chrono_age ?? 16,
    height_cm: a.height_cm ?? null,
    weight_kg: a.weight_kg ?? null,
    position: a.position ?? Position.POSITION,
    sex: a.sex ?? Sex.MALE,
    training_age_months: a.training_age_months ?? 0,
    injury_history: a.injury_history ?? [],
    equipment: a.equipment ?? ['barbell', 'dumbbell', 'bands', 'medball'],
    assessment: makeAssessment(a.assessment ?? {}),
    league_age: a.league_age ?? null,
    throws_per_week: a.throws_per_week ?? 0,
    recent_game_pitch_count: a.recent_game_pitch_count ?? 0,
  };
  if (at.league_age == null) at.league_age = Math.round(at.chrono_age);
  return at;
}

export const trainingAgeYears = (ath) => ath.training_age_months / 12.0;
export const isThrower = (ath) =>
  [Position.PITCHER, Position.TWO_WAY, Position.CATCHER].includes(ath.position);
export const isPitcher = (ath) => [Position.PITCHER, Position.TWO_WAY].includes(ath.position);

export function trainingStage(ath) {
  if (ath.training_age_months < 6 || ath.chrono_age < 13) return 'novice';
  if (ath.training_age_months < 24 || ath.chrono_age < 15) return 'intermediate';
  return 'advanced';
}

export function maturityBand(ath) {
  // Coarse PHV proxy from chronological age + sex. Females mature ~1.5-2y earlier.
  const pre = ath.sex === Sex.MALE ? 11 : 9.5;
  const circaEnd = ath.sex === Sex.MALE ? 15 : 13.5;
  if (ath.chrono_age < pre) return 'pre_phv';
  if (ath.chrono_age <= circaEnd) return 'circa_phv';
  return 'post_phv';
}

export function allowMaximalTesting(ath) {
  if (trainingStage(ath) === 'novice') return false;
  if (ath.chrono_age < 15) return false;
  if (maturityBand(ath) === 'circa_phv') return false;
  return ath.assessment.movement_competency === 'competent';
}

export const loadStyle = (ath) => (allowMaximalTesting(ath) ? LoadStyle.PERCENT : LoadStyle.RPE);

// Normalize injury_history into a set of guard keys the engine acts on.
export function injuryFlags(ath) {
  const flags = new Set();
  const keys = ['wrist', 'elbow', 'ucl', 'shoulder', 'labrum', 'tj'];
  (ath.injury_history || []).forEach((inj) => {
    const s = String(inj).toLowerCase();
    keys.forEach((k) => { if (s.includes(k)) flags.add(k); });
  });
  return flags;
}

/**
 * Full Olympic lifts (cleans / snatches / jerks + full-catch derivatives).
 * NOTE (2026 rewrite): being a PITCHER is no longer a disqualifier — healthy,
 * competent, post-/circa-PHV throwers get the full toolbox. Gating is now:
 *   - not a novice (training stage),
 *   - movement competency = competent,
 *   - not pre-PHV (rack/catch axial + wrist demand on immature athletes),
 *   - no active wrist/elbow/UCL/TJ injury (the catch loads exactly those),
 *   - barbell available.
 */
export function allowFullOlympicLifts(ath) {
  if (trainingStage(ath) === 'novice') return false;
  if (ath.assessment.movement_competency !== 'competent') return false;
  if (maturityBand(ath) === 'pre_phv') return false;
  const hurt = injuryFlags(ath);
  if (hurt.has('wrist') || hurt.has('elbow') || hurt.has('ucl') || hurt.has('tj')) return false;
  return ath.equipment.includes('barbell');
}

/* --------------------------------------------------------------------------- *
 *  Benchmark grading — force/power metrics vs level (mirrors hittingEngine BM).
 * --------------------------------------------------------------------------- */
export const SC_LEVELS = ['youth', 'middleschool', 'hs', 'college', 'pro'];
export const SC_LEVEL_NAME = {
  youth: 'Youth (≤12)', middleschool: 'Middle school (13–14)', hs: 'High school',
  college: 'College', pro: 'Pro / MiLB',
};

export function scLevelFromAge(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return 'hs';
  if (a < 13) return 'youth';
  if (a < 15) return 'middleschool';
  if (a < 19) return 'hs';
  if (a < 23) return 'college';
  return 'pro';
}

// dir 'up': dev = [lower, upper), good = target. Grades good / dev / def.
export const SC_BM = {
  vertical_jump_cm: { unit: 'cm', by: {
    youth: { dev: [35, 45], good: 45 }, middleschool: { dev: [40, 50], good: 50 }, hs: { dev: [50, 60], good: 60 },
    college: { dev: [58, 68], good: 68 }, pro: { dev: [64, 74], good: 74 } } },
  broad_jump_cm: { unit: 'cm', by: {
    youth: { dev: [180, 210], good: 210 }, middleschool: { dev: [200, 230], good: 230 }, hs: { dev: [230, 260], good: 260 },
    college: { dev: [260, 290], good: 290 }, pro: { dev: [285, 315], good: 315 } } },
  rel_squat: { unit: '× BW', by: {
    youth: { dev: [0.8, 1.2], good: 1.2 }, middleschool: { dev: [1.0, 1.5], good: 1.5 }, hs: { dev: [1.4, 1.9], good: 1.9 },
    college: { dev: [1.8, 2.2], good: 2.2 }, pro: { dev: [2.0, 2.5], good: 2.5 } } },
  rel_trap_bar_dl: { unit: '× BW', by: {
    youth: { dev: [1.0, 1.4], good: 1.4 }, middleschool: { dev: [1.3, 1.8], good: 1.8 }, hs: { dev: [1.7, 2.2], good: 2.2 },
    college: { dev: [2.1, 2.6], good: 2.6 }, pro: { dev: [2.4, 2.8], good: 2.8 } } },
};

// Force/power metric catalog (key, label) for the UI benchmark bars.
export const SC_METRICS = [
  { key: 'vertical_jump_cm', label: 'Vertical jump' },
  { key: 'broad_jump_cm', label: 'Broad jump' },
  { key: 'rel_squat', label: 'Back squat (× BW)' },
  { key: 'rel_trap_bar_dl', label: 'Trap-bar deadlift (× BW)' },
];

function gradeUp(v, dev, good) { if (v >= good) return 'good'; if (v >= dev[0]) return 'dev'; return 'def'; }

export function scStatusOf(key, v, level) {
  if (v == null || Number.isNaN(v)) return null;
  const bm = SC_BM[key];
  if (!bm) return null;
  const b = bm.by[level] || bm.by.hs;
  return { status: gradeUp(v, b.dev, b.good), value: v, dev: b.dev, good: b.good, dir: 'up', unit: bm.unit };
}

// Grade whatever force metrics were screened. Missing metrics simply omitted.
export function gradeStrength(assessment, level) {
  const S = {};
  SC_METRICS.forEach(({ key }) => {
    const s = scStatusOf(key, assessment[key], level);
    if (s) S[key] = s;
  });
  return S;
}

// Turn the benchmark grades into a selection/phase bias. Graceful when empty.
export function strengthBias(grades) {
  const vals = Object.values(grades || {});
  if (!vals.length) return 'balanced';
  const def = vals.filter((s) => s.status === 'def').length;
  const good = vals.filter((s) => s.status === 'good').length;
  if (def >= 1 && def >= good) return 'build_strength';
  if (good === vals.length) return 'express_power';
  return 'balanced';
}

export const BIAS_LABEL = {
  build_strength: 'Force output trails level — plan biased toward strength & hypertrophy accumulation.',
  express_power: 'Strength base is on-level — plan biased toward power / speed-strength expression.',
  balanced: 'Balanced strength profile — standard accumulation → strength → power progression.',
};

/* --------------------------------------------------------------------------- *
 *  Exercise library — tagged so the engine can select intelligently.
 *
 *  thrower_risk: 0 safe / encouraged, 1 caution (cap volume, dropped in
 *  low-volume windows), 2 high-stress press (dropped ONLY for novice competency
 *  or a relevant injury — NOT for being a pitcher).
 *  contra: injury keys (wrist/elbow/ucl/shoulder/labrum/tj) that remove the lift
 *  for anyone carrying that flag.
 *  is_olympic_full: gated behind allowFullOlympicLifts().
 * --------------------------------------------------------------------------- */
function ex(name, effort, opts = {}) {
  return {
    name,
    effort,
    thrower_risk: opts.thrower_risk ?? 0,
    equipment: opts.equipment ?? ['barbell'],
    targets: opts.targets ?? [],
    contra: opts.contra ?? [],
    accommodating_resistance: opts.accommodating_resistance ?? false,
    min_training_stage: opts.min_training_stage ?? 'novice',
    is_olympic_full: opts.is_olympic_full ?? false,
    unilateral: opts.unilateral ?? false,
    note: opts.note ?? '',
  };
}

const STAGE_RANK = { novice: 0, intermediate: 1, advanced: 2 };
export const stageOk = (exercise, athleteStage) =>
  STAGE_RANK[athleteStage] >= STAGE_RANK[exercise.min_training_stage];

const ME_LOWER = [
  ex('Safety-Bar Box Squat', Effort.MAX_EFFORT, {
    equipment: ['ssb', 'box'], targets: ['glute_ham'],
    accommodating_resistance: true, min_training_stage: 'intermediate',
    note: 'Box teaches hip loading, protects knees; SSB is shoulder-friendly.',
  }),
  ex('Trap-Bar Deadlift', Effort.MAX_EFFORT, {
    equipment: ['trapbar'], targets: ['glute_ham'], accommodating_resistance: true,
    note: 'Most spine-friendly heavy pull; great novice ME entry.',
  }),
  ex('Back Squat (high-bar)', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['glute_ham'], min_training_stage: 'intermediate',
    note: 'Foundational bilateral squat strength.',
  }),
  ex('Front Squat', Effort.MAX_EFFORT, {
    thrower_risk: 1, equipment: ['barbell'], min_training_stage: 'intermediate',
    note: 'Front-rack wrist/shoulder demand — sub goblet if restricted.',
  }),
  ex('Conventional Deadlift', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['glute_ham'], accommodating_resistance: true,
    min_training_stage: 'intermediate', note: 'Heavy posterior-chain pull.',
  }),
  ex('Sumo Deadlift', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['glute_ham'], min_training_stage: 'intermediate',
    note: 'Shorter ROM, more upright torso — hip-dominant heavy pull.',
  }),
  ex('SSB Front-Foot-Elevated Split Squat', Effort.MAX_EFFORT, {
    equipment: ['ssb', 'dumbbell'], targets: ['glute_ham', 'single_leg_stability'],
    min_training_stage: 'intermediate', unilateral: true,
  }),
  ex('Cambered-Bar Good Morning', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['glute_ham'], accommodating_resistance: true,
    min_training_stage: 'advanced', note: 'Posterior-chain ME; strict form, advanced only.',
  }),
  ex('Belt Squat', Effort.MAX_EFFORT, {
    equipment: ['belt_squat'], targets: ['glute_ham'], min_training_stage: 'intermediate',
    note: 'Spine-unloaded squat pattern — great for high-throwing-volume weeks.',
  }),
  ex('Pause Back Squat', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['glute_ham'], min_training_stage: 'advanced',
    note: 'Kills the stretch reflex — builds starting strength out of the hole.',
  }),
];

const ME_UPPER = [
  // Heavy barbell bench — INCLUDED for healthy throwers (removed only on
  // shoulder/labrum injury or novice competency).
  ex('Barbell Bench Press (heavy straight bar)', Effort.MAX_EFFORT, {
    thrower_risk: 2, equipment: ['barbell'], targets: ['horizontal_press'],
    min_training_stage: 'intermediate', contra: ['shoulder', 'labrum'],
    note: 'Primary horizontal-press strength; tuck elbows, control ROM.',
  }),
  ex('Close-Grip Bench Press', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['horizontal_press', 'triceps'],
    min_training_stage: 'intermediate', contra: ['shoulder', 'labrum'],
    note: 'Triceps-biased press; friendlier shoulder angle than wide grip.',
  }),
  ex('Incline Barbell Bench Press', Effort.MAX_EFFORT, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['horizontal_press', 'vertical_press'],
    min_training_stage: 'intermediate', contra: ['shoulder', 'labrum'],
    note: 'Upper-chest / anterior-delt strength at a moderate overhead angle.',
  }),
  ex('Standing Barbell Overhead Press', Effort.MAX_EFFORT, {
    thrower_risk: 2, equipment: ['barbell'], targets: ['vertical_press'],
    min_training_stage: 'intermediate', contra: ['shoulder', 'labrum'],
    note: 'Overhead pressing strength & scap control — included for healthy throwers.',
  }),
  ex('Neutral-Grip DB Floor Press', Effort.MAX_EFFORT, {
    equipment: ['dumbbell'], targets: ['horizontal_press'],
    note: 'Floor limits shoulder extension -> protects anterior capsule.',
  }),
  ex('Football-Bar Floor Press', Effort.MAX_EFFORT, {
    thrower_risk: 1, equipment: ['football_bar'], targets: ['horizontal_press'],
    min_training_stage: 'intermediate', note: 'Neutral grip reduces shoulder stress vs straight bar.',
  }),
  ex('Landmine Press', Effort.MAX_EFFORT, {
    equipment: ['landmine'], targets: ['vertical_press', 'scap_upward_rotation'],
    note: 'Scap-friendly vertical-ish press; safe overhead alternative.',
  }),
  ex('Weighted Chin-Up (ME pull)', Effort.MAX_EFFORT, {
    equipment: ['pullup_bar'], targets: ['posterior_shoulder'], min_training_stage: 'intermediate',
    note: 'Upper-body ME emphasis via pulling for throwers (balance the ratio).',
  }),
  ex('Weighted Pull-Up (ME pull)', Effort.MAX_EFFORT, {
    equipment: ['pullup_bar'], targets: ['posterior_shoulder'], min_training_stage: 'intermediate',
    note: 'Pronated heavy pull — keep pull volume ≥ press volume for throwers.',
  }),
];

// Accessory press variety (DB / KB / cable / bodyweight) — #2.
const PRESS = [
  ex('Flat DB Bench Press', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['horizontal_press'] }),
  ex('Incline DB Bench Press', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['horizontal_press', 'vertical_press'] }),
  ex('Neutral-Grip DB Incline Press', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['horizontal_press'] }),
  ex('Seated DB Shoulder Press', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['vertical_press'] }),
  ex('Half-Kneeling 1-Arm DB Overhead Press', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['vertical_press', 'anti_rotation_core'], unilateral: true,
  }),
  ex('Standing KB Overhead Press', Effort.REPETITION, { equipment: ['kettlebells'], targets: ['vertical_press'] }),
  ex('Double-KB Floor Press', Effort.REPETITION, { equipment: ['kettlebells'], targets: ['horizontal_press'] }),
  ex('KB Z-Press', Effort.REPETITION, { equipment: ['kettlebells'], targets: ['vertical_press'], min_training_stage: 'intermediate' }),
  ex('Cable Chest Press', Effort.REPETITION, { equipment: ['cable_machine'], targets: ['horizontal_press'] }),
  ex('Chest-Press Machine', Effort.REPETITION, { equipment: ['cable_machine'], targets: ['horizontal_press'] }),
  ex('Weighted Push-Up', Effort.REPETITION, { equipment: [], targets: ['horizontal_press'] }),
  ex('TRX / Ring Push-Up', Effort.REPETITION, { equipment: ['trx_band'], targets: ['horizontal_press', 'scap_upward_rotation'] }),
  ex('Weighted Dip', Effort.REPETITION, { equipment: [], targets: ['horizontal_press', 'triceps'], min_training_stage: 'intermediate', contra: ['shoulder', 'labrum'] }),
  ex('Landmine 1-Arm Press', Effort.REPETITION, { equipment: ['landmine'], targets: ['vertical_press', 'scap_upward_rotation'], unilateral: true }),
];

const PULL = [
  ex('Chest-Supported DB Row', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['posterior_shoulder'] }),
  ex('1-Arm DB Row', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['posterior_shoulder'], unilateral: true }),
  ex('Pull-Up / Chin-Up', Effort.REPETITION, { equipment: ['pullup_bar'], targets: ['posterior_shoulder'] }),
  ex('Lat Pulldown', Effort.REPETITION, { equipment: ['cable_machine'], targets: ['posterior_shoulder'] }),
  ex('Seated Cable Row', Effort.REPETITION, { equipment: ['cable_machine'], targets: ['posterior_shoulder', 'scap_upward_rotation'] }),
  ex('Inverted Row', Effort.REPETITION, { equipment: ['trx_band'], targets: ['posterior_shoulder', 'scap_upward_rotation'] }),
  ex('Meadows Row', Effort.REPETITION, { equipment: ['landmine'], targets: ['posterior_shoulder'], unilateral: true, min_training_stage: 'intermediate' }),
  ex('Face Pull', Effort.REPETITION, { equipment: ['bands'], targets: ['posterior_shoulder', 'scap_upward_rotation'] }),
  ex('Band Pull-Apart', Effort.REPETITION, { equipment: ['bands'], targets: ['scap_upward_rotation', 'posterior_shoulder'] }),
  ex('Prone Trap Raise (Y/T)', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['scap_upward_rotation', 'posterior_shoulder'] }),
];

const LOWER_ACC = [
  ex('Rear-Foot-Elevated Split Squat', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['single_leg_stability', 'glute_ham'], unilateral: true }),
  ex('Walking Lunge', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['single_leg_stability'], unilateral: true }),
  ex('Reverse Lunge', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['single_leg_stability', 'glute_ham'], unilateral: true }),
  ex('Dumbbell Step-Up', Effort.REPETITION, { equipment: ['dumbbell', 'box'], targets: ['single_leg_stability'], unilateral: true }),
  ex('Goblet Squat', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['glute_ham'] }),
  ex('Barbell RDL', Effort.REPETITION, { equipment: ['barbell'], targets: ['glute_ham'] }),
  ex('Single-Leg RDL', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['glute_ham', 'single_leg_stability'], unilateral: true }),
  ex('Barbell Hip Thrust', Effort.REPETITION, { equipment: ['barbell'], targets: ['glute_ham'] }),
  ex('Nordic / Razor Curl', Effort.REPETITION, { equipment: [], targets: ['glute_ham'], min_training_stage: 'intermediate' }),
  ex('Glute-Ham Raise', Effort.REPETITION, { equipment: [], targets: ['glute_ham'] }),
  ex('Seated Leg Curl', Effort.REPETITION, { equipment: ['leg_machines'], targets: ['glute_ham'] }),
  ex('Reverse Hyper', Effort.REPETITION, { equipment: ['leg_machines'], targets: ['glute_ham'] }),
  ex('Belt-Squat March', Effort.REPETITION, { equipment: ['belt_squat'], targets: ['single_leg_stability'] }),
  ex('Sled Push', Effort.REPETITION, { equipment: ['sled'], targets: ['single_leg_stability'] }),
];

const DE_LOWER = [
  ex('Speed Box Squat (bands)', Effort.DYNAMIC_EFFORT, {
    equipment: ['barbell', 'box', 'bands'], targets: ['glute_ham'],
    accommodating_resistance: true, min_training_stage: 'intermediate',
  }),
  ex('Trap-Bar Speed Pull (chains)', Effort.DYNAMIC_EFFORT, {
    equipment: ['trapbar', 'chains'], targets: ['glute_ham'], accommodating_resistance: true,
  }),
  ex('Speed Deadlift (bands)', Effort.DYNAMIC_EFFORT, {
    equipment: ['barbell', 'bands'], targets: ['glute_ham'], accommodating_resistance: true, min_training_stage: 'intermediate',
  }),
  ex('Dynamic Reverse Lunge (DB)', Effort.DYNAMIC_EFFORT, {
    equipment: ['dumbbell'], targets: ['single_leg_stability', 'glute_ham'], unilateral: true,
  }),
  ex('Jump Squat (light)', Effort.DYNAMIC_EFFORT, { equipment: ['barbell'], targets: ['glute_ham'], min_training_stage: 'intermediate' }),
  ex('Band-Resisted Hip Thrust', Effort.DYNAMIC_EFFORT, { equipment: ['barbell', 'bands'], targets: ['glute_ham'], accommodating_resistance: true }),
  ex('KB Swing', Effort.DYNAMIC_EFFORT, { equipment: ['kettlebells'], targets: ['glute_ham'] }),
];

const DE_UPPER = [
  ex('Speed Landmine Press (band)', Effort.DYNAMIC_EFFORT, {
    equipment: ['landmine', 'bands'], targets: ['vertical_press', 'scap_upward_rotation'],
  }),
  ex('Explosive Feet-Up DB Floor Press', Effort.DYNAMIC_EFFORT, { equipment: ['dumbbell'], targets: ['horizontal_press'] }),
  ex('Speed Bench Press (bands)', Effort.DYNAMIC_EFFORT, {
    equipment: ['barbell', 'bands'], targets: ['horizontal_press'], accommodating_resistance: true,
    min_training_stage: 'intermediate', contra: ['shoulder', 'labrum'],
  }),
  ex('Plyometric Push-Up', Effort.DYNAMIC_EFFORT, { equipment: [], targets: ['horizontal_press'] }),
  ex('DB Push Press (speed)', Effort.DYNAMIC_EFFORT, { equipment: ['dumbbell'], targets: ['vertical_press'] }),
  ex('Speed KB Push Press', Effort.DYNAMIC_EFFORT, { equipment: ['kettlebells'], targets: ['vertical_press'] }),
  ex('Band-Resisted Row (speed)', Effort.DYNAMIC_EFFORT, { equipment: ['bands'], targets: ['posterior_shoulder'] }),
];

const POWER = [
  ex('Rotational Med-Ball Scoop Toss', Effort.POWER, {
    equipment: ['medball'], targets: ['rotational_power'],
    note: 'Primary sport-power driver; trains the throw/swing pattern.',
  }),
  ex('Overhead Med-Ball Slam', Effort.POWER, { equipment: ['medball'], targets: ['rotational_power'] }),
  ex('Rotational Med-Ball Shotput', Effort.POWER, { equipment: ['medball'], targets: ['rotational_power'] }),
  ex('Med-Ball Chest Pass', Effort.POWER, { equipment: ['medball'], targets: ['horizontal_press'] }),
  ex('Seated Box Jump (soft landing)', Effort.POWER, {
    equipment: ['box'], note: 'Concentric-biased jump; low landing stress — Conjugate-U staple.',
  }),
  ex('Broad Jump', Effort.POWER, { equipment: [], targets: ['glute_ham'] }),
  ex('Vertical Jump', Effort.POWER, { equipment: [], targets: ['glute_ham'] }),
  ex('Depth Jump', Effort.POWER, { equipment: ['box'], min_training_stage: 'intermediate', note: 'Reactive-strength plyo; keep ground-contact short.' }),
  ex('Trap-Bar Jump', Effort.POWER, { equipment: ['trapbar'], targets: ['triple_extension'], min_training_stage: 'intermediate' }),
  ex('Hang High-Pull (oly derivative)', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'intermediate',
    note: 'Triple-extension power without the front-rack catch.',
  }),
  ex('Clean Pull', Effort.POWER, { equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'intermediate', note: 'Explosive extension, no catch — high force output.' }),
  ex('Snatch Pull', Effort.POWER, { equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'intermediate', note: 'Wide-grip explosive pull, no overhead catch.' }),
  ex('Mid-Thigh Pull', Effort.POWER, { equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'intermediate', note: 'Peak-power position pull; joint-friendly.' }),
  ex('Push Press', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension', 'vertical_press'], min_training_stage: 'intermediate',
    contra: ['shoulder', 'labrum'], note: 'Leg-driven overhead power.',
  }),
  ex('Dumbbell Snatch', Effort.POWER, { equipment: ['dumbbell'], targets: ['triple_extension'], min_training_stage: 'intermediate', unilateral: true, note: 'Full-body power, self-limiting load.' }),
  ex('Kettlebell Swing (power)', Effort.POWER, { equipment: ['kettlebells'], targets: ['glute_ham', 'triple_extension'], note: 'Ballistic hip extension.' }),
  // ---- Full-catch Olympic lifts — gated by allowFullOlympicLifts() (pitchers
  // now eligible when healthy + competent), plus injury contra on the catch. ----
  ex('Hang Power Clean (full catch)', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'advanced', is_olympic_full: true,
    contra: ['wrist', 'elbow', 'ucl', 'tj'], note: 'Triple-extension + front-rack catch.',
  }),
  ex('Power Clean (from floor)', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'advanced', is_olympic_full: true,
    contra: ['wrist', 'elbow', 'ucl', 'tj'], note: 'Full clean — maximal rate of force development.',
  }),
  ex('Hang Power Snatch', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'advanced', is_olympic_full: true,
    contra: ['wrist', 'elbow', 'ucl', 'tj', 'shoulder', 'labrum'], note: 'Overhead catch — high wrist/shoulder demand.',
  }),
  ex('Power Snatch (full)', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension'], min_training_stage: 'advanced', is_olympic_full: true,
    contra: ['wrist', 'elbow', 'ucl', 'tj', 'shoulder', 'labrum'], note: 'Fastest bar-speed lift; clean overhead needed.',
  }),
  ex('Push Jerk', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension', 'vertical_press'], min_training_stage: 'advanced', is_olympic_full: true,
    contra: ['wrist', 'elbow', 'shoulder', 'labrum'], note: 'Overhead catch under speed.',
  }),
  ex('Split Jerk', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], targets: ['triple_extension', 'vertical_press'], min_training_stage: 'advanced', is_olympic_full: true,
    contra: ['wrist', 'elbow', 'shoulder', 'labrum'], note: 'Maximal overhead power expression.',
  }),
];

// General accessory pool (kept for backward compatibility / ALL_POOLS export).
const REPETITION = [
  ex('Rear-Foot-Elevated Split Squat', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['single_leg_stability', 'glute_ham'], unilateral: true,
  }),
  ex('Nordic / Razor Curl', Effort.REPETITION, {
    equipment: [], targets: ['glute_ham'], min_training_stage: 'intermediate',
  }),
  ex('Hip Thrust', Effort.REPETITION, { equipment: ['barbell'], targets: ['glute_ham'] }),
  ex('Chest-Supported Row', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['posterior_shoulder'] }),
  ex('1-Arm DB Row', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['posterior_shoulder'], unilateral: true }),
  ex('Prone Trap Raise (Y/T)', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['scap_upward_rotation', 'posterior_shoulder'] }),
  ex('Face Pull', Effort.REPETITION, { equipment: ['bands'], targets: ['posterior_shoulder', 'scap_upward_rotation'] }),
];

// #3 — Arm Farm: forearm flexors/extensors, wrist, triceps, biceps, traps, elbow.
const ARM_FARM = [
  ex('EZ / Barbell Curl', Effort.REPETITION, { equipment: ['barbell'], targets: ['biceps'] }),
  ex('Incline DB Curl', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['biceps'] }),
  ex('Hammer Curl', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['biceps', 'forearm_flexor'] }),
  ex('Zottman Curl', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['biceps', 'forearm_extensor'] }),
  ex('Reverse Curl', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['forearm_extensor', 'biceps'] }),
  ex('Wrist Curl (flexion)', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['forearm_flexor', 'wrist'] }),
  ex('Reverse Wrist Curl (extension)', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['forearm_extensor', 'wrist'] }),
  ex('Wrist Roller', Effort.REPETITION, { equipment: [], targets: ['forearm_flexor', 'forearm_extensor', 'grip'] }),
  ex('Flexbar / Tyler Twist', Effort.ARM_CARE, { equipment: [], targets: ['forearm_flexor', 'forearm_extensor', 'elbow'], note: 'Eccentric wrist load — elbow-tendon resilience (Tyler protocol).' }),
  ex('Rice-Bucket Digs', Effort.ARM_CARE, { equipment: [], targets: ['forearm_flexor', 'forearm_extensor', 'grip'] }),
  ex('Triceps Pushdown', Effort.REPETITION, { equipment: ['cable_machine'], targets: ['triceps'] }),
  ex('Overhead Cable Triceps Extension', Effort.REPETITION, { equipment: ['cable_machine'], targets: ['triceps'] }),
  ex('DB Overhead Triceps Extension', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['triceps'] }),
  ex('Close-Grip Push-Up', Effort.REPETITION, { equipment: [], targets: ['triceps', 'horizontal_press'] }),
  ex('Barbell Shrug', Effort.REPETITION, { equipment: ['barbell'], targets: ['traps'] }),
  ex('DB Shrug', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['traps'] }),
  ex('Trap-Bar Farmer Carry', Effort.REPETITION, { equipment: ['trapbar'], targets: ['traps', 'grip'] }),
  ex('Suitcase Carry', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['traps', 'grip'], unilateral: true }),
  ex('Band Pronation / Supination', Effort.ARM_CARE, { equipment: ['bands'], targets: ['forearm_flexor', 'elbow'] }),
  ex('Wrist Radial / Ulnar Deviation', Effort.ARM_CARE, { equipment: ['bands'], targets: ['wrist', 'elbow'] }),
];

const ARM_CARE = [
  ex('Prone External Rotation (light)', Effort.ARM_CARE, { equipment: ['dumbbell'], targets: ['posterior_shoulder'] }),
  ex('Band ER at 90/90', Effort.ARM_CARE, { equipment: ['bands'], targets: ['posterior_shoulder'] }),
  ex('Rhythmic Stabilizations', Effort.ARM_CARE, { equipment: [], targets: ['posterior_shoulder'] }),
  ex('Forearm Flexor/Extensor Eccentrics', Effort.ARM_CARE, { equipment: ['dumbbell'], targets: ['forearm_flexor', 'forearm_extensor'] }),
  ex('Serratus Wall Punch', Effort.ARM_CARE, { equipment: ['bands'], targets: ['scap_upward_rotation'] }),
  ex('Bottoms-Up KB Carry', Effort.ARM_CARE, { equipment: ['kettlebells'], targets: ['posterior_shoulder', 'scap_upward_rotation'] }),
  ex('Prone Y-T-W Raise', Effort.ARM_CARE, { equipment: ['dumbbell'], targets: ['scap_upward_rotation', 'posterior_shoulder'] }),
];

const CORE = [
  ex('Pallof Press', Effort.REPETITION, { equipment: ['bands'], targets: ['anti_rotation_core'] }),
  ex('Half-Kneeling Cable Chop/Lift', Effort.REPETITION, { equipment: ['bands'], targets: ['anti_rotation_core', 'rotational_power'] }),
  ex('Suitcase Carry', Effort.REPETITION, { equipment: ['dumbbell'], targets: ['anti_rotation_core'], unilateral: true }),
  ex('Hanging Leg Raise', Effort.REPETITION, { equipment: ['pullup_bar'], targets: ['anti_rotation_core'] }),
  ex('Ab-Wheel Rollout', Effort.REPETITION, { equipment: [], targets: ['anti_rotation_core'], min_training_stage: 'intermediate' }),
  ex('Landmine Rotation', Effort.REPETITION, { equipment: ['landmine'], targets: ['rotational_power', 'anti_rotation_core'] }),
  ex('Dead Bug', Effort.REPETITION, { equipment: [], targets: ['anti_rotation_core'] }),
];

const CORRECTIVE = [
  ex('Sleeper / Cross-Body Stretch', Effort.CORRECTIVE, {
    equipment: [], targets: ['posterior_shoulder'],
    note: 'Only if GIRD present and pain-free; go gently.',
  }),
  ex('Wall Slides w/ Lift-Off', Effort.CORRECTIVE, { equipment: ['bands'], targets: ['scap_upward_rotation'] }),
  ex('90/90 Hip Switch', Effort.CORRECTIVE, { equipment: [], targets: ['hip_mobility'] }),
  ex('Knee-to-Wall Ankle Mob', Effort.CORRECTIVE, { equipment: [], targets: ['ankle_mobility'] }),
  ex('Half-Kneeling T-Spine Rotation', Effort.CORRECTIVE, { equipment: [], targets: ['tspine_rotation'] }),
];

export const ALL_POOLS = {
  ME_LOWER, ME_UPPER, DE_LOWER, DE_UPPER, POWER, REPETITION, CORRECTIVE, ARM_CARE, CORE,
  PRESS, PULL, LOWER_ACC, ARM_FARM,
};

// Tag sets reused by the day builders.
const ARM_TAGS = new Set(['forearm_flexor', 'forearm_extensor', 'wrist', 'grip', 'triceps', 'biceps', 'traps', 'elbow']);
const POST_TAGS = new Set(['posterior_shoulder', 'scap_upward_rotation']);
const GLUTE_TAGS = new Set(['glute_ham']);
const SL_TAGS = new Set(['single_leg_stability']);
const ROT_TAGS = new Set(['rotational_power']);
const ANTIROT_TAGS = new Set(['rotational_power', 'anti_rotation_core']);
const TRIPLE_TAGS = new Set(['triple_extension']);
const OH_EXPLOSIVE_TAGS = new Set(['triple_extension', 'vertical_press']);

/* --------------------------------------------------------------------------- *
 *  Periodization — calendar -> phase, phase -> load prescription, Pitch Smart.
 * --------------------------------------------------------------------------- */
function daysBetween(a, b) {
  return (a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

export function phaseForDate(date, seasonStart, seasonEnd) {
  if (date >= seasonStart && date <= seasonEnd) return Phase.IN_SEASON;
  if (date > seasonEnd) {
    const weeksSinceEnd = daysBetween(date, seasonEnd) / 7.0;
    return weeksSinceEnd <= 3 ? Phase.TRANSITION : Phase.ACCUMULATION;
  }
  const weeksToStart = daysBetween(seasonStart, date) / 7.0;
  if (weeksToStart <= 1) return Phase.PRE_SEASON;
  if (weeksToStart <= 4) return Phase.POWER;
  if (weeksToStart <= 8) return Phase.STRENGTH;
  return Phase.ACCUMULATION;
}

function rpeOrPercent(ls, rpeTarget, pctTarget) {
  return ls === LoadStyle.RPE ? rpeTarget : pctTarget;
}

// Set counts are ~3-4x the old engine (#4): more sets per movement, and the
// day builders program many more movements per session.
export function prescriptionFor(phase, athlete) {
  const ls = loadStyle(athlete);
  const novice = trainingStage(athlete) === 'novice';

  if (phase === Phase.TRANSITION) {
    return {
      main_intensity: 'unstructured / play; RPE 5-6',
      main_scheme: 'full-body movement quality, 3-4 x 8-10',
      speed_scheme: 'low-intent jumps & med-ball, 4 x 3',
      accessory_reps: '3-4 x 12-15',
      power_volume: 'light med-ball 3 x 8, no max jumps',
      arm_reps: '2-3 x 15-20 light',
      core_reps: '3 x 12-15/side',
      weekly_lift_days: 4,
      emphasis: 'Decompress, restore ROM, keep arm quiet (Pitch Smart off-throwing window).',
    };
  }
  if (phase === Phase.ACCUMULATION) {
    return {
      main_intensity: rpeOrPercent(ls, 'RPE 7 (2-3 reps in reserve)', '65-75% 1RM'),
      main_scheme: '4-5 x 6-8',
      speed_scheme: novice ? '—' : '6-8 x 3 @ 50-60% + bands',
      accessory_reps: '4-5 x 10-15 (bias weakness tags)',
      power_volume: 'med-ball 5-6 x 5, jumps 5 x 4',
      arm_reps: '3-4 x 12-20',
      core_reps: '3-4 x 10-12/side',
      weekly_lift_days: 4,
      emphasis: 'Hypertrophy, tendon/tissue capacity, movement literacy, GPP.',
    };
  }
  if (phase === Phase.STRENGTH) {
    return {
      main_intensity: rpeOrPercent(ls, 'RPE 8 (top set, 1-2 in reserve)', '85-92%+ 1-3RM'),
      main_scheme: 'work up to a heavy 3-5RM, then 2-3 back-off x 5 (rotate ME 1-3 wk)',
      speed_scheme: novice ? '—' : '8-10 x 2 @ 50-60% + accommodating resistance',
      accessory_reps: '4-5 x 8-12',
      power_volume: 'med-ball 5 x 3-5 (intent high), jumps 5 x 3',
      arm_reps: '3-4 x 10-15',
      core_reps: '3-4 x 8-10/side',
      weekly_lift_days: 4,
      emphasis: 'Max strength via ME rotation. ~80% of volume in special exercises.',
    };
  }
  if (phase === Phase.POWER) {
    return {
      main_intensity: rpeOrPercent(ls, 'RPE 7 but MOVE FAST', '50-60% for speed / 80% for strength-speed'),
      main_scheme: 'DE focus: 8-10 x 2 fast; 1 heavy top single if advanced',
      speed_scheme: '10 x 2 @ 55-60% + bands/chains',
      accessory_reps: '4 x 6-8 (maintain, don\'t fatigue)',
      power_volume: 'peak intent: med-ball 5 x 3, jumps 4 x 3, oly-deriv / cleans if cleared',
      arm_reps: '3 x 10-12',
      core_reps: '3 x 6-8/side (explosive)',
      weekly_lift_days: 4,
      emphasis: 'Convert strength to rate-of-force-development / speed-strength.',
    };
  }
  if (phase === Phase.PRE_SEASON) {
    return {
      main_intensity: 'taper: RPE 7, cut volume ~40%',
      main_scheme: '2-3 crisp heavy singles OR speed doubles, low total sets',
      speed_scheme: '6 x 2 fast, submaximal',
      accessory_reps: '3 x 8 (maintenance)',
      power_volume: 'high-intent, low-volume: med-ball 3 x 3, jumps 3 x 3',
      arm_reps: '2-3 x 12-15',
      core_reps: '2-3 x 8/side',
      weekly_lift_days: 4,
      emphasis: 'Peak / freshen. Throwing intent is now the priority stressor.',
    };
  }
  // IN_SEASON
  return {
    main_intensity: 'RPE 7, autoregulated by game schedule & arm fatigue',
    main_scheme: '1-2 heavy-ish main lifts, 3 sets, leave reps in reserve',
    speed_scheme: 'short: 5 x 2 fast (CNS primer, not fatigue)',
    accessory_reps: '3 x 8-10 (maintain, protect the arm)',
    power_volume: 'med-ball 3 x 4, jumps 3 x 3 (keep the athletic quality alive)',
    arm_reps: '2-3 x 12-15',
    core_reps: '2-3 x 8-10/side',
    weekly_lift_days: 3,
    emphasis: 'Maintain strength/power with minimum effective dose; never rob the arm.',
  };
}

export function armStatusNote(athlete) {
  const la = athlete.league_age || Math.round(athlete.chrono_age);
  if (!isThrower(athlete)) return 'Position player, no pitching workload constraint on the lift schedule.';
  if (athlete.recent_game_pitch_count <= 0) {
    const cap = dailyPitchMax(la);
    const capTxt = cap ? `${cap} pitches/day` : 'no fixed cap (adult)';
    return `No recent outing logged. League-age ${la} daily ceiling: ${capTxt}. ` +
      '3-consecutive-day pitching is never allowed regardless of count.';
  }
  const rest = requiredRestDays(la, athlete.recent_game_pitch_count);
  return `Last outing ${athlete.recent_game_pitch_count} pitches -> ${rest} rest day(s) ` +
    `required before next mound work (league-age ${la}). Schedule heavy lower-body lifting ` +
    'on the throwing-recovery days, not the day before a start.';
}

/* --------------------------------------------------------------------------- *
 *  Lifting phase plan + week-over-week progression waves (mirrors hitting).
 * --------------------------------------------------------------------------- */
const KIND_TO_PHASE = {
  accumulation: Phase.ACCUMULATION,
  strength: Phase.STRENGTH,
  power: Phase.POWER,
  peak: Phase.PRE_SEASON,
  inseason: Phase.IN_SEASON,
};

// 3-week build + deload every 4th week.
export function weekWave(w) {
  const k = ((Number(w) || 1) - 1) % 4;
  if (k === 3) return { deload: true, label: 'Deload', intensityAdj: 'RPE 5-6, volume −40%', volMult: 0.6 };
  const labels = ['Introduction', 'Accumulation', 'Intensification'];
  const adj = ['RPE 7 · groove technique', 'RPE 7-8 · add volume', 'RPE 8-9 · add load, cut reps'];
  return { deload: false, label: labels[k], intensityAdj: adj[k], volMult: 1 + k * 0.15 };
}

export function liftPhaseOfWeek(w, phases) {
  for (let i = 0; i < phases.length; i += 1) {
    if (w >= phases[i].span[0] && w <= phases[i].span[1]) return phases[i];
  }
  return phases[phases.length - 1];
}

export function buildLiftingPhases(weeks, basePhase, bias = 'balanced') {
  const P = {
    accumulation: { kind: 'accumulation', name: 'Accumulation',
      focus: 'Build work capacity, hypertrophy and tendon/tissue resilience. Higher volume, moderate intensity, movement literacy.' },
    strength: { kind: 'strength', name: 'Max Strength',
      focus: 'Push relative strength via Max-Effort rotation and heavy compound lifting. Lower reps, higher load, ~80% special-exercise volume.' },
    power: { kind: 'power', name: 'Power / Speed-Strength',
      focus: 'Convert strength to rate-of-force-development: dynamic-effort lifting, Olympic derivatives, cleans and max-intent med-ball / jumps.' },
    peak: { kind: 'peak', name: 'Peak / Pre-Season',
      focus: 'Taper volume, keep intensity crisp, prioritise throwing intent. Hold strength & power with the minimum effective dose.' },
    inseason: { kind: 'inseason', name: 'In-Season Maintenance',
      focus: 'Maintain strength & power with minimum effective dose around the game & throwing schedule. Never rob the arm.' },
  };
  const clone = (o, span) => ({ ...o, span });
  const W = Math.max(1, Math.min(16, Math.round(weeks) || 1));

  if (basePhase === Phase.IN_SEASON) return [clone(P.inseason, [1, W])];

  let fr = [0.30, 0.30, 0.25, 0.15];
  if (bias === 'build_strength') fr = [0.34, 0.34, 0.20, 0.12];
  if (bias === 'express_power') fr = [0.22, 0.26, 0.34, 0.18];

  const order = [P.accumulation, P.strength, P.power, P.peak];
  const cut = [];
  let acc = 0;
  for (let i = 0; i < order.length; i += 1) { acc += fr[i]; cut.push(Math.min(W, Math.round(acc * W))); }
  cut[order.length - 1] = W;

  const out = [];
  let start = 1;
  for (let i = 0; i < order.length; i += 1) {
    const end = cut[i];
    if (end >= start) { out.push(clone(order[i], [start, end])); start = end + 1; }
  }
  if (!out.length) out.push(clone(order[0], [1, W]));
  return out;
}

/* --------------------------------------------------------------------------- *
 *  Generator — selection pipeline + day / week / program assembly.
 * --------------------------------------------------------------------------- */
function eligible(pool, athlete, allowCaution = true) {
  const stage = trainingStage(athlete);
  const thrower = isThrower(athlete);
  const allowOly = allowFullOlympicLifts(athlete);
  const hurt = injuryFlags(athlete);
  const comp = athlete.assessment.movement_competency;
  const out = [];
  for (const e of pool) {
    if (!subsetOf(e.equipment, athlete.equipment)) continue;
    if (!stageOk(e, stage)) continue;
    // Injury contraindications apply to EVERYONE (real gate — kept for safety).
    if (e.contra.length && e.contra.some((c) => hurt.has(c))) continue;
    // High-stress presses (risk 2): removed only for novice competency — NOT for
    // being a pitcher (2026 rewrite).
    if (e.thrower_risk >= 2 && comp === 'novice') continue;
    // Caution items (risk 1) only in higher-volume windows.
    if (thrower && e.thrower_risk === 1 && !allowCaution) continue;
    // Full Olympic lifts gated by competency / maturity / injury (position-agnostic).
    if (e.is_olympic_full && !allowOly) continue;
    out.push(e);
  }
  return out;
}

function rankByWeakness(pool, tags) {
  const tagArr = [...tags];
  return [...pool].sort((a, b) => overlapCount(b.targets, tagArr) - overlapCount(a.targets, tagArr));
}

function weekIndex(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Math.floor(daysBetween(date, start));
  return Math.floor((diff + start.getDay()) / 7);
}

// Deterministic string hash (djb2).
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function rotatePick(pool, date, salt) {
  if (!pool.length) return null;
  const block = Math.floor(weekIndex(date) / 2); // change every ~2 weeks
  return pool[hashStr(`${salt}${block}`) % pool.length];
}

function pickN(pool, tags, n) {
  return rankByWeakness(pool, tags).slice(0, n);
}

function pickTargeted(pool, tags, n) {
  const tagArr = [...tags];
  const hits = pool.filter((e) => overlaps(e.targets, tagArr));
  return rankByWeakness(hits, tags).slice(0, n);
}

// Targeted first, then backfill from the rest of the pool so days stay rich.
function pickMix(pool, tags, n) {
  const hits = pickTargeted(pool, tags, n);
  if (hits.length >= n) return hits.slice(0, n);
  const extra = rankByWeakness(pool, tags).filter((e) => !hits.includes(e));
  return hits.concat(extra).slice(0, n);
}

function blockOf(label, exercise, prescription, why = '') {
  return { label, exercise, prescription, why };
}

// Per-day context helpers (deload trims counts; wave note tags the main lifts).
function ctxTools(ctx) {
  const wv = (ctx && ctx.wave) || {};
  const wn = ctx && ctx.weekNum ? ` · Wk ${ctx.weekNum}${wv.label ? ` ${wv.label}` : ''}` : '';
  const n = (b) => Math.max(1, wv.deload ? b - 1 : b);
  const weekday = ctx && ctx.weekday != null ? ctx.weekday : null;
  return { wn, n, weekday, deload: !!wv.deload };
}

function lowerMeDay(athlete, date, rx, ctx = {}) {
  const { wn, n, weekday } = ctxTools(ctx);
  const tags = weaknessTags(athlete.assessment);
  const meElig = eligible(ALL_POOLS.ME_LOWER, athlete);
  const main = rotatePick(meElig, date, 'melower');
  const supp = meElig.filter((e) => e !== main);
  const second = supp.length ? rotatePick(supp, date, 'melower2') : null;
  const powerElig = eligible(ALL_POOLS.POWER, athlete);
  const triElig = powerElig.filter((e) => overlaps(e.targets, [...TRIPLE_TAGS]));
  const explosive = triElig.length ? rotatePick(triElig, date, 'explolow') : null;
  const jumps = pickN(powerElig.filter((e) => e !== explosive), tags, n(2));
  const post = pickMix(eligible(ALL_POOLS.LOWER_ACC, athlete), GLUTE_TAGS, n(2));
  const sleg = pickMix(eligible(ALL_POOLS.LOWER_ACC, athlete), SL_TAGS, n(1));
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), tags, n(2));

  const blocks = [];
  if (explosive) blocks.push(blockOf('Explosive / Olympic lift', explosive.name, rx.power_volume, explosive.note));
  jumps.forEach((p) => blocks.push(blockOf('Power (CNS primer)', p.name, rx.power_volume, p.note)));
  if (main) blocks.push(blockOf('Max-Effort Lower', main.name, `${rx.main_scheme} @ ${rx.main_intensity}${wn}`, main.note));
  if (second) blocks.push(blockOf('Secondary lower strength', second.name, rx.accessory_reps, second.note));
  post.forEach((a) => blocks.push(blockOf('Posterior-chain accessory', a.name, rx.accessory_reps, a.note)));
  sleg.forEach((a) => blocks.push(blockOf('Single-leg / stability', a.name, rx.accessory_reps, a.note)));
  core.forEach((c) => blocks.push(blockOf('Anti-rotation core', c.name, rx.core_reps, c.note)));
  return { name: `${WD_NAME[weekday ?? WD.MON]} · Lower — Max-Effort`, focus: 'Lower-body strength + power', weekday: weekday ?? WD.MON, blocks };
}

function upperMeDay(athlete, date, rx, ctx = {}) {
  const { wn, n, weekday } = ctxTools(ctx);
  const thrower = isThrower(athlete);
  const mainPress = rotatePick(eligible(ALL_POOLS.ME_UPPER, athlete), date, 'meupper');
  const pressElig = eligible(ALL_POOLS.PRESS, athlete);
  const horiz = pickMix(pressElig, new Set(['horizontal_press']), 1);
  const vert = pickMix(pressElig, new Set(['vertical_press']), 1);
  const accPress = [...horiz, ...vert].filter(Boolean);
  const pulls = pickMix(eligible(ALL_POOLS.PULL, athlete), POST_TAGS, n(3));
  const arm = pickMix(eligible(ALL_POOLS.ARM_FARM, athlete), ARM_TAGS, n(thrower ? 3 : 2));
  const cuff = thrower ? pickN(eligible(ALL_POOLS.ARM_CARE, athlete), POST_TAGS, 1) : [];
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), weaknessTags(athlete.assessment), n(1));

  const blocks = [];
  if (mainPress) blocks.push(blockOf('Max-Effort Upper (press)', mainPress.name, `${rx.main_scheme} @ ${rx.main_intensity}${wn}`, mainPress.note));
  accPress.forEach((p) => blocks.push(blockOf('Pressing variety', p.name, rx.accessory_reps, p.note)));
  pulls.forEach((p) => blocks.push(blockOf('Pull / posterior-shoulder', p.name, rx.accessory_reps, p.note)));
  arm.forEach((a) => blocks.push(blockOf('Arm farm (elbow/forearm/triceps/biceps)', a.name, rx.arm_reps, a.note)));
  cuff.forEach((a) => blocks.push(blockOf('Cuff / arm care', a.name, '2-3 x 12-15 light', a.note)));
  core.forEach((c) => blocks.push(blockOf('Anti-rotation core', c.name, rx.core_reps, c.note)));
  return { name: `${WD_NAME[weekday ?? WD.TUE]} · Upper — Max-Effort + Arm Farm`, focus: 'Push/pull balance + arm resilience', weekday: weekday ?? WD.TUE, blocks };
}

function dynamicLowerDay(athlete, date, rx, ctx = {}) {
  const { wn, n, weekday } = ctxTools(ctx);
  const tags = weaknessTags(athlete.assessment);
  const powerElig = eligible(ALL_POOLS.POWER, athlete);
  const triElig = powerElig.filter((e) => overlaps(e.targets, [...TRIPLE_TAGS]));
  const explosive = triElig.length ? rotatePick(triElig, date, 'explodelow') : null;
  const jumps = pickN(powerElig.filter((e) => e !== explosive), tags, n(2));
  const deMain = rotatePick(eligible(ALL_POOLS.DE_LOWER, athlete), date, 'delower');
  const deElig = eligible(ALL_POOLS.DE_LOWER, athlete).filter((e) => e !== deMain);
  const deSecond = deElig.length ? rotatePick(deElig, date, 'delower2') : null;
  const post = pickMix(eligible(ALL_POOLS.LOWER_ACC, athlete), GLUTE_TAGS, n(2));
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), ANTIROT_TAGS, n(2));

  const blocks = [];
  if (explosive) blocks.push(blockOf('Explosive / Olympic lift', explosive.name, rx.power_volume, explosive.note));
  jumps.forEach((p) => blocks.push(blockOf('Explosive / jump (max intent)', p.name, rx.power_volume, p.note)));
  if (deMain) blocks.push(blockOf('Dynamic-Effort Lower (speed + AR)', deMain.name, `${rx.speed_scheme}${wn}`, deMain.note));
  if (deSecond) blocks.push(blockOf('Dynamic-Effort Lower (variation)', deSecond.name, rx.speed_scheme, deSecond.note));
  post.forEach((a) => blocks.push(blockOf('Posterior-chain accessory', a.name, rx.accessory_reps, a.note)));
  core.forEach((c) => blocks.push(blockOf('Rotational / anti-rotation core', c.name, rx.core_reps, c.note)));
  return { name: `${WD_NAME[weekday ?? WD.THU]} · Dynamic-Effort Lower`, focus: 'Speed-strength + reactive lower power', weekday: weekday ?? WD.THU, blocks };
}

function dynamicUpperDay(athlete, date, rx, ctx = {}) {
  const { wn, n, weekday } = ctxTools(ctx);
  const thrower = isThrower(athlete);
  const powerElig = eligible(ALL_POOLS.POWER, athlete);
  const power = pickMix(powerElig, ROT_TAGS, n(2));
  const ohElig = powerElig.filter((e) => subsetOf([...OH_EXPLOSIVE_TAGS], e.targets));
  const ohExplosive = ohElig.length ? rotatePick(ohElig, date, 'expoup') : null;
  const dePress = pickN(eligible(ALL_POOLS.DE_UPPER, athlete), new Set(['horizontal_press', 'vertical_press']), n(2));
  const speedPull = pickMix(eligible(ALL_POOLS.DE_UPPER, athlete), POST_TAGS, n(1));
  const arm = pickMix(eligible(ALL_POOLS.ARM_FARM, athlete), ARM_TAGS, n(thrower ? 3 : 2));
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), ANTIROT_TAGS, n(1));

  const blocks = power.map((p) => blockOf('Rotational power (sport transfer)', p.name, rx.power_volume, p.note));
  if (ohExplosive) blocks.push(blockOf('Explosive overhead (push press / jerk)', ohExplosive.name, rx.power_volume, ohExplosive.note));
  dePress.forEach((p, i) => blocks.push(blockOf('Dynamic-Effort Upper (speed press)', p.name, `${rx.speed_scheme}${i === 0 ? wn : ''}`, p.note)));
  speedPull.forEach((p) => blocks.push(blockOf('Speed pull', p.name, rx.speed_scheme, p.note)));
  arm.forEach((a) => blocks.push(blockOf('Arm farm (elbow/forearm/triceps/biceps)', a.name, rx.arm_reps, a.note)));
  core.forEach((c) => blocks.push(blockOf('Anti-rotation core', c.name, rx.core_reps, c.note)));
  return { name: `${WD_NAME[weekday ?? WD.FRI]} · Dynamic-Effort Upper`, focus: 'Speed press/pull + arm resilience', weekday: weekday ?? WD.FRI, blocks };
}

// In-season combined dynamic lower + upper.
function dynamicSplitDay(athlete, date, rx, ctx = {}) {
  const { wn, n, weekday } = ctxTools(ctx);
  const thrower = isThrower(athlete);
  const power = pickMix(eligible(ALL_POOLS.POWER, athlete), ROT_TAGS, n(2));
  const deLow = rotatePick(eligible(ALL_POOLS.DE_LOWER, athlete), date, 'desplitlow');
  const deUp = pickN(eligible(ALL_POOLS.DE_UPPER, athlete), new Set(['horizontal_press', 'vertical_press']), n(1));
  const post = pickMix(eligible(ALL_POOLS.LOWER_ACC, athlete), GLUTE_TAGS, n(1));
  const pull = pickMix(eligible(ALL_POOLS.PULL, athlete), POST_TAGS, n(1));
  const arm = pickMix(eligible(ALL_POOLS.ARM_FARM, athlete), ARM_TAGS, n(thrower ? 2 : 1));
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), ANTIROT_TAGS, n(1));

  const blocks = power.map((p) => blockOf('Rotational power (sport transfer)', p.name, rx.power_volume, p.note));
  if (deLow) blocks.push(blockOf('Dynamic-Effort Lower (speed)', deLow.name, `${rx.speed_scheme}${wn}`, deLow.note));
  deUp.forEach((p) => blocks.push(blockOf('Dynamic-Effort Upper (speed press)', p.name, rx.speed_scheme, p.note)));
  post.forEach((a) => blocks.push(blockOf('Posterior-chain accessory', a.name, rx.accessory_reps, a.note)));
  pull.forEach((a) => blocks.push(blockOf('Pull / posterior-shoulder', a.name, rx.accessory_reps, a.note)));
  arm.forEach((a) => blocks.push(blockOf('Arm farm', a.name, rx.arm_reps, a.note)));
  core.forEach((c) => blocks.push(blockOf('Anti-rotation core', c.name, rx.core_reps, c.note)));
  return { name: `${WD_NAME[weekday ?? WD.THU]} · Dynamic-Effort Split`, focus: 'Combined DE lower + upper (in-season)', weekday: weekday ?? WD.THU, blocks };
}

function correctivePrep(athlete) {
  const tags = weaknessTags(athlete.assessment);
  const corr = pickTargeted(eligible(ALL_POOLS.CORRECTIVE, athlete), tags, 3);
  if (!corr.length) {
    return [blockOf('Prep (clean screen)', 'General dynamic warm-up', '5-8 min: leg swings, band pull-aparts, hip openers')];
  }
  return corr.map((c) => blockOf('Prep / corrective (screen-driven)', c.name, '2 x 8-10', c.note));
}

// Assemble the day list for one week (4-day off-season / 3-day in-season) and
// prepend the screen-driven prep to the week's first (lower) day.
function assembleDays(athlete, date, rx, ctx, inSeason) {
  const prep = correctivePrep(athlete);
  const days = inSeason
    ? [
      lowerMeDay(athlete, date, rx, { ...ctx, weekday: WD.MON }),
      upperMeDay(athlete, date, rx, { ...ctx, weekday: WD.TUE }),
      dynamicSplitDay(athlete, date, rx, { ...ctx, weekday: WD.THU }),
    ]
    : [
      lowerMeDay(athlete, date, rx, { ...ctx, weekday: WD.MON }),
      upperMeDay(athlete, date, rx, { ...ctx, weekday: WD.TUE }),
      dynamicLowerDay(athlete, date, rx, { ...ctx, weekday: WD.THU }),
      dynamicUpperDay(athlete, date, rx, { ...ctx, weekday: WD.FRI }),
    ];
  if (days.length) days[0] = { ...days[0], blocks: [...prep, ...days[0].blocks] };
  return days;
}

export function collectFlags(athlete) {
  const f = [];
  const hurt = injuryFlags(athlete);
  if (!allowMaximalTesting(athlete)) f.push('No true 1RM testing: use RPE / rep-max estimates (novice, <15yo, or circa-PHV).');
  if (maturityBand(athlete) === 'circa_phv') {
    f.push('Circa-PHV growth window: prioritise mobility, control axial load, watch for growth-related pain (e.g. Osgood-Schlatter, apophysitis).');
  }
  if (isThrower(athlete)) {
    f.push('Throwing load governs the week: never schedule a fatiguing lift the day before a start/bullpen; 3 consecutive pitching days is never allowed.');
  }
  if (isPitcher(athlete)) {
    if (allowFullOlympicLifts(athlete)) {
      f.push('Pitcher: explosive & max-strength lifts (Olympic lifts, heavy bench/OHP, cleans/jerks) are INCLUDED to test & build force capacity — gated by injury, competency and maturity, not by position.');
    } else {
      f.push('Pitcher: full Olympic lifts are held back for now (novice / not-yet-competent / pre-PHV or an active wrist/elbow/UCL/TJ flag) — explosive derivatives & med-ball still programmed. Re-open once competent & healthy.');
    }
  }
  if (girdFlag(athlete.assessment)) {
    f.push('GIRD detected: include posterior-shoulder work + gentle IR mobility; flag for the medical staff if painful or > ~20 degrees.');
  }
  if (hurt.has('shoulder') || hurt.has('labrum')) {
    f.push('Shoulder/labrum history: heavy straight-bar bench & overhead press and overhead-catch snatch/jerk are auto-removed. Clear pressing progression with medical staff.');
  }
  if (hurt.has('elbow') || hurt.has('ucl') || hurt.has('tj')) {
    f.push('Elbow/UCL/TJ history: full Olympic lifts (rack/overhead catch) are auto-removed; clear all loaded pressing & any oly derivative with medical staff.');
  } else if (hurt.has('wrist')) {
    f.push('Wrist history: front-rack & overhead-catch Olympic lifts are auto-removed; use pulls / jumps / med-ball for power.');
  }
  f.push('Decision support only — not medical advice. Clear growing athletes with a qualified sports-medicine professional and follow league Pitch Smart limits.');
  return f;
}

/**
 * Generate one training week for an athlete on a given date.
 * @returns {{athlete, date, phase, phaseLabel, load_style, arm_note, emphasis, days, flags}}
 */
export function generateWeek(athlete, date, seasonStart, seasonEnd, ctx = {}) {
  const phase = phaseForDate(date, seasonStart, seasonEnd);
  const rx = prescriptionFor(phase, athlete);
  const c = {
    weekNum: ctx.weekNum ?? 1,
    wave: ctx.wave ?? weekWave(ctx.weekNum ?? 1),
    bias: ctx.bias ?? 'balanced',
  };
  const inSeason = phase === Phase.IN_SEASON;
  const days = assembleDays(athlete, date, rx, c, inSeason);

  return {
    athlete: athlete.name,
    date,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    load_style: loadStyle(athlete),
    arm_note: armStatusNote(athlete),
    emphasis: rx.emphasis,
    days,
    flags: collectFlags(athlete),
  };
}

/**
 * Multi-week program (1-16 weeks) with true week-over-week progression (#6).
 * Builds a lifting phase plan across the length, waves accumulation →
 * intensification → deload every 4th week, and carries a weekday on every day
 * for absolute-offset serialization.
 * @returns {{athlete, lengthWeeks, phase, phaseLabel, load_style, arm_note,
 *   emphasis, level, grades, bias, phases, weeks, flags}}
 */
export function generateProgram(athlete, planDate, seasonStart, seasonEnd, lengthWeeks) {
  const L = Math.max(1, Math.min(16, Math.round(Number(lengthWeeks) || 1)));
  const basePhase = phaseForDate(planDate, seasonStart, seasonEnd);
  const level = scLevelFromAge(athlete.chrono_age);
  const grades = gradeStrength(athlete.assessment, level);
  const bias = strengthBias(grades);
  const phases = buildLiftingPhases(L, basePhase, bias);

  const weeks = [];
  for (let w = 1; w <= L; w += 1) {
    const ph = liftPhaseOfWeek(w, phases);
    const wave = weekWave(w);
    const phaseEnum = KIND_TO_PHASE[ph.kind] || basePhase;
    const rx = prescriptionFor(phaseEnum, athlete);
    const weekDate = new Date(planDate.getTime() + (w - 1) * 7 * 24 * 60 * 60 * 1000);
    const c = { weekNum: w, wave, bias, phaseKind: ph.kind };
    const inSeason = ph.kind === 'inseason';
    const days = assembleDays(athlete, weekDate, rx, c, inSeason);
    weeks.push({
      week: w,
      phaseKind: ph.kind,
      phaseName: ph.name,
      deload: wave.deload,
      waveLabel: wave.label,
      emphasis: rx.emphasis,
      days,
    });
  }

  const rx0 = prescriptionFor(KIND_TO_PHASE[phases[0].kind] || basePhase, athlete);
  return {
    athlete: athlete.name,
    lengthWeeks: L,
    phase: basePhase,
    phaseLabel: PHASE_LABEL[basePhase],
    load_style: loadStyle(athlete),
    arm_note: armStatusNote(athlete),
    emphasis: rx0.emphasis,
    level,
    grades,
    bias,
    phases,
    weeks,
    flags: collectFlags(athlete),
  };
}

/**
 * Week-by-week phase overview from planStart until seasonEnd.
 * @returns {Array<{date: string, phase, phaseLabel, emphasis}>}
 */
export function macroCalendar(athlete, seasonStart, seasonEnd, planStart) {
  const out = [];
  let d = new Date(planStart);
  let last = null;
  while (d <= seasonEnd) {
    const ph = phaseForDate(d, seasonStart, seasonEnd);
    if (ph !== last) {
      const rx = prescriptionFor(ph, athlete);
      out.push({ date: d.toISOString().slice(0, 10), phase: ph, phaseLabel: PHASE_LABEL[ph], emphasis: rx.emphasis });
      last = ph;
    }
    d = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return out;
}

/* --------------------------------------------------------------------------- *
 *  Serialization: WeekPlan / Program -> the app's relational training program.
 *  training_exercises.category is a CHECK enum; lifting has no exact bucket, so
 *  arm-care / corrective / prep map to 'recovery' and everything else to
 *  'conditioning'. The real block label lives in `description`.
 * --------------------------------------------------------------------------- */
function categoryForBlock(label) {
  const l = label.toLowerCase();
  if (l.includes('arm care') || l.includes('cuff') || l.includes('corrective') || l.includes('prep')) return 'recovery';
  return 'conditioning';
}

function blocksToExercises(blocks) {
  return blocks.map((b, i) => ({
    category: categoryForBlock(b.label),
    name: b.exercise,
    description: b.why ? `${b.label} — ${b.why}` : b.label,
    reps: b.prescription,
    sort_order: i,
  }));
}

/**
 * Map a generated week to rows for insert into training_days / training_exercises.
 * @returns {Array<{title, notes, exercises: Array<{category,name,description,reps,sort_order}>}>}
 */
export function weekToProgramDays(week) {
  return week.days.map((day) => ({
    title: day.name,
    notes: day.focus,
    exercises: blocksToExercises(day.blocks),
  }));
}

/**
 * Flatten a multi-week program (from generateProgram) into program-day rows with
 * day_number = 1-BASED ABSOLUTE CALENDAR-DAY OFFSET: (week-1)*7 + weekday + 1.
 * Rest days emit no rows; the caller inserts each row at its own day_number so
 * the schedule places every session on the correct calendar day (#6).
 * @returns {Array<{day_number, title, notes, exercises}>}
 */
export function programToProgramDays(program) {
  const rows = [];
  program.weeks.forEach((wk) => {
    wk.days.forEach((day) => {
      const dayNumber = (wk.week - 1) * 7 + day.weekday + 1;
      rows.push({
        day_number: dayNumber,
        title: `Wk ${wk.week} · ${day.name}${wk.deload ? ' (deload)' : ''}`,
        notes: day.focus,
        exercises: blocksToExercises(day.blocks),
      });
    });
  });
  rows.sort((a, b) => a.day_number - b.day_number);
  return rows;
}

/* --------------------------------------------------------------------------- *
 *  Full off-season macrocycle (legacy helper): a representative week per phase
 *  the athlete passes through from planStart to seasonEnd, in order.
 * --------------------------------------------------------------------------- */

/**
 * @returns {Array} one generateWeek() result per distinct phase in the macro
 *   calendar (Accumulation -> Strength -> Power -> Pre-season -> In-season …).
 */
export function generateMacro(athlete, seasonStart, seasonEnd, planStart) {
  return macroCalendar(athlete, seasonStart, seasonEnd, planStart).map((entry) => {
    const d = new Date(`${entry.date}T00:00:00`);
    return { ...generateWeek(athlete, d, seasonStart, seasonEnd), phaseStartDate: entry.date };
  });
}

/**
 * Flatten a macro (array of phase weeks) into program-day rows, each session
 * prefixed with its phase so one assignable program spans the whole off-season.
 */
export function macroToProgramDays(weeks) {
  const rows = [];
  weeks.forEach((w) => {
    weekToProgramDays(w).forEach((day) => {
      rows.push({
        title: `[${w.phaseLabel}] ${day.title}`,
        notes: `${w.emphasis} — ${day.notes}`,
        exercises: day.exercises,
      });
    });
  });
  return rows;
}
