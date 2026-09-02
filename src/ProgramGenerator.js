import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Dumbbell, Search, User, Wand2, Save, AlertTriangle, Calendar, ChevronDown, ChevronUp, Check, BarChart3 } from 'lucide-react';
import { extractMetricSourcesFromSubmissions, parseMetricValue, toRelativeStrength } from './assessmentMetrics';
import AssessmentReadiness from './AssessmentReadiness';
import TrainingDaysPicker, {
  ALL_TRAINING_DAYS, weekdayPlacement, fitMessage, formatDays,
} from './TrainingDaysPicker';
import {
  Position, Sex, makeAthlete, trainingStage, maturityBand, loadStyle,
  generateProgram, programToProgramDays, macroCalendar,
  SC_LEVEL_NAME, SC_METRICS, SC_KIND_COLOR, BIAS_LABEL,
} from './scProgramEngine';

/* --------------------------------------------------------------------------- *
 *  S&C Program Generator (issue: NBP Systems Development — engine #1)
 *
 *  Assessment-driven baseball strength & conditioning generator. Auto-fills an
 *  athlete's demographics + latest physical assessment, benchmarks their force
 *  metrics vs level, runs the conjugate / Olympic-derivative engine
 *  (scProgramEngine.js), and builds a 1-16 week program with true week-over-week
 *  progression — Lower / Upper / Dynamic-Effort Lower / DE Upper (or an in-season
 *  DE split). Writes into training_programs / _days / _exercises with absolute
 *  calendar-day offsets so the schedule lands each session on the right day.
 * --------------------------------------------------------------------------- */

const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbell', 'bands', 'medball', 'trapbar', 'ssb', 'box',
  'landmine', 'football_bar', 'pullup_bar', 'chains',
  'sled', 'deadlift_platform', 'squat_rack', 'cable_machine', 'kettlebells',
  'multi_grip_bar', 'leg_machines', 'belt_squat', 'trx_band',
];

const ageFromDob = (dob) => {
  if (!dob) return null;
  const age = Math.floor((new Date() - new Date(dob + 'T00:00:00')) / (365.25 * 24 * 60 * 60 * 1000));
  return Number.isFinite(age) ? age : null;
};

// Map a player_profiles.position string to an engine Position.
function positionFromProfile(pos) {
  const p = String(pos || '').toLowerCase();
  if (/pitch|\bp\b|rhp|lhp|sp|rp/.test(p)) return Position.PITCHER;
  if (/catch|\bc\b/.test(p)) return Position.CATCHER;
  if (/two.?way|util/.test(p)) return Position.TWO_WAY;
  return Position.POSITION;
}

// Best-effort: pull numeric physical-screen fields out of an assessment
// submission by fuzzy-matching element labels. Returns { assessment, matched[] }.
function mapAssessmentFromSubmission(submission) {
  const out = {};
  const matched = [];
  if (!submission) return { assessment: out, matched };
  const schema = submission.assessment_templates?.schema || [];
  const responses = submission.responses || {};

  // Flatten scalar responses into { labelLower: rawValue }.
  const pairs = [];
  for (const el of schema) {
    if (!el || !el.id) continue;
    const val = responses[el.id];
    if (val == null || typeof val === 'object') continue; // skip tables/complex
    pairs.push([String(el.label || '').toLowerCase(), val]);
  }

  /* Parse through the SHARED canonical parser (#351). A bare parseFloat here
     read "22.6 / 21.4" as 22.6 and "R-115 L-88" as null, and it bypassed the
     multi-trial policy and the plausibility guards that the shared registry
     applies — so this local matcher, which OUTRANKS the shared fuzzy layer in
     PRECEDENCE below, could hand the engine a number the shared layer had
     already rejected. `metricKey` is the canonical key this screen field holds,
     and is what selects the right range + trial direction. */
  const find = (metricKey, test) => {
    for (const [label, val] of pairs) {
      if (test(label)) { const n = parseMetricValue(val, metricKey); if (n != null) return { label, n }; }
    }
    return null;
  };
  const assign = (key, hit) => {
    if (hit) { out[key] = hit.n; matched.push(`${key} ← "${hit.label}" (${hit.n})`); }
  };

  assign('shoulder_ir_dom', find('shoulder_ir', (l) => l.includes('shoulder') && l.includes('ir') && (l.includes('dom') || l.includes('throw'))));
  assign('shoulder_ir_nondom', find('shoulder_ir', (l) => l.includes('shoulder') && l.includes('ir') && (l.includes('non') || l.includes('glove'))));
  // #352 QA: l.includes('er') is satisfied by the word "should-ER" itself, so a
  // sheet carrying only Shoulder IR silently filled BOTH the IR and the ER
  // field with the same number. Require ER as its own word.
  assign('shoulder_er_dom', find('shoulder_er', (l) => l.includes('shoulder') && /\ber\b/.test(l) && (l.includes('dom') || l.includes('throw'))));
  assign('total_rom_deficit', find('shoulder_rom_deficit', (l) => l.includes('total') && (l.includes('rom') || l.includes('motion'))));
  assign('hip_ir_deg', find('hipir', (l) => l.includes('hip') && l.includes('ir')));
  assign('ankle_dorsiflexion_cm', find('ankle', (l) => l.includes('ankle') || l.includes('knee-to-wall') || l.includes('knee to wall') || l.includes('dorsi')));
  assign('tspine_rotation_deg', find('tspine', (l) => (l.includes('t-spine') || l.includes('tspine') || l.includes('thoracic')) && l.includes('rot')));
  // #352 QA: this local matcher outranks the shared one, so leaving the CMJ
  // alternatives here re-blended the two jumps whenever a template listed
  // "Counter-Movement Jump" before "Vertical Jump" and neither was tagged —
  // both fields then showed the CMJ and the real vertical jump never appeared.
  // Vertical jump means vertical jump; the CMJ has its own field below.
  assign('vertical_jump_in', find('vertical_jump', (l) => l.includes('vertical') && l.includes('jump')
    && !l.includes('seated') && !l.includes('approach') && !l.includes('depth')));
  // #351: the other three jumps on the same sheet, each claiming only its own
  // label. Display/capture only — they grade nothing (see scProgramEngine).
  assign('seated_vertical_jump_in', find('seated_vertical_jump', (l) => l.includes('seated') && l.includes('jump')));
  assign('approach_vertical_jump_in', find('approach_vertical_jump', (l) => l.includes('approach') && l.includes('jump')));
  assign('depth_drop_jump_in', find('depth_drop_jump', (l) => l.includes('depth') && l.includes('drop') && l.includes('jump')));
  assign('cmj_in', find('cmj', (l) => l.includes('cmj') || l.includes('counter-movement') || l.includes('counter movement')));
  assign('broad_jump_in', find('broad_jump', (l) => l.includes('broad') && l.includes('jump')));
  assign('rel_squat', find('back_squat', (l) => l.includes('squat') && (l.includes('bw') || l.includes('body') || l.includes('relative') || l.includes('×') || l.includes('x bw'))));
  // RAW as written (per Cordell, pounds). Converted to × BW in loadAthlete(),
  // where the athlete's body weight from every submission is available.
  assign('rel_trap_bar_dl', find('dl', (l) => (l.includes('trap') || l.includes('deadlift')) && (l.includes('bw') || l.includes('body') || l.includes('relative') || l.includes('×'))));

  return { assessment: out, matched };
}

// Fuzzy-map across MANY submissions (newest-first): keep the most-recent value
// per screen field so an athlete's mobility screen, force test and any other
// past assessment all contribute. Returns { assessment, matched[], count }.
function mapAssessmentFromSubmissions(submissions) {
  const out = {};
  const matched = [];
  if (!Array.isArray(submissions)) return { assessment: out, matched, count: 0 };
  for (const sub of submissions) {
    const one = mapAssessmentFromSubmission(sub);
    for (const [k, v] of Object.entries(one.assessment)) {
      if (out[k] === undefined) { out[k] = v; matched.push(k); }
    }
  }
  return { assessment: out, matched, count: submissions.length };
}

// A blank string-keyed form (so inputs are controlled). Numbers parsed at gen.
const BLANK_ASSESSMENT = {
  shoulder_ir_dom: '', shoulder_ir_nondom: '', shoulder_er_dom: '', total_rom_deficit: '',
  hip_ir_deg: '', ankle_dorsiflexion_cm: '', tspine_rotation_deg: '',
  vertical_jump_in: '', cmj_in: '', seated_vertical_jump_in: '', approach_vertical_jump_in: '',
  depth_drop_jump_in: '', broad_jump_in: '', rel_squat: '', rel_trap_bar_dl: '',
  single_leg_stability: '', movement_competency: 'developing',
};

// Canonical assessment metric_key -> this generator's screen field [field, unitMultiplier].
// Jumps are stored and displayed in inches throughout (registry, screen, and benchmarks), so no conversion.
const SC_KEY_MAP = {
  hipir: ['hip_ir_deg', 1],
  tspine: ['tspine_rotation_deg', 1],
  ankle: ['ankle_dorsiflexion_cm', 1],
  shoulder_ir: ['shoulder_ir_dom', 1],
  shoulder_er: ['shoulder_er_dom', 1],
  shoulder_rom_deficit: ['total_rom_deficit', 1],
  // #352: the standing vertical jump drives vertical_jump_in — the SC_BM bands
  // were calibrated on it (304 of 307 live submissions are vertical-jump data),
  // so keeping it here preserves current grading. CMJ is its own field.
  vertical_jump: ['vertical_jump_in', 1],
  cmj: ['cmj_in', 1],
  // #351: captured & shown, never graded — no SC_BM band exists for these.
  seated_vertical_jump: ['seated_vertical_jump_in', 1],
  approach_vertical_jump: ['approach_vertical_jump_in', 1],
  depth_drop_jump: ['depth_drop_jump_in', 1],
  broad_jump: ['broad_jump_in', 1],
  // byKey.dl is ALREADY a bodyweight multiple — extractMetricSourcesFromSubmissions
  // converts the recorded pound figure using the athlete's body weight, and drops
  // the metric entirely when no body weight is on file (#351).
  dl: ['rel_trap_bar_dl', 1],
};

const ASSESSMENT_FIELDS = [
  ['shoulder_ir_dom', 'Shoulder IR — throwing (°)'],
  ['shoulder_ir_nondom', 'Shoulder IR — glove (°)'],
  ['shoulder_er_dom', 'Shoulder ER — throwing (°)'],
  ['total_rom_deficit', 'Total ROM deficit (°)'],
  ['hip_ir_deg', 'Hip IR (°)'],
  ['ankle_dorsiflexion_cm', 'Ankle dorsiflexion (cm)'],
  ['tspine_rotation_deg', 'T-spine rotation (°)'],
  ['vertical_jump_in', 'Vertical jump (in)'],
  ['cmj_in', 'Counter-movement jump (in)'],
  ['seated_vertical_jump_in', 'Seated vertical jump (in)'],
  ['approach_vertical_jump_in', 'Approach vertical jump (in)'],
  ['depth_drop_jump_in', 'Depth drop jump (in)'],
  ['broad_jump_in', 'Broad jump (in)'],
  ['rel_squat', 'Back squat (× BW)'],
  ['rel_trap_bar_dl', 'Trap-bar deadlift (× BW)'],
];

/* #385 — the weekdays scProgramEngine puts its sessions on by default, keyed by
   session count (3 in-season, 4 off-season). Mon=0…Sun=6, mirroring the engine's
   own WD constants. */
const SC_DEFAULT_WEEKDAYS = { 3: [0, 1, 3], 4: [0, 1, 3, 4] }; // Mon/Tue/Thu (+Fri)

/* Resolve a session count onto the coach's available days. Returns null when that
   many sessions cannot fit. Crucially, when the engine's OWN days are all still
   available this returns those exact days, so the all-seven default is a true
   no-op — an even spread across seven days would be Mon/Wed/Fri/Sun and would
   silently move every existing program. */
function scWeekdaySlots(count, allowed) {
  const dflt = SC_DEFAULT_WEEKDAYS[count];
  const p = weekdayPlacement(dflt, allowed);
  if (!p.ok) return null;
  return p.moved ? dflt.map((d) => p.map.get(d)) : dflt;
}

const iso = (d) => d.toISOString().slice(0, 10);
function defaultSeason() {
  // Sensible default: a spring season for the current/next year.
  const y = new Date().getFullYear();
  const start = new Date(new Date() > new Date(`${y}-03-01`) ? y + 1 : y, 2, 1); // Mar 1
  const end = new Date(start.getFullYear(), 5, 30); // Jun 30
  return { start: iso(start), end: iso(end) };
}

const KIND_HEX = { violet: '#8b5cf6', cyan: '#06b6d4', amber: '#f59e0b', green: '#22c55e', blue: '#3b82f6', gray: '#9ca3af' };
const STATUS_CLR = { good: 'text-green-600', dev: 'text-amber-600', def: 'text-red-600' };

// Dev/good zone bar for one graded force metric (mirrors HittingGenerator's MetricBar).
function MetricBar({ mkey, s }) {
  if (!s) return null;
  const label = SC_METRICS.find((m) => m.key === mkey)?.label || mkey;
  const min = s.dev[0] * 0.8;
  const max = s.good * 1.25;
  const span = max - min || 1;
  const clamp = (x) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
  const devL = clamp(s.dev[0]);
  const devR = clamp(s.dev[1]);
  const goodL = clamp(s.good);
  const pos = clamp(s.value);
  const note = `dev ${s.dev[0]}–${s.dev[1]}${s.unit} · target ≥${s.good}${s.unit}`;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={`font-mono font-bold ${STATUS_CLR[s.status]}`}>{Math.round(s.value * 100) / 100}{s.unit}</span>
      </div>
      <div className="relative h-2 rounded bg-gray-100">
        <div className="absolute h-full bg-amber-200 rounded" style={{ left: `${devL}%`, width: `${Math.max(0, devR - devL)}%` }} />
        <div className="absolute h-full bg-green-300 rounded" style={{ left: `${goodL}%`, width: `${Math.max(0, 100 - goodL)}%` }} />
        <div className="absolute w-1 h-3 -top-0.5 bg-gray-900 rounded" style={{ left: `calc(${pos}% - 2px)` }} />
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">{note}</div>
    </div>
  );
}

export default function ProgramGenerator({ userId, userRole }) {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedName, setSelectedName] = useState('');
  const [loadingAthlete, setLoadingAthlete] = useState(false);
  const [autoNote, setAutoNote] = useState('');

  // Engine inputs (controlled strings where numeric).
  const [position, setPosition] = useState(Position.POSITION);
  const [sex, setSex] = useState(Sex.MALE);
  const [chronoAge, setChronoAge] = useState('16');
  const [trainingMonths, setTrainingMonths] = useState('12');
  const [equipment, setEquipment] = useState([...EQUIPMENT_OPTIONS]);
  const [injuries, setInjuries] = useState('');
  const [recentPitchCount, setRecentPitchCount] = useState('0');
  const [assessment, setAssessment] = useState({ ...BLANK_ASSESSMENT });

  const season = useMemo(defaultSeason, []);
  const [seasonStart, setSeasonStart] = useState(season.start);
  const [seasonEnd, setSeasonEnd] = useState(season.end);
  const [planDate, setPlanDate] = useState(iso(new Date()));

  // Program length (weeks) — independent of season; the coach picks a duration.
  const [programLength, setProgramLength] = useState('8');
  const [autoFit, setAutoFit] = useState(false);

  /* #385 — weekdays the athlete is actually available to lift on (Mon=0…Sun=6).
     Defaults to all seven, which reproduces the engine's own Mon/Tue/Thu/Fri
     split exactly, so ignoring this control changes nothing. */
  const [trainingDays, setTrainingDays] = useState([...ALL_TRAINING_DAYS]);
  const [dayFitError, setDayFitError] = useState('');
  const scSlots = useMemo(() => ({
    3: scWeekdaySlots(3, trainingDays),
    4: scWeekdaySlots(4, trainingDays),
  }), [trainingDays]);

  const [program, setProgram] = useState(null);
  const [macro, setMacro] = useState([]);
  const [openDays, setOpenDays] = useState({});

  const [programName, setProgramName] = useState('');
  const [assignAthlete, setAssignAthlete] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');

  // Roster (respects coach team scoping, mirrors CoachTools).
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from('users')
        .select('id, full_name, player_profiles!player_profiles_user_id_fkey(position, throws)')
        .in('role', ['player', 'coach', 'admin'])
        .order('full_name');
      if (e) { setError(e.message); return; }
      let filtered = data || [];
      if (userRole === 'coach') {
        const { data: coachTeams } = await supabase.from('team_members').select('team_id').eq('user_id', userId);
        const teamIds = (coachTeams || []).map((t) => t.team_id);
        const { data: members } = await supabase.from('team_members').select('user_id').in('team_id', teamIds.length ? teamIds : ['00000000-0000-0000-0000-000000000000']);
        const allowed = new Set((members || []).map((m) => m.user_id));
        filtered = filtered.filter((p) => allowed.has(p.id));
      }
      setPlayers(filtered);
    })();
  }, [userId, userRole]);

  const selectAthlete = useCallback(async (p) => {
    setSelectedId(p.id);
    setSelectedName(p.full_name);
    setSearch('');
    setLoadingAthlete(true);
    setProgram(null);
    setError('');
    try {
      const { data: u } = await supabase
        .from('users')
        .select('date_of_birth, player_profiles!player_profiles_user_id_fkey(position, throws, training_age_months)')
        .eq('id', p.id)
        .single();
      const pp = Array.isArray(u?.player_profiles) ? u.player_profiles[0] : u?.player_profiles;
      const age = ageFromDob(u?.date_of_birth);
      if (age != null) setChronoAge(String(age));
      if (pp?.position) setPosition(positionFromProfile(pp.position));
      if (pp?.training_age_months != null) setTrainingMonths(String(pp.training_age_months));

      // ALL assessment submissions (newest-first) so mobility, force and any
      // other past screens all feed the program — each field from the newest
      // assessment that measured it (#1/#11).
      const { data: subs } = await supabase
        .from('assessment_submissions')
        .select('id, assessment_date, responses, assessment_templates(name, schema)')
        .eq('player_id', p.id)
        .order('assessment_date', { ascending: false })
        .limit(50);
      const subList = subs || [];
      const { assessment: mapped } = mapAssessmentFromSubmissions(subList);
      const { values: byKey, sources: bySource } = extractMetricSourcesFromSubmissions(subList);
      const toField = (mk) => {
        const spec = SC_KEY_MAP[mk];
        if (!spec || byKey[mk] == null) return null;
        return [spec[0], String(Math.round(byKey[mk] * spec[1] * 100) / 100)];
      };
      const layerFor = (want) => Object.fromEntries(
        Object.keys(SC_KEY_MAP)
          .filter((mk) => bySource[mk] === want)
          .map(toField)
          .filter(Boolean),
      );
      /* PRECEDENCE — strongest evidence first (#351c).
         This used to be an object spread in which `...keyed` came AFTER
         `...mapped`. `keyed` mixed explicitly-tagged values together with the
         SHARED, looser fuzzy fallback, so a loose label guess silently
         overrode this generator's stricter local matcher — that is how
         "Trap Bar Jump (in):" beat the local matcher (which correctly requires
         bw|body|relative|×) and landed a jump height in rel_trap_bar_dl.
         Written as an explicit ordered list so the ordering is visible and
         cannot invert again by someone reordering a spread. The FIRST layer to
         supply a field wins; later layers only fill gaps. */
      const PRECEDENCE = [
        layerFor('tag'),                                                            // 1. explicit metric_key tag — authoritative
        Object.fromEntries(Object.entries(mapped).map(([k, v]) => [k, String(v)])), // 2. this generator's strict local matcher
        layerFor('fuzzy'),                                                          // 3. shared fuzzy label fallback — weakest
      ];
      const resolved = {};
      for (const layer of PRECEDENCE) {
        for (const [field, val] of Object.entries(layer)) if (resolved[field] === undefined) resolved[field] = val;
      }
      /* #351 — TRAP-BAR DEADLIFT IS IN POUNDS. Cordell: "We always write the
         weight in pounds." The template labels it "(X BW)" and SC_BM grades it
         as a bodyweight multiple (pro = 2.8x), so the one real value on file,
         405, graded ~145x — off the top of every band, flipping the plan to
         "express power" and unlocking advanced lifts.
         Applied HERE, after PRECEDENCE, so it covers all three layers: layers 1
         and 3 come from byKey (already converted upstream) and re-running the
         conversion on a value that is already single-digit is a no-op, while
         layer 2 is this file's own matcher and is still raw.
         No body weight on file -> the field is left EMPTY. Not graded beats
         graded on a number we cannot interpret. */
      if (resolved.rel_trap_bar_dl !== undefined) {
        const rel = toRelativeStrength(parseFloat(resolved.rel_trap_bar_dl), byKey.body_weight);
        if (rel == null) delete resolved.rel_trap_bar_dl;
        else resolved.rel_trap_bar_dl = String(rel);
      }
      const filledCount = Object.keys(resolved).length;
      if (filledCount) {
        setAssessment((a) => ({ ...a, ...resolved }));
        const newest = String(subList[0]?.assessment_date || '').slice(0, 10);
        setAutoNote(`Auto-filled ${filledCount} field(s) from the athlete's assessments (most recent ${newest || 'n/a'}; each field uses the newest assessment that measured it). Review & edit below.`);
      } else {
        setAssessment({ ...BLANK_ASSESSMENT });
        setAutoNote(subList.length ? 'Past assessments had no auto-mappable numeric fields — enter the screen manually.' : 'No assessment on file — enter the screen manually (blank = conservative thrower-deficit assumption).');
      }
      if (byKey.training_age != null) setTrainingMonths(String(Math.round(byKey.training_age)));
      setProgramName(`${p.full_name} — S&C Program`);
    } catch (e) {
      setError(e.message || 'Failed to load athlete.');
    } finally {
      setLoadingAthlete(false);
    }
  }, []);

  const toggleEquip = (item) =>
    setEquipment((eq) => (eq.includes(item) ? eq.filter((x) => x !== item) : [...eq, item]));

  const buildAthlete = useCallback(() => {
    const numOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
    return makeAthlete({
      name: selectedName || 'Athlete',
      chrono_age: numOrNull(chronoAge) ?? 16,
      position,
      sex,
      training_age_months: numOrNull(trainingMonths) ?? 0,
      equipment,
      injury_history: injuries.split(',').map((s) => s.trim()).filter(Boolean),
      recent_game_pitch_count: numOrNull(recentPitchCount) ?? 0,
      assessment: {
        shoulder_ir_dom: numOrNull(assessment.shoulder_ir_dom),
        shoulder_ir_nondom: numOrNull(assessment.shoulder_ir_nondom),
        shoulder_er_dom: numOrNull(assessment.shoulder_er_dom),
        total_rom_deficit: numOrNull(assessment.total_rom_deficit),
        hip_ir_deg: numOrNull(assessment.hip_ir_deg),
        ankle_dorsiflexion_cm: numOrNull(assessment.ankle_dorsiflexion_cm),
        tspine_rotation_deg: numOrNull(assessment.tspine_rotation_deg),
        vertical_jump_in: numOrNull(assessment.vertical_jump_in),
        cmj_in: numOrNull(assessment.cmj_in),
        // Carried onto the athlete object so the generator can show them; the
        // engine reads none of them (display only until real benchmark bands
        // exist).
        // ⚠️ NOT PERSISTED. `saveProgram` writes only name/description/
        // duration_weeks/created_by, and `training_programs` has no columns for
        // any assessment value — so these are re-derived from the athlete's
        // assessment on every load and are NOT stored with the program. An
        // earlier version of this comment claimed they were saved; they are
        // not. Storing them needs new columns (a migration), which is a
        // separate job. Do not tell Cordell these are being captured.
        seated_vertical_jump_in: numOrNull(assessment.seated_vertical_jump_in),
        approach_vertical_jump_in: numOrNull(assessment.approach_vertical_jump_in),
        depth_drop_jump_in: numOrNull(assessment.depth_drop_jump_in),
        broad_jump_in: numOrNull(assessment.broad_jump_in),
        rel_squat: numOrNull(assessment.rel_squat),
        rel_trap_bar_dl: numOrNull(assessment.rel_trap_bar_dl),
        single_leg_stability: assessment.single_leg_stability || null,
        movement_competency: assessment.movement_competency || 'developing',
      },
    });
  }, [selectedName, chronoAge, position, sex, trainingMonths, equipment, injuries, recentPitchCount, assessment]);

  const generate = () => {
    setError('');
    setSaveMsg('');
    try {
      const ath = buildAthlete();
      const ss = new Date(seasonStart + 'T00:00:00');
      const se = new Date(seasonEnd + 'T00:00:00');
      const pd = new Date(planDate + 'T00:00:00');
      let len = Math.max(1, Math.min(16, parseInt(programLength, 10) || 1));
      if (autoFit) {
        const w = Math.ceil((se - pd) / (7 * 24 * 60 * 60 * 1000));
        len = Math.max(1, Math.min(16, w || 1));
        setProgramLength(String(len));
      }
      /* #385 — put the week's sessions on the days the athlete is available.
         scSlots holds a weekday list per session count (3 in-season / 4 off-season),
         or null for a count that cannot fit the chosen days. A null makes the engine
         fall back to its own Mon/Tue/Thu/Fri split, which would quietly ignore the
         coach — so we generate, look at how many sessions the heaviest week actually
         wants, and refuse to KEEP a program whose count had no slot list. */
      const weekdays = scSlots;
      const prog = generateProgram(ath, pd, ss, se, len, { weekdays });
      const needed = Math.max(...prog.weeks.map((w) => w.days.length));
      if (!weekdays[needed]) {
        const msg = fitMessage(needed, trainingDays.length);
        setDayFitError(msg);
        setError(`This ${len}-week block has ${needed} sessions in its heaviest week. ${msg}`);
        setProgram(null);
        setMacro([]);
        return;
      }
      setDayFitError('');
      setProgram(prog);
      // Training age is owned by the athlete's profile (edit it on the Profile → General tab).
      // The generator only reads it, so we no longer write it back here.
      setMacro(macroCalendar(ath, ss, se, pd));
      // Open the first week's days by default; keep the rest collapsed.
      setOpenDays(Object.fromEntries((prog.weeks[0]?.days || []).map((_, i) => [`0-${i}`, true])));
    } catch (e) {
      setError(e.message || 'Generation failed.');
    }
  };

  const save = async () => {
    if (!program) return;
    setSaving(true);
    setError('');
    setSaveMsg('');
    try {
      const rows = programToProgramDays(program);
      const durationWeeks = program.lengthWeeks;
      const endDate = iso(new Date(new Date(planDate + 'T00:00:00').getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000));
      const description = `${program.phaseLabel} · ${durationWeeks}-wk progression · ${program.emphasis} (generated ${iso(new Date())})`;

      const { data: prog, error: pErr } = await supabase
        .from('training_programs')
        .insert({ name: programName || `${selectedName} — S&C Program`, description, duration_weeks: durationWeeks, created_by: userId })
        .select('id')
        .single();
      if (pErr) throw pErr;

      // Insert every day at its ABSOLUTE calendar-day offset (day_number) so the
      // schedule places multi-week sessions on the correct dates. Rest days emit
      // no rows, so day_number is NOT the loop index — use the row's own value.
      for (let i = 0; i < rows.length; i += 1) {
        const d = rows[i];
        const { data: dayRow, error: dErr } = await supabase
          .from('training_days')
          .insert({ program_id: prog.id, day_number: d.day_number, title: d.title, notes: d.notes })
          .select('id')
          .single();
        if (dErr) throw dErr;
        if (d.exercises.length) {
          const { error: exErr } = await supabase.from('training_exercises').insert(
            d.exercises.map((x) => ({
              day_id: dayRow.id, category: x.category, name: x.name,
              description: x.description, reps: x.reps, sort_order: x.sort_order,
            })),
          );
          if (exErr) throw exErr;
        }
      }

      if (assignAthlete && selectedId) {
        const { error: aErr } = await supabase.from('training_program_assignments').insert({
          program_id: prog.id, player_id: selectedId, start_date: planDate, end_date: endDate, assigned_by: userId,
        });
        if (aErr) throw aErr;
      }
      setSaveMsg(`Saved "${programName}"${assignAthlete ? ` and assigned to ${selectedName}` : ''}. ${rows.length} training day(s) across ${durationWeeks} week(s). It now appears in the program library${assignAthlete ? ' and on the athlete\'s profile' : ''}.`);
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const filteredPlayers = players.filter((p) =>
    p.full_name?.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 8);

  const athPreview = selectedId ? buildAthlete() : null;
  const totalWeeks = program?.lengthWeeks || 1;

  const numInput = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm';
  const label = 'block text-xs font-medium text-gray-500 mb-1';
  const card = 'bg-white rounded-lg border border-gray-200 p-5';

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-1">
        <Dumbbell className="w-7 h-7 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">S&C Program Generator</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Assessment-driven conjugate / Olympic-derivative programming for baseball. Benchmarks force output vs level,
        builds a 1-16 week progression (Lower · Upper · DE-Lower · DE-Upper), respects Pitch Smart & injury gates,
        and writes into the training-program library.
      </p>

      {error && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ------------------------------- LEFT: inputs ------------------------------ */}
        <div className="space-y-5">
          <div className={card}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Athlete</div>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                className="w-full border border-gray-300 rounded pl-8 pr-3 py-2 text-sm"
                placeholder="Search athletes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && filteredPlayers.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg">
                  {filteredPlayers.map((p) => (
                    <button key={p.id} onClick={() => selectAthlete(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />{p.full_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedName && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="font-semibold text-gray-900">{selectedName}</span>
                {loadingAthlete && <span className="text-gray-400 text-xs">loading…</span>}
              </div>
            )}
            {autoNote && <div className="mt-2 text-xs text-blue-600 bg-blue-50 rounded p-2">{autoNote}</div>}
          </div>

          {selectedId && <AssessmentReadiness athleteId={selectedId} highlight="sc" />}

          <div className={card}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Profile</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={label}>Position</span>
                <select className={numInput} value={position} onChange={(e) => setPosition(e.target.value)}>
                  <option value={Position.POSITION}>Position player</option>
                  <option value={Position.PITCHER}>Pitcher</option>
                  <option value={Position.CATCHER}>Catcher</option>
                  <option value={Position.TWO_WAY}>Two-way</option>
                </select>
              </div>
              <div>
                <span className={label}>Sex</span>
                <select className={numInput} value={sex} onChange={(e) => setSex(e.target.value)}>
                  <option value={Sex.MALE}>Male</option>
                  <option value={Sex.FEMALE}>Female</option>
                </select>
              </div>
              <div>
                <span className={label}>Age (yrs)</span>
                <input className={numInput} type="number" value={chronoAge} onChange={(e) => setChronoAge(e.target.value)} />
              </div>
              <div>
                <span className={label}>Training age (months lifting)</span>
                <input className={numInput} type="number" value={trainingMonths} onChange={(e) => setTrainingMonths(e.target.value)} />
                <span className="text-[10px] text-gray-400">Auto-filled from the athlete's profile · edit it on Profile → General</span>
              </div>
              <div>
                <span className={label}>Movement competency</span>
                <select className={numInput} value={assessment.movement_competency}
                  onChange={(e) => setAssessment((a) => ({ ...a, movement_competency: e.target.value }))}>
                  <option value="novice">Novice</option>
                  <option value="developing">Developing</option>
                  <option value="competent">Competent</option>
                </select>
              </div>
              <div>
                <span className={label}>Single-leg stability</span>
                <select className={numInput} value={assessment.single_leg_stability}
                  onChange={(e) => setAssessment((a) => ({ ...a, single_leg_stability: e.target.value }))}>
                  <option value="">— not screened —</option>
                  <option value="poor">Poor</option>
                  <option value="fair">Fair</option>
                  <option value="good">Good</option>
                </select>
              </div>
              <div className="col-span-2">
                <span className={label}>Recent outing pitch count (throwers)</span>
                <input className={numInput} type="number" value={recentPitchCount} onChange={(e) => setRecentPitchCount(e.target.value)} />
              </div>
              <div className="col-span-2">
                <span className={label}>Injury history (comma-separated: ucl, shoulder, tj_surgery…)</span>
                <input className={numInput} value={injuries} onChange={(e) => setInjuries(e.target.value)} placeholder="none" />
              </div>
            </div>
          </div>

          <div className={card}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Physical screen <span className="normal-case font-normal text-gray-400">(blank = assume common thrower deficit)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {ASSESSMENT_FIELDS.map(([key, lbl]) => (
                <div key={key}>
                  <span className={label}>{lbl}</span>
                  <input className={numInput} type="number" value={assessment[key]}
                    onChange={(e) => setAssessment((a) => ({ ...a, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Equipment</div>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_OPTIONS.map((item) => (
                <button key={item} onClick={() => toggleEquip(item)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${equipment.includes(item)
                    ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300'}`}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Season window &amp; length</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <span className={label}>Season start</span>
                <input className={numInput} type="date" value={seasonStart} onChange={(e) => setSeasonStart(e.target.value)} />
              </div>
              <div>
                <span className={label}>Season end</span>
                <input className={numInput} type="date" value={seasonEnd} onChange={(e) => setSeasonEnd(e.target.value)} />
              </div>
              <div>
                <span className={label}>Plan date</span>
                <input className={numInput} type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
              </div>
              <div>
                <span className={label}>Program length (weeks)</span>
                <input className={numInput} type="number" min="1" max="16" value={programLength} disabled={autoFit}
                  onChange={(e) => setProgramLength(e.target.value)} />
              </div>
              <div className="col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} />
                  Auto-fit length to season end (plan date → season end, capped 16 wk)
                </label>
              </div>
            </div>
          </div>

          {/* #385 — which weekdays this athlete may lift on (e.g. around Naturals practices). */}
          <div className={card}>
            <TrainingDaysPicker
              accent="blue"
              value={trainingDays}
              onChange={(d) => { setTrainingDays(d); setDayFitError(''); }}
              placedOn={scSlots[4] || scSlots[3]}
              error={dayFitError}
              note={`Off-season weeks are 4 sessions (Lower · Upper · DE-Lower · DE-Upper); in-season weeks are 3${
                scSlots[3] ? ` and land on ${formatDays(scSlots[3])}` : ''}.`}
            />
          </div>

          <button onClick={generate}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg">
            <Wand2 className="w-5 h-5" /> Generate Program
          </button>
        </div>

        {/* ------------------------------- RIGHT: output ----------------------------- */}
        <div className="space-y-5">
          {!program && (
            <div className={`${card} text-center text-gray-400 py-16`}>
              <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-40" />
              Set the athlete & inputs, then generate a periodized program.
            </div>
          )}

          {program && athPreview && (
            <>
              <div className={card}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">{program.phaseLabel} · {program.lengthWeeks}-week block</div>
                    <div className="text-lg font-bold text-gray-900">{program.athlete}</div>
                  </div>
                  <div className="text-right text-xs text-gray-500 font-mono">
                    <div>{trainingStage(athPreview)} · {maturityBand(athPreview).replace('_', '-')}</div>
                    <div>loading: {loadStyle(athPreview) === 'percent' ? '%1RM' : 'RPE'}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-600">{program.emphasis}</div>
                <div className="mt-2 text-xs text-gray-600 bg-blue-50 rounded p-2">{BIAS_LABEL[program.bias]}</div>
                <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">{program.arm_note}</div>
              </div>

              {/* Force benchmarks vs level */}
              <div className={card}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  <BarChart3 className="w-4 h-4" /> Force benchmarks · vs {SC_LEVEL_NAME[program.level]}
                </div>
                {/* #352 (Cordell): "Show it as not tested. Do not substitute it if
                    the athlete does not have the CMJ tested in their assessment."
                    An ungraded metric is named and marked Not tested rather than
                    silently omitted — an omitted row is indistinguishable from a
                    passing one, which is how the CMJ came to be back-filled from
                    the standing vertical jump in the first place. */}
                {SC_METRICS.map((m) => (program.grades[m.key] ? (
                  <MetricBar key={m.key} mkey={m.key} s={program.grades[m.key]} />
                ) : (
                  <div key={m.key} className="mb-2.5 flex justify-between text-xs">
                    <span className="text-gray-400">{m.label}</span>
                    <span className="font-mono text-gray-400">Not tested</span>
                  </div>
                )))}
                {!SC_METRICS.some((m) => program.grades[m.key]) && (
                  <div className="text-xs text-gray-400 mt-2">No force metrics screened (jumps / relative squat &amp; deadlift). Enter them to benchmark &amp; bias the plan.</div>
                )}
                {/* Collected but deliberately ungraded — no calibrated bands yet (#351). */}
                {[['seated_vertical_jump_in', 'Seated vertical jump'], ['approach_vertical_jump_in', 'Approach vertical jump'], ['depth_drop_jump_in', 'Depth drop jump']]
                  .filter(([f]) => assessment[f] !== '' && assessment[f] != null)
                  .map(([f, label]) => (
                    <div key={f} className="mb-2.5 flex justify-between text-xs">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-mono text-gray-600">{assessment[f]} in <span className="text-gray-400">· not benchmarked</span></span>
                    </div>
                  ))}
              </div>

              {/* Safety flags */}
              <div className={card}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">
                  <AlertTriangle className="w-4 h-4" /> Safety gates &amp; flags
                </div>
                <ul className="space-y-1.5">
                  {program.flags.map((f, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-2">
                      <span className="text-amber-500 mt-0.5">▸</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Phase plan timeline */}
              <div className={card}>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Phase plan · {program.lengthWeeks} weeks</div>
                <div className="flex rounded overflow-hidden h-8 mb-2">
                  {program.phases.map((ph, i) => {
                    const w = (ph.span[1] - ph.span[0] + 1) / totalWeeks * 100;
                    return (
                      <div key={i} title={ph.name} className="flex items-center justify-center text-[9px] text-white font-semibold"
                        style={{ width: `${w}%`, background: KIND_HEX[SC_KIND_COLOR[ph.kind]] }}>
                        {ph.span[1] - ph.span[0] + 1}w
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  {program.phases.map((ph, i) => (
                    <div key={i} className="text-xs flex gap-2">
                      <span className="w-2.5 h-2.5 rounded-full mt-0.5 shrink-0" style={{ background: KIND_HEX[SC_KIND_COLOR[ph.kind]] }} />
                      <span className="font-semibold text-gray-700 w-36 shrink-0">{ph.name}</span>
                      <span className="text-gray-500 w-16 shrink-0">wk {ph.span[0]}–{ph.span[1]}</span>
                      <span className="text-gray-400">{ph.focus}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Training weeks — each week's days as an accordion */}
              {program.weeks.map((wk, wi) => (
                <div key={wi} className="space-y-3">
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">Week {wk.week}</span>
                    <span className="text-xs text-gray-500">{wk.phaseName} · {wk.waveLabel}</span>
                    {wk.deload && <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">deload</span>}
                  </div>
                  {wk.days.map((day, di) => {
                    const key = `${wi}-${di}`;
                    return (
                      <DayCard key={key} day={day} cardCls={card} open={!!openDays[key]}
                        onToggle={() => setOpenDays((o) => ({ ...o, [key]: !o[key] }))} />
                    );
                  })}
                </div>
              ))}

              {/* Season phase map */}
              {macro.length > 0 && (
                <div className={card}>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                    <Calendar className="w-4 h-4" /> Season phase map
                  </div>
                  <div className="space-y-2">
                    {macro.map((m, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <span className="font-mono text-xs text-gray-400 w-24 shrink-0">{m.date}</span>
                        <span className="font-semibold text-gray-800 w-44 shrink-0">{m.phaseLabel}</span>
                        <span className="text-xs text-gray-500">{m.emphasis}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save */}
              <div className={card}>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Save to library</div>
                <label className={label}>Program name</label>
                <input className={numInput} value={programName} onChange={(e) => setProgramName(e.target.value)} />
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={assignAthlete} onChange={(e) => setAssignAthlete(e.target.checked)} />
                  Assign to {selectedName || 'athlete'} (appears on their profile)
                </label>
                <button onClick={save} disabled={saving}
                  className="mt-4 w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg">
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Program'}
                </button>
                {saveMsg && (
                  <div className="mt-3 p-3 rounded bg-green-50 border border-green-200 text-green-700 text-sm flex gap-2">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" />{saveMsg}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DayCard({ day, cardCls, open, onToggle }) {
  return (
    <div className={cardCls}>
      <button className="w-full flex items-center justify-between" onClick={onToggle}>
        <div className="text-left">
          <div className="font-bold text-gray-900">{day.name}</div>
          <div className="text-xs text-gray-500">{day.focus}</div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-1.5 pr-3 font-medium">Block</th>
                <th className="py-1.5 pr-3 font-medium">Exercise</th>
                <th className="py-1.5 font-medium">Prescription</th>
              </tr>
            </thead>
            <tbody>
              {day.blocks.map((b, j) => (
                <tr key={j} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">{b.label}</td>
                  <td className="py-2 pr-3 font-medium text-gray-800">{b.exercise}
                    {b.why && <div className="text-xs text-gray-400 font-normal">{b.why}</div>}</td>
                  <td className="py-2 text-xs text-gray-600 font-mono">{b.prescription}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
