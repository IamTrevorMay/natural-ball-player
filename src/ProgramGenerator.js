import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Dumbbell, Search, User, Wand2, Save, AlertTriangle, Calendar, ChevronDown, ChevronUp, Check } from 'lucide-react';
import {
  Position, Sex, makeAthlete, generateWeek, macroCalendar, weekToProgramDays,
  generateMacro, macroToProgramDays, trainingStage, maturityBand, loadStyle,
} from './scProgramEngine';

/* --------------------------------------------------------------------------- *
 *  S&C Program Generator (issue: NBP Systems Development — engine #1)
 *
 *  Assessment-driven baseball strength & conditioning generator. Auto-fills an
 *  athlete's demographics + latest physical assessment, runs the conjugate /
 *  Olympic-derivative engine (scProgramEngine.js), previews the week + macro
 *  calendar, and writes the result into training_programs / _days / _exercises
 *  (optionally assigning it to the athlete).
 * --------------------------------------------------------------------------- */

const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbell', 'bands', 'medball', 'trapbar', 'ssb', 'box',
  'landmine', 'football_bar', 'pullup_bar', 'chains',
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

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const find = (test) => {
    for (const [label, val] of pairs) {
      if (test(label)) { const n = num(val); if (n != null) return { label, n }; }
    }
    return null;
  };
  const assign = (key, hit) => {
    if (hit) { out[key] = hit.n; matched.push(`${key} ← "${hit.label}" (${hit.n})`); }
  };

  assign('shoulder_ir_dom', find((l) => l.includes('shoulder') && l.includes('ir') && (l.includes('dom') || l.includes('throw'))));
  assign('shoulder_ir_nondom', find((l) => l.includes('shoulder') && l.includes('ir') && (l.includes('non') || l.includes('glove'))));
  assign('shoulder_er_dom', find((l) => l.includes('shoulder') && l.includes('er') && (l.includes('dom') || l.includes('throw'))));
  assign('total_rom_deficit', find((l) => l.includes('total') && (l.includes('rom') || l.includes('motion'))));
  assign('hip_ir_deg', find((l) => l.includes('hip') && l.includes('ir')));
  assign('ankle_dorsiflexion_cm', find((l) => l.includes('ankle') || l.includes('knee-to-wall') || l.includes('knee to wall') || l.includes('dorsi')));
  assign('tspine_rotation_deg', find((l) => (l.includes('t-spine') || l.includes('tspine') || l.includes('thoracic')) && l.includes('rot')));
  assign('vertical_jump_cm', find((l) => l.includes('vertical') && l.includes('jump')));
  assign('broad_jump_cm', find((l) => l.includes('broad') && l.includes('jump')));

  return { assessment: out, matched };
}

// A blank string-keyed form (so inputs are controlled). Numbers parsed at gen.
const BLANK_ASSESSMENT = {
  shoulder_ir_dom: '', shoulder_ir_nondom: '', shoulder_er_dom: '', total_rom_deficit: '',
  hip_ir_deg: '', ankle_dorsiflexion_cm: '', tspine_rotation_deg: '',
  vertical_jump_cm: '', broad_jump_cm: '', single_leg_stability: '', movement_competency: 'developing',
};

const ASSESSMENT_FIELDS = [
  ['shoulder_ir_dom', 'Shoulder IR — throwing (°)'],
  ['shoulder_ir_nondom', 'Shoulder IR — glove (°)'],
  ['shoulder_er_dom', 'Shoulder ER — throwing (°)'],
  ['total_rom_deficit', 'Total ROM deficit (°)'],
  ['hip_ir_deg', 'Hip IR (°)'],
  ['ankle_dorsiflexion_cm', 'Ankle dorsiflexion (cm)'],
  ['tspine_rotation_deg', 'T-spine rotation (°)'],
  ['vertical_jump_cm', 'Vertical jump (cm)'],
  ['broad_jump_cm', 'Broad jump (cm)'],
];

const iso = (d) => d.toISOString().slice(0, 10);
function defaultSeason() {
  // Sensible default: a spring season for the current/next year.
  const y = new Date().getFullYear();
  const start = new Date(new Date() > new Date(`${y}-03-01`) ? y + 1 : y, 2, 1); // Mar 1
  const end = new Date(start.getFullYear(), 5, 30); // Jun 30
  return { start: iso(start), end: iso(end) };
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
  const [equipment, setEquipment] = useState(['barbell', 'dumbbell', 'bands', 'medball', 'trapbar']);
  const [injuries, setInjuries] = useState('');
  const [recentPitchCount, setRecentPitchCount] = useState('0');
  const [assessment, setAssessment] = useState({ ...BLANK_ASSESSMENT });

  const season = useMemo(defaultSeason, []);
  const [seasonStart, setSeasonStart] = useState(season.start);
  const [seasonEnd, setSeasonEnd] = useState(season.end);
  const [planDate, setPlanDate] = useState(iso(new Date()));

  const [week, setWeek] = useState(null);
  const [macro, setMacro] = useState([]);
  const [macroMode, setMacroMode] = useState(false);
  const [macroWeeks, setMacroWeeks] = useState([]);
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
        .eq('role', 'player')
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
    setWeek(null);
    setError('');
    try {
      const { data: u } = await supabase
        .from('users')
        .select('date_of_birth, player_profiles!player_profiles_user_id_fkey(position, throws)')
        .eq('id', p.id)
        .single();
      const pp = Array.isArray(u?.player_profiles) ? u.player_profiles[0] : u?.player_profiles;
      const age = ageFromDob(u?.date_of_birth);
      if (age != null) setChronoAge(String(age));
      if (pp?.position) setPosition(positionFromProfile(pp.position));

      // Latest assessment submission (with schema) for auto-mapping.
      const { data: subs } = await supabase
        .from('assessment_submissions')
        .select('id, assessment_date, responses, assessment_templates(name, schema)')
        .eq('player_id', p.id)
        .order('assessment_date', { ascending: false })
        .limit(1);
      const sub = subs && subs[0];
      const { assessment: mapped, matched } = mapAssessmentFromSubmission(sub);
      if (matched.length) {
        setAssessment((a) => ({ ...a, ...Object.fromEntries(Object.entries(mapped).map(([k, v]) => [k, String(v)])) }));
        setAutoNote(`Auto-filled ${matched.length} field(s) from "${sub.assessment_templates?.name || 'latest assessment'}" (${sub.assessment_date}). Review & edit below.`);
      } else {
        setAssessment({ ...BLANK_ASSESSMENT });
        setAutoNote(sub ? 'Latest assessment had no auto-mappable numeric fields — enter the screen manually.' : 'No assessment on file — enter the screen manually (blank = conservative thrower-deficit assumption).');
      }
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
        vertical_jump_cm: numOrNull(assessment.vertical_jump_cm),
        broad_jump_cm: numOrNull(assessment.broad_jump_cm),
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
      setMacro(macroCalendar(ath, ss, se, pd));
      if (macroMode) {
        const mw = generateMacro(ath, ss, se, pd);
        setMacroWeeks(mw);
        setWeek(mw[0] || null); // first phase drives the header / flags
        setOpenDays({});
      } else {
        const w = generateWeek(ath, pd, ss, se);
        setMacroWeeks([]);
        setWeek(w);
        setOpenDays(Object.fromEntries(w.days.map((_, i) => [i, true])));
      }
    } catch (e) {
      setError(e.message || 'Generation failed.');
    }
  };

  const save = async () => {
    if (!week) return;
    setSaving(true);
    setError('');
    setSaveMsg('');
    try {
      const isMacro = macroMode && macroWeeks.length > 0;
      const days = isMacro ? macroToProgramDays(macroWeeks) : weekToProgramDays(week);
      const weeksToSeasonEnd = Math.ceil((new Date(seasonEnd) - new Date(planDate)) / (7 * 24 * 60 * 60 * 1000));
      const durationWeeks = Math.max(1, weeksToSeasonEnd || 1);
      const description = isMacro
        ? `Full off-season macro · ${macroWeeks.map((w) => w.phaseLabel).join(' → ')} (generated ${iso(new Date())})`
        : `${week.phaseLabel} · ${week.emphasis} (generated ${iso(new Date())})`;

      const { data: prog, error: pErr } = await supabase
        .from('training_programs')
        .insert({ name: programName || `${selectedName} — S&C ${isMacro ? 'Off-Season Macro' : 'Program'}`, description, duration_weeks: durationWeeks, created_by: userId })
        .select('id')
        .single();
      if (pErr) throw pErr;

      for (let i = 0; i < days.length; i += 1) {
        const d = days[i];
        const { data: dayRow, error: dErr } = await supabase
          .from('training_days')
          .insert({ program_id: prog.id, day_number: i + 1, title: d.title, notes: d.notes })
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
          program_id: prog.id, player_id: selectedId, start_date: planDate, end_date: seasonEnd, assigned_by: userId,
        });
        if (aErr) throw aErr;
      }
      setSaveMsg(`Saved "${programName}"${assignAthlete ? ` and assigned to ${selectedName}` : ''}. It now appears in the program library${assignAthlete ? ' and on the athlete\'s profile' : ''}.`);
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
        Assessment-driven conjugate / Olympic-derivative programming for baseball. Auto-fills the athlete,
        respects Pitch Smart & youth safety gates, and writes into the training-program library.
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
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Season window</div>
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
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer px-1">
            <input type="checkbox" checked={macroMode} onChange={(e) => setMacroMode(e.target.checked)} />
            Full off-season macro (a week per phase: Accumulation → Strength → Power → Pre-season)
          </label>

          <button onClick={generate}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg">
            <Wand2 className="w-5 h-5" /> {macroMode ? 'Generate Off-Season Macro' : 'Generate Program'}
          </button>
        </div>

        {/* ------------------------------- RIGHT: output ----------------------------- */}
        <div className="space-y-5">
          {!week && (
            <div className={`${card} text-center text-gray-400 py-16`}>
              <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-40" />
              Set the athlete & inputs, then generate a periodized week.
            </div>
          )}

          {week && athPreview && (
            <>
              <div className={card}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">{week.phaseLabel}</div>
                    <div className="text-lg font-bold text-gray-900">{week.athlete}</div>
                  </div>
                  <div className="text-right text-xs text-gray-500 font-mono">
                    <div>{trainingStage(athPreview)} · {maturityBand(athPreview).replace('_', '-')}</div>
                    <div>loading: {loadStyle(athPreview) === 'percent' ? '%1RM' : 'RPE'}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-600">{week.emphasis}</div>
                <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">{week.arm_note}</div>
              </div>

              {/* Safety flags */}
              <div className={card}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">
                  <AlertTriangle className="w-4 h-4" /> Safety gates &amp; flags
                </div>
                <ul className="space-y-1.5">
                  {week.flags.map((f, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-2">
                      <span className="text-amber-500 mt-0.5">▸</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Training days — single week, or per-phase when in macro mode */}
              {macroMode && macroWeeks.length > 0 ? (
                macroWeeks.map((pw, pi) => (
                  <div key={pi} className="space-y-3">
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">{pw.phaseLabel}</span>
                      <span className="text-xs text-gray-400">{pw.emphasis}</span>
                    </div>
                    {pw.days.map((day, i) => {
                      const key = `${pi}-${i}`;
                      return (
                        <DayCard key={key} day={day} cardCls={card} open={!!openDays[key]}
                          onToggle={() => setOpenDays((o) => ({ ...o, [key]: !o[key] }))} />
                      );
                    })}
                  </div>
                ))
              ) : (
                week.days.map((day, i) => (
                  <DayCard key={i} day={day} cardCls={card} open={!!openDays[i]}
                    onToggle={() => setOpenDays((o) => ({ ...o, [i]: !o[i] }))} />
                ))
              )}

              {/* Macro calendar */}
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
