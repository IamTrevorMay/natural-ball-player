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
   file holds only the pure engine + a serializer into the app's program shape.
   Theme/color constants from the source are intentionally dropped (UI concern) —
   readiness/phase color is derived from the returned status token by the page.
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

export function readiness(whoop, hrv, soreness) {
  let score = whoop;
  if (hrv === 'down') score -= 12;
  if (hrv === 'up') score += 6;
  score += { none: 0, mild: -6, moderate: -18, high: -40 }[soreness];
  score = Math.max(0, Math.min(100, score));
  if (soreness === 'high') {
    return { status: 'REST', score, intentMult: 0, volMult: 0.2, headline: 'Arm care & full rest',
      detail: 'High arm soreness overrides the plan — recovery work only. Joint pain or >24h soreness needs evaluation.' };
  }
  if (score >= 67) {
    return { status: 'GO', score, intentMult: 1.0, volMult: 1.0, headline: 'Green — execute as programmed',
      detail: 'Recovery supports today\'s intent and volume. Proceed.' };
  }
  if (score >= 40) {
    return { status: 'MODIFY', score, intentMult: 0.85, volMult: 0.8, headline: 'Amber — throttle intent & volume',
      detail: 'Drop one intent tier, cap volume ~80%. Keep movement, lose max effort.' };
  }
  return { status: 'CAUTION', score, intentMult: 0.55, volMult: 0.5, headline: 'Red — recovery-biased day',
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

/* Build a 7-day microcycle, data-anchored. */
export function buildWeek({ levelId, posId, phaseId, typeId, mob, str, bio, ready, weekInPhase }) {
  const pos = POSITIONS[posId];
  const phase = PHASES[phaseId];
  const at = ATHLETE_TYPES[typeId];
  const gates = assessmentGates(mob, str, bio);
  const isP = pos.group === 'P';
  const demand = gameDemand(posId, levelId);
  const intentCeiling = Math.min(phase.intentCap, pos.intentCap, gates.maxIntentTier);

  // Pitchers scale training days off a catch-volume base; fielders off measured total.
  const anchor = isP ? 55 : demand.total;
  const baseDaily = anchor * phase.volMult * at.volAdj;

  const DT = {
    OFF: { t: 0, m: false, label: 'Off', focus: 'Full rest', f: 0 },
    CARE: { t: 0, m: false, label: 'Arm care', focus: 'Bands / plyo recovery, mobility', f: 0 },
    RECOVERY: { t: 55, m: false, label: 'Recovery catch', focus: 'Light, short, easy', f: 0.5 },
    LOW: { t: 68, m: false, label: 'Low intent', focus: 'Extension catch / long-toss out', f: 0.85 },
    MED: { t: 82, m: false, label: 'Medium intent', focus: 'Hybrid: extension + light compression', f: 1.0 },
    HIGH: { t: 96, m: pos.moundHeavy, label: 'High intent', focus: 'Pulldowns / plyo-velo / mound velo', f: 0.9 },
    LONGTOSS: { t: 85, m: false, label: 'Long toss', focus: 'Extension out, compression in', f: 1.1 },
    MOUND: { t: 88, m: true, label: 'Mound / pen', focus: 'Bullpen — build feel & count', f: 1.0 },
    LIVE: { t: 100, m: true, label: 'Live / outing', focus: 'Compete: game or live ABs', f: 1.15 },
    TOUCH: { t: 70, m: true, label: 'Touch-and-feel pen', focus: 'Short low pen, command', f: 0.5 },
    FIELD: { t: 85, m: false, label: 'Position work', focus: 'Defensive reps at game intent', f: 0.9 },
    THROWDOWN: { t: 92, m: false, label: 'Throwdowns', focus: 'Pop-time / footwork throws', f: 0.8 },
  };

  function skeleton() {
    const w = Math.max(1, weekInPhase);
    switch (phaseId) {
      case 'DELOAD': return ['CARE', 'RECOVERY', 'OFF', 'RECOVERY', 'CARE', 'OFF', 'RECOVERY'];
      case 'ONRAMP': return ['LOW', 'CARE', w >= 3 ? 'LONGTOSS' : 'LOW', 'OFF', 'LOW', 'CARE', w >= 4 ? 'MED' : 'RECOVERY'];
      case 'VELO': {
        const hi = gates.canVelo ? 'HIGH' : 'MED';
        return isP ? [hi, 'RECOVERY', 'LONGTOSS', 'CARE', hi, 'RECOVERY', 'OFF']
          : ['FIELD', hi, 'RECOVERY', 'LONGTOSS', 'CARE', hi, 'OFF'];
      }
      case 'PRESEASON':
        return isP ? ['MOUND', 'RECOVERY', 'LONGTOSS', 'CARE', 'MOUND', w >= 3 ? 'LIVE' : 'MED', 'OFF']
          : ['FIELD', posId === 'C' ? 'THROWDOWN' : 'LONGTOSS', 'RECOVERY', 'FIELD', 'CARE', 'LIVE', 'OFF'];
      case 'INSEASON':
        if (posId === 'SP' || posId === 'SW') return ['LIVE', 'RECOVERY', 'CARE', 'TOUCH', 'LONGTOSS', 'OFF', 'LIVE'];
        if (posId === 'RP') return ['LIVE', 'CARE', 'LIVE', 'RECOVERY', 'LIVE', 'CARE', 'OFF'];
        if (posId === 'TW') return ['LIVE', 'RECOVERY', 'FIELD', 'TOUCH', 'FIELD', 'OFF', 'LIVE'];
        return ['LIVE', 'FIELD', 'LIVE', 'CARE', 'LIVE', 'FIELD', 'OFF'];
      case 'POSTSEASON':
        return w >= 3 ? ['OFF', 'CARE', 'OFF', 'OFF', 'CARE', 'OFF', 'OFF']
          : ['RECOVERY', 'CARE', 'OFF', 'RECOVERY', 'OFF', 'CARE', 'OFF'];
      default: return Array(7).fill('OFF');
    }
  }

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return skeleton().map((key, i) => {
    const spec = DT[key] || DT.OFF;
    let intent = Math.min(spec.t, intentCeiling);
    if (spec.t > 0) intent = Math.round(intent * ready.intentMult);

    let throws = Math.round(baseDaily * spec.f * ready.volMult);
    if (isP && key === 'LIVE') throws = Math.round(demand.pitches * ready.volMult);
    if (isP && key === 'MOUND') throws = Math.round(demand.pitches * 0.5 * ready.volMult);
    if (spec.t === 0) throws = 0;

    let distance = null;
    if (phaseId === 'ONRAMP' && spec.t > 0) {
      const idx = Math.min(ITP_LADDER.length - 1, Math.floor((weekInPhase - 1) / 1.2) + (key === 'LONGTOSS' ? 2 : 0));
      distance = `${ITP_LADDER[Math.max(0, Math.min(ITP_LADDER.length - 1, idx))]} ft`;
    } else if (key === 'LONGTOSS') {
      distance = isP ? '≤300 ft pulldown' : `150–${demand.dist || 250} ft`;
    } else if (['MOUND', 'LIVE', 'TOUCH'].includes(key)) {
      distance = 'Mound 60\'6"';
    } else if (spec.t > 0) {
      distance = isP ? '60–120 ft' : (posId === 'OF' ? `150–${demand.dist} ft` : `≤${demand.dist} ft`);
    }

    let ps = null;
    if (isP && (key === 'LIVE' || key === 'MOUND')) { ps = pitchSmartByLevel(levelId, throws); ps.pitches = throws; }

    return { day: days[i], code: key, label: spec.label, focus: spec.focus, intent, throws,
      mound: spec.m, distance, su: Math.round(stressUnits(throws, intent || 1, spec.m)), ps };
  });
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
 *  Serialization: 7-day microcycle -> the app's relational program shape.
 *  training_exercises.category is a CHECK enum; mound/live/pen -> 'pitching',
 *  catch/long-toss/field -> 'conditioning', arm-care/off -> 'recovery'.
 * --------------------------------------------------------------------------- */
function categoryForCode(code) {
  if (['MOUND', 'LIVE', 'TOUCH'].includes(code)) return 'pitching';
  if (['CARE', 'OFF'].includes(code)) return 'recovery';
  return 'conditioning';
}

/**
 * Map a built week (array of 7 day objects from buildWeek) to program days.
 * @returns {Array<{title, notes, exercises: Array<{category,name,description,reps,sort_order}>}>}
 */
export function weekToProgramDays(week) {
  return week.map((d) => {
    const bits = [d.focus];
    if (d.distance) bits.push(d.distance);
    if (d.intent > 0) bits.push(`${d.intent}% intent`);
    if (d.ps) bits.push(d.ps.over ? `⚠ OVER CAP (${d.ps.max})` : `Pitch Smart: ${d.ps.rest}d rest`);
    return {
      title: `${d.day} — ${d.label}`,
      notes: d.focus,
      exercises: [{
        category: categoryForCode(d.code),
        name: d.label,
        description: bits.join(' · '),
        reps: d.throws ? `${d.throws} throws` : '—',
        sort_order: 0,
      }],
    };
  });
}
