/* ============================================================================
   scProgramEngine.js — Baseball Strength & Conditioning program generator.

   Dependency-free JavaScript port of the Python engine in
   "NBP Systems Development/files (1)" (models.py / exercises.py /
   periodization.py / generator.py).

   Design philosophy (grounded in published methodology from Driveline, Optimal
   Power Performance, Westside Barbell / Conjugate-U, and MLB/USA Baseball Pitch
   Smart):
     * Conjugate PRINCIPLES (Max-Effort / Dynamic-Effort / Repetition rotation,
       ~80/20 special-to-main-lift volume, accommodating resistance) — NOT
       powerlifting movement selection copied wholesale.
     * Olympic DERIVATIVES (jumps, med-ball, pulls) preferred over full lifts for
       throwers; full lifts gated behind position + training age + a clean screen.
     * Throwing load is a first-class constraint: the weight room is scheduled
       AROUND the arm.
     * Everything scales by TRAINING age, with hard youth safety gates (no maximal
       1RM testing for novices; RPE-driven loading).

   This is coaching decision support, not medical advice.
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

export function allowFullOlympicLifts(ath) {
  if (isPitcher(ath)) return false;
  if (trainingStage(ath) !== 'advanced') return false;
  if (maturityBand(ath) !== 'post_phv') return false;
  if (ath.assessment.movement_competency !== 'competent') return false;
  const blocked = ['wrist', 'elbow', 'ucl', 'shoulder', 'labrum', 'tj_surgery'];
  const hurt = ath.injury_history.some((inj) =>
    blocked.some((b) => String(inj).toLowerCase().includes(b)),
  );
  if (hurt) return false;
  return ath.equipment.includes('barbell');
}

/* --------------------------------------------------------------------------- *
 *  Exercise library — tagged so the engine can select intelligently.
 *
 *  thrower_risk: 0 safe / encouraged, 1 caution (cap volume), 2 avoid-for-thrower
 *  (heavy straight-bar bench/OHP etc — auto-excluded for throwers).
 * --------------------------------------------------------------------------- */
function ex(name, effort, opts = {}) {
  return {
    name,
    effort,
    thrower_risk: opts.thrower_risk ?? 0,
    equipment: opts.equipment ?? ['barbell'],
    targets: opts.targets ?? [],
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
    equipment: ['barbell', 'ssb', 'box'], targets: ['glute_ham'],
    accommodating_resistance: true, min_training_stage: 'intermediate',
    note: 'Box teaches hip loading, protects knees; SSB is shoulder-friendly.',
  }),
  ex('Trap-Bar Deadlift', Effort.MAX_EFFORT, {
    equipment: ['trapbar'], targets: ['glute_ham'], accommodating_resistance: true,
    note: 'Most spine-friendly heavy pull; great novice ME entry.',
  }),
  ex('SSB Front-Foot-Elevated Split Squat', Effort.MAX_EFFORT, {
    equipment: ['ssb', 'dumbbell'], targets: ['glute_ham', 'single_leg_stability'],
    min_training_stage: 'intermediate', unilateral: true,
  }),
  ex('Cambered-Bar Good Morning', Effort.MAX_EFFORT, {
    equipment: ['barbell'], targets: ['glute_ham'], accommodating_resistance: true,
    min_training_stage: 'advanced', note: 'Posterior-chain ME; strict form, advanced only.',
  }),
  ex('Front Squat', Effort.MAX_EFFORT, {
    thrower_risk: 1, equipment: ['barbell'], min_training_stage: 'advanced',
    note: 'Caution: front-rack wrist/shoulder demand — sub goblet if restricted.',
  }),
];

const ME_UPPER = [
  ex('Neutral-Grip DB Floor Press', Effort.MAX_EFFORT, {
    equipment: ['dumbbell'], note: 'Floor limits shoulder extension -> protects anterior capsule.',
  }),
  ex('Landmine Press', Effort.MAX_EFFORT, {
    equipment: ['barbell', 'landmine'], targets: ['scap_upward_rotation'],
    note: 'Scap-friendly vertical-ish press; safe overhead alternative.',
  }),
  ex('Football-Bar Floor Press', Effort.MAX_EFFORT, {
    thrower_risk: 1, equipment: ['barbell', 'football_bar'], min_training_stage: 'intermediate',
    note: 'Neutral grip reduces shoulder stress vs straight bar.',
  }),
  ex('Weighted Chin-Up (ME pull)', Effort.MAX_EFFORT, {
    equipment: ['pullup_bar'], targets: ['posterior_shoulder'], min_training_stage: 'intermediate',
    note: 'Upper-body ME emphasis via pulling for throwers (balance the ratio).',
  }),
  // Deliberately avoid-tagged so throwers never receive these:
  ex('Barbell Bench Press (heavy straight bar)', Effort.MAX_EFFORT, {
    thrower_risk: 2, equipment: ['barbell'], min_training_stage: 'advanced',
  }),
  ex('Standing Barbell Overhead Press', Effort.MAX_EFFORT, {
    thrower_risk: 2, equipment: ['barbell'], min_training_stage: 'advanced',
  }),
];

const DE_LOWER = [
  ex('Speed Box Squat (bands)', Effort.DYNAMIC_EFFORT, {
    equipment: ['barbell', 'box', 'bands'], targets: ['glute_ham'],
    accommodating_resistance: true, min_training_stage: 'intermediate',
  }),
  ex('Trap-Bar Speed Pull (chains)', Effort.DYNAMIC_EFFORT, {
    equipment: ['trapbar', 'chains'], targets: ['glute_ham'], accommodating_resistance: true,
  }),
  ex('Dynamic Reverse Lunge (DB)', Effort.DYNAMIC_EFFORT, {
    equipment: ['dumbbell'], targets: ['single_leg_stability', 'glute_ham'], unilateral: true,
  }),
];

const DE_UPPER = [
  ex('Speed Landmine Press (band)', Effort.DYNAMIC_EFFORT, {
    equipment: ['landmine', 'bands'], targets: ['scap_upward_rotation'],
  }),
  ex('Explosive Feet-Up DB Floor Press', Effort.DYNAMIC_EFFORT, { equipment: ['dumbbell'] }),
  ex('Band-Resisted Row (speed)', Effort.DYNAMIC_EFFORT, {
    equipment: ['bands'], targets: ['posterior_shoulder'],
  }),
];

const POWER = [
  ex('Rotational Med-Ball Scoop Toss', Effort.POWER, {
    equipment: ['medball'], targets: ['rotational_power'],
    note: 'Primary sport-power driver; trains the throw/swing pattern.',
  }),
  ex('Overhead Med-Ball Slam', Effort.POWER, {
    equipment: ['medball'], targets: ['rotational_power'],
  }),
  ex('Seated Box Jump (soft landing)', Effort.POWER, {
    equipment: ['box'], note: 'Concentric-biased jump; low landing stress — Conjugate-U staple.',
  }),
  ex('Broad Jump', Effort.POWER, { equipment: [], targets: ['glute_ham'] }),
  ex('Trap-Bar Jump', Effort.POWER, { equipment: ['trapbar'], min_training_stage: 'intermediate' }),
  ex('Hang High-Pull (oly derivative)', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], min_training_stage: 'intermediate',
    note: 'Triple-extension power without the front-rack catch.',
  }),
  ex('Hang Power Clean (full catch)', Effort.POWER, {
    thrower_risk: 1, equipment: ['barbell'], min_training_stage: 'advanced', is_olympic_full: true,
    note: 'Gated: non-pitchers only, competent movement, healthy wrists/elbows.',
  }),
  ex('Power Snatch (full)', Effort.POWER, {
    thrower_risk: 2, equipment: ['barbell'], min_training_stage: 'advanced', is_olympic_full: true,
    note: 'Gated: overhead catch is high wrist/shoulder demand — rarely worth it.',
  }),
];

const REPETITION = [
  ex('Rear-Foot-Elevated Split Squat', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['single_leg_stability', 'glute_ham'], unilateral: true,
  }),
  ex('Nordic / Razor Curl', Effort.REPETITION, {
    equipment: [], targets: ['glute_ham'], min_training_stage: 'intermediate',
  }),
  ex('Hip Thrust', Effort.REPETITION, { equipment: ['barbell'], targets: ['glute_ham'] }),
  ex('Chest-Supported Row', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['posterior_shoulder'],
  }),
  ex('1-Arm DB Row', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['posterior_shoulder'], unilateral: true,
  }),
  ex('Prone Trap Raise (Y/T)', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['scap_upward_rotation', 'posterior_shoulder'],
  }),
  ex('Face Pull', Effort.REPETITION, {
    equipment: ['bands'], targets: ['posterior_shoulder', 'scap_upward_rotation'],
  }),
];

const CORRECTIVE = [
  ex('Sleeper / Cross-Body Stretch', Effort.CORRECTIVE, {
    equipment: [], targets: ['posterior_shoulder'],
    note: 'Only if GIRD present and pain-free; go gently.',
  }),
  ex('Wall Slides w/ Lift-Off', Effort.CORRECTIVE, {
    equipment: ['bands'], targets: ['scap_upward_rotation'],
  }),
  ex('90/90 Hip Switch', Effort.CORRECTIVE, { equipment: [], targets: ['hip_mobility'] }),
  ex('Knee-to-Wall Ankle Mob', Effort.CORRECTIVE, { equipment: [], targets: ['ankle_mobility'] }),
  ex('Half-Kneeling T-Spine Rotation', Effort.CORRECTIVE, {
    equipment: [], targets: ['tspine_rotation'],
  }),
];

const ARM_CARE = [
  ex('Prone External Rotation (light)', Effort.ARM_CARE, {
    equipment: ['dumbbell'], targets: ['posterior_shoulder'],
  }),
  ex('Band ER at 90/90', Effort.ARM_CARE, { equipment: ['bands'], targets: ['posterior_shoulder'] }),
  ex('Rhythmic Stabilizations', Effort.ARM_CARE, { equipment: [], targets: ['posterior_shoulder'] }),
  ex('Forearm Flexor/Extensor Eccentrics', Effort.ARM_CARE, { equipment: ['dumbbell'] }),
  ex('Serratus Wall Punch', Effort.ARM_CARE, {
    equipment: ['bands'], targets: ['scap_upward_rotation'],
  }),
];

const CORE = [
  ex('Pallof Press', Effort.REPETITION, { equipment: ['bands'], targets: ['anti_rotation_core'] }),
  ex('Half-Kneeling Cable Chop/Lift', Effort.REPETITION, {
    equipment: ['bands'], targets: ['anti_rotation_core', 'rotational_power'],
  }),
  ex('Suitcase Carry', Effort.REPETITION, {
    equipment: ['dumbbell'], targets: ['anti_rotation_core'], unilateral: true,
  }),
];

export const ALL_POOLS = {
  ME_LOWER, ME_UPPER, DE_LOWER, DE_UPPER, POWER, REPETITION, CORRECTIVE, ARM_CARE, CORE,
};

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

export function prescriptionFor(phase, athlete) {
  const ls = loadStyle(athlete);
  const novice = trainingStage(athlete) === 'novice';

  if (phase === Phase.TRANSITION) {
    return {
      main_intensity: 'unstructured / play; RPE 5-6',
      main_scheme: 'full-body 2x/wk, movement quality only',
      speed_scheme: 'low-intent jumps & med-ball',
      accessory_reps: '2-3 x 12-15',
      power_volume: 'light med-ball 2x8, no max jumps',
      weekly_lift_days: 2,
      emphasis: 'Decompress, restore ROM, keep arm quiet (Pitch Smart off-throwing window).',
    };
  }
  if (phase === Phase.ACCUMULATION) {
    return {
      main_intensity: rpeOrPercent(ls, 'RPE 7 (2-3 reps in reserve)', '65-75% 1RM'),
      main_scheme: '3-4 x 6-8',
      speed_scheme: novice ? '—' : '6-8 x 3 @ 50-60% + bands',
      accessory_reps: '3-4 x 10-15 (bias weakness tags)',
      power_volume: 'med-ball 4-5 x 5, jumps 4 x 4',
      weekly_lift_days: novice ? 2 : 3,
      emphasis: 'Hypertrophy, tendon/tissue capacity, movement literacy, GPP.',
    };
  }
  if (phase === Phase.STRENGTH) {
    return {
      main_intensity: rpeOrPercent(ls, 'RPE 8 (top set, 1-2 in reserve)', '85-92%+ 1-3RM'),
      main_scheme: 'work up to a heavy 3RM (rotate ME movement 1-3 wk)',
      speed_scheme: novice ? '—' : '8-10 x 2 @ 50-60% + accommodating resistance',
      accessory_reps: '3-4 x 8-12',
      power_volume: 'med-ball 5 x 3-5 (intent high), jumps 5 x 3',
      weekly_lift_days: 3,
      emphasis: 'Max strength via ME rotation. ~80% of volume in special exercises.',
    };
  }
  if (phase === Phase.POWER) {
    return {
      main_intensity: rpeOrPercent(ls, 'RPE 7 but MOVE FAST', '50-60% for speed / 80% for strength-speed'),
      main_scheme: 'DE focus: 8-10 x 2 fast; 1 heavy top single if advanced',
      speed_scheme: '10 x 2 @ 55-60% + bands/chains',
      accessory_reps: '3 x 6-8 (maintain, don\'t fatigue)',
      power_volume: 'peak intent: med-ball 5 x 3, jumps 4 x 3, oly-deriv if cleared',
      weekly_lift_days: 3,
      emphasis: 'Convert strength to rate-of-force-development / speed-strength.',
    };
  }
  if (phase === Phase.PRE_SEASON) {
    return {
      main_intensity: 'taper: RPE 7, cut volume ~40%',
      main_scheme: '1-2 crisp heavy singles OR speed doubles, low total sets',
      speed_scheme: '6 x 2 fast, submaximal',
      accessory_reps: '2 x 8 (maintenance)',
      power_volume: 'high-intent, low-volume: med-ball 3 x 3, jumps 3 x 3',
      weekly_lift_days: 2,
      emphasis: 'Peak / freshen. Throwing intent is now the priority stressor.',
    };
  }
  // IN_SEASON
  return {
    main_intensity: 'RPE 7, autoregulated by game schedule & arm fatigue',
    main_scheme: '1 heavy-ish main lift, 2-3 sets, leave reps in reserve',
    speed_scheme: 'short: 5 x 2 fast (CNS primer, not fatigue)',
    accessory_reps: '2-3 x 8-10 (maintain, protect the arm)',
    power_volume: 'med-ball 3 x 4, jumps 3 x 3 (keep the athletic quality alive)',
    weekly_lift_days: 2,
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
 *  Generator — selection pipeline + week / macro assembly.
 * --------------------------------------------------------------------------- */
function eligible(pool, athlete, allowCaution = true) {
  const stage = trainingStage(athlete);
  const thrower = isThrower(athlete);
  const allowOly = allowFullOlympicLifts(athlete);
  const out = [];
  for (const e of pool) {
    if (!subsetOf(e.equipment, athlete.equipment)) continue;
    if (!stageOk(e, stage)) continue;
    if (thrower) {
      if (e.thrower_risk >= 2) continue;
      if (e.thrower_risk === 1 && !allowCaution) continue;
    }
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
  // ISO-ish week-of-year (0-based-ish), matches Python's %W closely enough for
  // a deterministic 2-week rotation cadence.
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Math.floor(daysBetween(date, start));
  return Math.floor((diff + start.getDay()) / 7);
}

// Deterministic string hash (djb2) — replaces Python's md5, same rotation property.
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

function block(label, exercise, prescription, why = '') {
  return { label, exercise, prescription, why };
}

function lowerMeDay(athlete, date, rx) {
  const tags = weaknessTags(athlete.assessment);
  const main = rotatePick(eligible(ALL_POOLS.ME_LOWER, athlete), date, 'melower');
  const power = pickN(eligible(ALL_POOLS.POWER, athlete), tags, 2);
  const acc = pickN(eligible(ALL_POOLS.REPETITION, athlete), new Set(['glute_ham', 'single_leg_stability']), 2);
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), tags, 1);

  const blocks = power.map((p) => block('Power (CNS primer)', p.name, rx.power_volume, p.note));
  if (main) blocks.push(block('Max-Effort Lower (rotates ~2wk)', main.name, `${rx.main_scheme} @ ${rx.main_intensity}`, main.note));
  acc.forEach((a) => blocks.push(block('Accessory', a.name, rx.accessory_reps, a.note)));
  core.forEach((c) => blocks.push(block('Anti-rotation core', c.name, '3 x 8-10/side', c.note)));
  return { name: 'Day 1 — Lower / Max-Effort', focus: 'Lower-body strength + power', blocks };
}

function upperMeDay(athlete, date, rx) {
  const tags = weaknessTags(athlete.assessment);
  const main = rotatePick(eligible(ALL_POOLS.ME_UPPER, athlete), date, 'meupper');
  const pull = pickN(eligible(ALL_POOLS.REPETITION, athlete), new Set(['posterior_shoulder', 'scap_upward_rotation']), 3);
  const blocks = [];
  if (main) blocks.push(block('Max-Effort Upper (thrower-safe press/pull)', main.name, `${rx.main_scheme} @ ${rx.main_intensity}`, main.note));
  pull.forEach((p) => blocks.push(block('Pull / posterior-shoulder', p.name, rx.accessory_reps, p.note)));
  if (isThrower(athlete)) {
    const arm = pickN(eligible(ALL_POOLS.ARM_CARE, athlete), tags, 3);
    arm.forEach((a) => blocks.push(block('Arm care (non-negotiable)', a.name, '2-3 x 12-15 light', a.note)));
  }
  return { name: 'Day 2 — Upper / Max-Effort + Arm Care', focus: 'Push/pull balance + cuff', blocks };
}

function dynamicDay(athlete, date, rx) {
  const tags = weaknessTags(athlete.assessment);
  const deLow = rotatePick(eligible(ALL_POOLS.DE_LOWER, athlete), date, 'delower');
  const deUp = rotatePick(eligible(ALL_POOLS.DE_UPPER, athlete), date, 'deupper');
  const power = pickN(eligible(ALL_POOLS.POWER, athlete), new Set(['rotational_power']), 2);
  const core = pickN(eligible(ALL_POOLS.CORE, athlete), new Set(['rotational_power', 'anti_rotation_core']), 2);

  const blocks = power.map((p) => block('Rotational power (sport transfer)', p.name, rx.power_volume, p.note));
  if (deLow) blocks.push(block('Dynamic-Effort Lower (speed + AR)', deLow.name, rx.speed_scheme, deLow.note));
  if (deUp) blocks.push(block('Dynamic-Effort Upper (speed)', deUp.name, rx.speed_scheme, deUp.note));
  core.forEach((c) => blocks.push(block('Rotational / anti-rotation core', c.name, '3 x 6-8/side', c.note)));
  if (isThrower(athlete)) {
    const arm = pickN(eligible(ALL_POOLS.ARM_CARE, athlete), tags, 2);
    arm.forEach((a) => blocks.push(block('Arm care', a.name, '2 x 15 light', a.note)));
  }
  return { name: 'Day 3 — Dynamic-Effort / Speed', focus: 'Speed-strength + rotational power', blocks };
}

function correctivePrep(athlete) {
  const tags = weaknessTags(athlete.assessment);
  const corr = pickTargeted(eligible(ALL_POOLS.CORRECTIVE, athlete), tags, 3);
  if (!corr.length) {
    return [block('Prep (clean screen)', 'General dynamic warm-up', '5-8 min: leg swings, band pull-aparts, hip openers')];
  }
  return corr.map((c) => block('Prep / corrective (screen-driven)', c.name, '2 x 8-10', c.note));
}

export function collectFlags(athlete) {
  const f = [];
  if (!allowMaximalTesting(athlete)) f.push('No true 1RM testing: use RPE / rep-max estimates (novice, <15yo, or circa-PHV).');
  if (maturityBand(athlete) === 'circa_phv') {
    f.push('Circa-PHV growth window: prioritise mobility, control axial load, watch for growth-related pain (e.g. Osgood-Schlatter, apophysitis).');
  }
  if (isThrower(athlete)) {
    f.push('Throwing load governs the week: never schedule a fatiguing lift the day before a start/bullpen; 3 consecutive pitching days is never allowed.');
  }
  if (girdFlag(athlete.assessment)) {
    f.push('GIRD detected: include posterior-shoulder work + gentle IR mobility; flag for the medical staff if painful or > ~20 degrees.');
  }
  if (isPitcher(athlete)) {
    f.push('Pitcher: full Olympic lifts and heavy straight-bar bench/OHP are excluded by design.');
  }
  const inj = athlete.injury_history.map((i) => String(i).toLowerCase());
  if (inj.includes('tj_surgery') || inj.some((i) => i.includes('ucl'))) {
    f.push('Elbow/UCL history: clear all loaded pressing & any oly derivative with medical staff.');
  }
  f.push('Decision support only — not medical advice. Clear growing athletes with a qualified sports-medicine professional and follow league Pitch Smart limits.');
  return f;
}

/**
 * Generate one training week for an athlete on a given date.
 * @returns {{athlete, date, phase, phaseLabel, load_style, arm_note, emphasis, days, flags}}
 */
export function generateWeek(athlete, date, seasonStart, seasonEnd) {
  const phase = phaseForDate(date, seasonStart, seasonEnd);
  const rx = prescriptionFor(phase, athlete);
  const prep = correctivePrep(athlete);

  let days;
  if ([Phase.TRANSITION, Phase.PRE_SEASON, Phase.IN_SEASON].includes(phase) || rx.weekly_lift_days <= 2) {
    days = [lowerMeDay(athlete, date, rx), upperMeDay(athlete, date, rx)];
  } else {
    days = [lowerMeDay(athlete, date, rx), upperMeDay(athlete, date, rx), dynamicDay(athlete, date, rx)];
  }

  // Prepend prep so screen-driven correctives always appear on day 1.
  if (days.length) {
    days[0] = { name: days[0].name, focus: days[0].focus, blocks: [...prep, ...days[0].blocks] };
  }

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
 *  Serialization: WeekPlan -> the app's relational training program shape.
 *  training_exercises.category is a CHECK enum; lifting has no exact bucket, so
 *  arm-care / corrective / prep map to 'recovery' and everything else to
 *  'conditioning'. The real block label lives in `description`.
 * --------------------------------------------------------------------------- */
function categoryForBlock(label) {
  const l = label.toLowerCase();
  if (l.includes('arm care') || l.includes('corrective') || l.includes('prep')) return 'recovery';
  return 'conditioning';
}

/**
 * Map a generated week to rows for insert into training_days / training_exercises.
 * @returns {Array<{title, notes, exercises: Array<{category,name,description,reps,sort_order}>}>}
 */
export function weekToProgramDays(week) {
  return week.days.map((day) => ({
    title: day.name,
    notes: day.focus,
    exercises: day.blocks.map((b, i) => ({
      category: categoryForBlock(b.label),
      name: b.exercise,
      description: b.why ? `${b.label} — ${b.why}` : b.label,
      reps: b.prescription,
      sort_order: i,
    })),
  }));
}

/* --------------------------------------------------------------------------- *
 *  Full off-season macrocycle: generate a representative week for every phase
 *  the athlete passes through from planStart to seasonEnd, in order.
 * --------------------------------------------------------------------------- */

/**
 * @returns {Array} one generateWeek() result per distinct phase in the macro
 *   calendar (Accumulation -> Strength -> Power -> Pre-season -> In-season …),
 *   each carrying its own phase label, emphasis, days and flags.
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
