import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Zap, Search, User, Wand2, Save, Check, AlertTriangle, Calendar } from 'lucide-react';
import {
  LEVELS, POSITIONS, PHASES, PHASE_ORDER, ATHLETE_TYPES,
  gameDemand, readiness, assessmentGates, stressUnits, moundRamp, buildWeek, seedLog,
  weekToProgramDays,
} from './throwingEngine';

/* --------------------------------------------------------------------------- *
 *  Throwing Program Generator — "The Ramp" (engine #2).
 *
 *  Position/level-aware throwing microcycles with Pitch Smart caps, ACWR
 *  workload, assessment gates and daily readiness. Fully wired: auto-fills
 *  readiness from the athlete's latest whoop_cycles and the chronic-load
 *  baseline from their trackman_pitches history, then saves the week into the
 *  training-program library. Reskinned to the app's light Tailwind UI.
 * --------------------------------------------------------------------------- */

const ageFromDob = (dob) => {
  if (!dob) return null;
  const age = Math.floor((new Date() - new Date(dob + 'T00:00:00')) / (365.25 * 24 * 60 * 60 * 1000));
  return Number.isFinite(age) ? age : null;
};

function levelFromAge(age) {
  if (age == null) return '17-18';
  if (age < 11) return '9-10';
  if (age < 13) return '11-12';
  if (age < 15) return '13-14';
  if (age < 17) return '15-16';
  if (age < 19) return '17-18';
  if (age < 23) return '19-22';
  return 'pro';
}

function posKeyFromProfile(pos) {
  const p = String(pos || '').toLowerCase();
  if (/two.?way/.test(p)) return 'TW';
  if (/relief|\brp\b/.test(p)) return 'RP';
  if (/pitch|\bp\b|rhp|lhp|\bsp\b/.test(p)) return 'SP';
  if (/catch|\bc\b/.test(p)) return 'C';
  if (/short|\bss\b|2b|second|middle|\bmif\b/.test(p)) return 'MIF';
  if (/first|1b|third|3b|corner|\bcif\b/.test(p)) return 'CIF';
  if (/field|\bof\b|lf|cf|rf/.test(p)) return 'OF';
  return 'OF';
}

const iso = (d) => d.toISOString().slice(0, 10);

// Status/zone -> Tailwind accent classes.
const READY_CLR = { GO: 'green', MODIFY: 'amber', CAUTION: 'red', REST: 'red' };
const clr = {
  green: { text: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500' },
  amber: { text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  red: { text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500' },
  blue: { text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500' },
};

export default function ThrowingGenerator({ userId, userRole }) {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedName, setSelectedName] = useState('');
  const [autoNote, setAutoNote] = useState('');

  const [levelId, setLevelId] = useState('17-18');
  const [posId, setPosId] = useState('SP');
  const [phaseId, setPhaseId] = useState('VELO');
  const [typeId, setTypeId] = useState('intermediate');
  const [weekInPhase, setWeekInPhase] = useState(2);
  const [mob, setMob] = useState(72);
  const [str, setStr] = useState(68);
  const [bio, setBio] = useState(70);
  const [whoop, setWhoop] = useState(74);
  const [hrv, setHrv] = useState('flat');
  const [soreness, setSoreness] = useState('none');

  const [log, setLog] = useState(seedLog);
  const [autoChronic, setAutoChronic] = useState(true);
  const [manualChronic, setManualChronic] = useState(180);

  const [programName, setProgramName] = useState('');
  const [assignAthlete, setAssignAthlete] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from('users')
        .select('id, full_name, player_profiles!player_profiles_user_id_fkey(position)')
        .eq('role', 'player')
        .order('full_name');
      if (e) { setError(e.message); return; }
      let filtered = data || [];
      if (userRole === 'coach') {
        const { data: coachTeams } = await supabase.from('team_members').select('team_id').eq('user_id', userId);
        const teamIds = (coachTeams || []).map((t) => t.team_id);
        const { data: members } = await supabase.from('team_members').select('user_id')
          .in('team_id', teamIds.length ? teamIds : ['00000000-0000-0000-0000-000000000000']);
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
    setError('');
    setSaveMsg('');
    const notes = [];
    try {
      // Demographics -> level + position.
      const { data: u } = await supabase
        .from('users')
        .select('date_of_birth, player_profiles!player_profiles_user_id_fkey(position)')
        .eq('id', p.id).single();
      const pp = Array.isArray(u?.player_profiles) ? u.player_profiles[0] : u?.player_profiles;
      const age = ageFromDob(u?.date_of_birth);
      const lvl = levelFromAge(age);
      const pos = posKeyFromProfile(pp?.position);
      setLevelId(lvl);
      setPosId(pos);

      // WHOOP readiness auto-fill (staff read-all RLS).
      const { data: cycles } = await supabase
        .from('whoop_cycles')
        .select('cycle_date, recovery_score, hrv_rmssd')
        .eq('athlete_id', p.id)
        .order('cycle_date', { ascending: false })
        .limit(30);
      if (cycles && cycles.length) {
        const latest = cycles[0];
        if (latest.recovery_score != null) { setWhoop(Math.round(latest.recovery_score)); notes.push('WHOOP recovery'); }
        const hist = cycles.slice(1).map((c) => c.hrv_rmssd).filter((v) => v != null);
        if (latest.hrv_rmssd != null && hist.length >= 3) {
          const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
          setHrv(latest.hrv_rmssd > mean * 1.03 ? 'up' : latest.hrv_rmssd < mean * 0.97 ? 'down' : 'flat');
          notes.push('HRV trend');
        }
      }

      // Trackman workload -> chronic baseline (pitchers).
      const since = iso(new Date(Date.now() - 28 * 24 * 60 * 60 * 1000));
      const { data: pitches } = await supabase
        .from('trackman_pitches')
        .select('thrown_date')
        .eq('pitcher_user_id', p.id)
        .gte('thrown_date', since);
      if (pitches && pitches.length) {
        const byDate = {};
        pitches.forEach((r) => { byDate[r.thrown_date] = (byDate[r.thrown_date] || 0) + 1; });
        const today = new Date(iso(new Date()) + 'T00:00:00');
        const built = Object.entries(byDate).map(([d, count]) => ({
          id: `tm${d}`,
          dayAgo: Math.round((today - new Date(d + 'T00:00:00')) / (24 * 60 * 60 * 1000)),
          throws: count, intent: 100, mound: true,
        })).filter((e) => e.dayAgo >= 0 && e.dayAgo < 28);
        if (built.length) { setLog(built); setAutoChronic(true); notes.push(`${built.length}d Trackman load`); }
      } else {
        setLog(seedLog());
      }

      setProgramName(`${p.full_name} — Throwing (${PHASES[phaseId].label})`);
      setAutoNote(notes.length
        ? `Auto-filled from live data: ${notes.join(', ')}. Review & adjust below.`
        : 'No WHOOP/Trackman data on file — using manual defaults + a seeded chronic baseline.');
    } catch (e) {
      setError(e.message || 'Failed to load athlete.');
    }
  }, [phaseId]);

  const ready = useMemo(() => readiness(whoop, hrv, soreness), [whoop, hrv, soreness]);
  const gates = useMemo(() => assessmentGates(mob, str, bio), [mob, str, bio]);
  const week = useMemo(() => buildWeek({ levelId, posId, phaseId, typeId, mob, str, bio, ready, weekInPhase }),
    [levelId, posId, phaseId, typeId, mob, str, bio, ready, weekInPhase]);
  const demand = useMemo(() => gameDemand(posId, levelId), [posId, levelId]);
  const isP = POSITIONS[posId].group === 'P';
  const ramp = useMemo(() => (isP ? moundRamp(levelId, posId) : []), [isP, levelId, posId]);

  const logStats = useMemo(() => {
    const su = (e) => stressUnits(e.throws, e.intent || 1, e.mound);
    const last7 = log.filter((e) => e.dayAgo < 7).reduce((s, e) => s + su(e), 0);
    const last28 = log.reduce((s, e) => s + su(e), 0);
    return { acute7: Math.round(last7), chronicWk: Math.round(last28 / 4) };
  }, [log]);

  const acuteWeekly = week.reduce((s, d) => s + d.su, 0);
  const chronicWeekly = autoChronic ? Math.max(1, logStats.chronicWk) : manualChronic;
  const acwr = chronicWeekly > 0 ? acuteWeekly / chronicWeekly : 0;
  const phase = PHASES[phaseId];
  const totalThrows = week.reduce((s, d) => s + d.throws, 0);
  const highDays = week.filter((d) => d.intent >= 90).length;

  const acwrZone = acwr < 0.8 ? { label: 'UNDERLOADED', c: 'blue' }
    : acwr <= phase.acwr[1] ? { label: 'IN RANGE', c: 'green' }
      : acwr <= 1.5 ? { label: 'CAUTION', c: 'amber' } : { label: 'HIGH RISK', c: 'red' };

  const save = async () => {
    if (!week) return;
    setSaving(true); setError(''); setSaveMsg('');
    try {
      const days = weekToProgramDays(week);
      const { data: prog, error: pErr } = await supabase
        .from('training_programs')
        .insert({
          name: programName || `${selectedName} — Throwing`,
          description: `${phase.label} · ${phase.goal} (generated ${iso(new Date())})`,
          duration_weeks: 1, created_by: userId,
        }).select('id').single();
      if (pErr) throw pErr;
      for (let i = 0; i < days.length; i += 1) {
        const d = days[i];
        const { data: dayRow, error: dErr } = await supabase
          .from('training_days')
          .insert({ program_id: prog.id, day_number: i + 1, title: d.title, notes: d.notes })
          .select('id').single();
        if (dErr) throw dErr;
        const { error: exErr } = await supabase.from('training_exercises').insert(
          d.exercises.map((x) => ({
            day_id: dayRow.id, category: x.category, name: x.name,
            description: x.description, reps: x.reps, sort_order: x.sort_order,
          })),
        );
        if (exErr) throw exErr;
      }
      if (assignAthlete && selectedId) {
        const { error: aErr } = await supabase.from('training_program_assignments').insert({
          program_id: prog.id, player_id: selectedId, start_date: iso(new Date()), assigned_by: userId,
        });
        if (aErr) throw aErr;
      }
      setSaveMsg(`Saved "${programName}"${assignAthlete ? ` and assigned to ${selectedName}` : ''}.`);
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const filteredPlayers = players
    .filter((p) => p.full_name?.toLowerCase().includes(search.toLowerCase())).slice(0, 8);

  const card = 'bg-white rounded-lg border border-gray-200 p-5';
  const label = 'block text-xs font-medium text-gray-500 mb-1';
  const eyebrow = 'text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3';
  const inp = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm';
  const chip = (active, color = 'blue') => `px-3 py-1.5 rounded-full text-xs font-medium border ${active
    ? `${clr[color].dot} text-white border-transparent` : 'bg-white text-gray-500 border-gray-300'}`;

  const Slider = ({ text, value, set }) => (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500 font-medium">{text}</span>
        <span className="font-mono font-bold text-gray-700">{value}</span>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-1">
        <Zap className="w-7 h-7 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900">Throwing Program Generator</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Position- and level-aware throwing microcycles — Pitch Smart caps, ACWR workload and daily readiness.
        Auto-fills WHOOP recovery & Trackman load, then saves into the training-program library.
      </p>

      {error && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* -------------------------------- LEFT -------------------------------- */}
        <div className="space-y-5">
          <div className={card}>
            <div className={eyebrow}>Athlete</div>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
              <input className="w-full border border-gray-300 rounded pl-8 pr-3 py-2 text-sm"
                placeholder="Search athletes…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            {selectedName && <div className="mt-3 text-sm font-semibold text-gray-900">{selectedName}</div>}
            {autoNote && <div className="mt-2 text-xs text-orange-600 bg-orange-50 rounded p-2">{autoNote}</div>}
          </div>

          <div className={card}>
            <div className={eyebrow}>Setup</div>
            <span className={label}>Competition level</span>
            <div className="flex flex-wrap gap-2 mb-3">
              {LEVELS.map((l) => (
                <button key={l.id} onClick={() => setLevelId(l.id)} className={chip(levelId === l.id, 'blue')}>{l.label}</button>
              ))}
            </div>
            <span className={label}>Position</span>
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(POSITIONS).map(([id, p]) => (
                <button key={id} onClick={() => setPosId(id)}
                  className={chip(posId === id, p.group === 'P' ? 'red' : 'blue')}>
                  {p.label.replace(/ \(.*\)/, '')}
                </button>
              ))}
            </div>
            <span className={label}>Training age</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ATHLETE_TYPES).map(([id, a]) => (
                <button key={id} onClick={() => setTypeId(id)} className={chip(typeId === id, 'green')}>{a.label}</button>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className={eyebrow}>Training phase</div>
            <div className="flex flex-wrap gap-2">
              {PHASE_ORDER.map((id) => (
                <button key={id} onClick={() => setPhaseId(id)} className={chip(phaseId === id, 'amber')}>{PHASES[id].label}</button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={label + ' mb-0'}>Week in phase</span>
              {[1, 2, 3, 4, 5, 6].map((w) => (
                <button key={w} onClick={() => setWeekInPhase(w)}
                  className={`w-7 h-7 rounded text-xs font-bold border ${weekInPhase === w
                    ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300'}`}>{w}</button>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className={eyebrow}>Assessment gates</div>
            <Slider text="Mobility (shoulder / hip / T-spine)" value={mob} set={setMob} />
            <Slider text="Strength (relative + posterior chain)" value={str} set={setStr} />
            <Slider text="Biomechanics (efficiency / low stress)" value={bio} set={setBio} />
          </div>

          <div className={card}>
            <div className={eyebrow}>Today's readiness</div>
            <Slider text="WHOOP recovery %" value={whoop} set={setWhoop} />
            <span className={label}>HRV trend</span>
            <div className="flex gap-2 mb-3">
              {['up', 'flat', 'down'].map((h) => (
                <button key={h} onClick={() => setHrv(h)} className={chip(hrv === h, 'blue')}>{h}</button>
              ))}
            </div>
            <span className={label}>Arm soreness</span>
            <div className="flex gap-2">
              {['none', 'mild', 'moderate', 'high'].map((s) => (
                <button key={s} onClick={() => setSoreness(s)}
                  className={chip(soreness === s, s === 'high' ? 'red' : s === 'moderate' ? 'amber' : 'green')}>{s}</button>
              ))}
            </div>
          </div>

          <div className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-500 text-xs rounded-lg py-2">
            <Wand2 className="w-4 h-4" /> Plan updates live as you edit
          </div>
        </div>

        {/* -------------------------------- RIGHT ------------------------------- */}
        <div className="space-y-5">
          {/* Readiness */}
          <div className={`${card} ${clr[READY_CLR[ready.status]].border} ${clr[READY_CLR[ready.status]].bg}`}>
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full grid place-items-center text-white font-bold ${clr[READY_CLR[ready.status]].dot}`}>
                {ready.status[0]}
              </div>
              <div>
                <div className={`text-xs font-semibold uppercase tracking-wide ${clr[READY_CLR[ready.status]].text}`}>
                  Readiness — {ready.status} · score {ready.score}
                </div>
                <div className="font-bold text-gray-900">{ready.headline}</div>
                <div className="text-xs text-gray-500 mt-0.5">{ready.detail}</div>
              </div>
            </div>
          </div>

          {/* Game demand */}
          <div className={card}>
            <div className={eyebrow}>Measured game demand · {POSITIONS[posId].label} · {LEVELS.find((l) => l.id === levelId).label}</div>
            <div className="flex flex-wrap gap-6">
              <Stat label={isP ? 'Pitches / outing' : 'Competitive throws'} value={isP ? demand.pitches : demand.active} />
              <Stat label="Total throw-equiv." value={demand.total} />
              <Stat label="Mean intent" value={`${demand.meanIntent}%`} />
              <Stat label="Max distance" value={typeof demand.dist === 'number' ? `${demand.dist}'` : demand.dist} />
            </div>
            <div className="text-xs text-gray-400 mt-3">{demand.note}.</div>
          </div>

          {/* Microcycle */}
          <div className={card}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className={eyebrow + ' mb-0'}>Weekly microcycle · {phase.label} · wk {weekInPhase}</div>
              <div className="text-xs font-mono text-gray-500">{totalThrows} throws · {highDays} high-intent {highDays === 1 ? 'day' : 'days'}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                    {['Day', 'Session', 'Intent', 'Vol', 'Dist', 'Focus'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {week.map((d, i) => {
                    const off = d.intent === 0;
                    const hot = d.intent >= 90;
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className={`py-2 pr-3 font-mono font-bold ${off ? 'text-gray-300' : 'text-gray-800'}`}>{d.day}</td>
                        <td className="py-2 pr-3">
                          <span className={`font-semibold ${off ? 'text-gray-300' : hot ? 'text-orange-600' : 'text-gray-800'}`}>{d.label}</span>
                          {d.mound && <span className="ml-1.5 text-[9px] font-mono text-amber-600 border border-amber-300 rounded px-1">MOUND</span>}
                        </td>
                        <td className={`py-2 pr-3 font-mono font-bold ${off ? 'text-gray-300' : hot ? 'text-orange-600' : d.intent >= 80 ? 'text-amber-600' : 'text-green-600'}`}>{off ? '—' : `${d.intent}%`}</td>
                        <td className="py-2 pr-3 font-mono text-gray-600">{d.throws || '—'}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-gray-500">{d.distance || '—'}</td>
                        <td className="py-2 text-xs text-gray-500">{d.focus}
                          {d.ps && <div className={`font-mono text-[10px] ${d.ps.over ? 'text-red-600' : 'text-gray-400'}`}>
                            ~{d.ps.pitches} pitches · cap {d.ps.max}{d.ps.over ? ' · OVER CAP' : ` · needs ${d.ps.rest}d rest`}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mound ramp */}
          {isP && (
            <div className={card}>
              <div className={eyebrow}>Mound / bullpen pitch-count ramp → {demand.pitches} pitches</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                      {['Wk', 'Session', 'Pitches', 'Intent', 'Rest', 'Detail'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ramp.map((s, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-2 pr-3 font-mono text-gray-500">{s.wk}</td>
                        <td className={`py-2 pr-3 font-semibold ${s.intent >= 100 ? 'text-orange-600' : 'text-gray-800'}`}>{s.day}</td>
                        <td className={`py-2 pr-3 font-mono font-bold ${s.over ? 'text-red-600' : 'text-gray-700'}`}>{s.pitches}{s.over ? '⚠' : ''}</td>
                        <td className={`py-2 pr-3 font-mono ${s.intent >= 95 ? 'text-orange-600' : s.intent >= 85 ? 'text-amber-600' : 'text-green-600'}`}>{s.intent}%</td>
                        <td className="py-2 pr-3 font-mono text-gray-400">{s.rest}d</td>
                        <td className="py-2 text-xs text-gray-500">{s.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Workload */}
          <div className="grid grid-cols-2 gap-5">
            <div className={card}>
              <div className={eyebrow}>Acute : Chronic (ACWR)</div>
              <div className={`text-4xl font-mono font-bold ${clr[acwrZone.c].text}`}>{acwr.toFixed(2)}</div>
              <div className={`text-xs font-mono tracking-wide ${clr[acwrZone.c].text}`}>{acwrZone.label}</div>
              <div className="mt-2 h-2 rounded bg-gray-100 overflow-hidden">
                <div className={`h-full ${clr[acwrZone.c].dot}`} style={{ width: `${Math.min(100, (acwr / 2) * 100)}%` }} />
              </div>
              <div className="text-xs text-gray-400 mt-2 font-mono">
                acute {Math.round(acuteWeekly)} / chronic {chronicWeekly} · target {phase.acwr[0]}–{phase.acwr[1]}
              </div>
              <label className="flex items-center gap-2 mt-3 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={autoChronic} onChange={(e) => setAutoChronic(e.target.checked)} />
                auto chronic from Trackman
              </label>
              {!autoChronic && (
                <input type="range" min={40} max={400} value={manualChronic}
                  onChange={(e) => setManualChronic(Number(e.target.value))} className="w-full mt-2" />
              )}
            </div>
            <div className={card}>
              <div className={eyebrow}>Daily load</div>
              <div className="flex items-end gap-1.5 h-28">
                {week.map((d, i) => {
                  const mx = Math.max(...week.map((x) => x.su), 1);
                  const h = (d.su / mx) * 100;
                  const c = d.intent >= 90 ? 'bg-orange-500' : d.intent >= 80 ? 'bg-amber-500' : d.su > 0 ? 'bg-green-500' : 'bg-gray-200';
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                      <div className={`w-full rounded-t ${c}`} style={{ height: `${Math.max(3, h)}%` }} />
                      <div className="text-[9px] font-mono text-gray-400 mt-1">{d.day[0]}</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-gray-400 mt-2">Bars = arm-stress units (throws × intent^1.6 × mound).</div>
            </div>
          </div>

          {/* Development path */}
          <div className={card}>
            <div className={`${eyebrow} ${gates.canVelo ? 'text-green-600' : 'text-amber-600'}`}>
              Development path — {gates.canVelo ? 'cleared for high-intent' : 'high-intent gated'}
            </div>
            <ul className="space-y-1.5">
              {gates.priorities.map((p, i) => (
                <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-orange-500 mt-0.5">▸</span><span>{p}</span></li>
              ))}
            </ul>
            {gates.notes.length > 0 && (
              <div className="mt-3 p-3 bg-amber-50 border-l-2 border-amber-400 rounded text-xs text-gray-600 space-y-1">
                {gates.notes.map((n, i) => <div key={i}>{n}</div>)}
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 text-xs text-gray-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Ceiling this week: {Math.min(phase.intentCap, POSITIONS[posId].intentCap, gates.maxIntentTier)}% intent · {POSITIONS[posId].note}
            </div>
          </div>

          {/* Save */}
          <div className={card}>
            <div className={eyebrow}>Save to library</div>
            <label className={label}>Program name</label>
            <input className={inp} value={programName} onChange={(e) => setProgramName(e.target.value)}
              placeholder={selectedName ? `${selectedName} — Throwing` : 'Select an athlete first'} />
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={assignAthlete} onChange={(e) => setAssignAthlete(e.target.checked)} />
              Assign to {selectedName || 'athlete'} (appears on their profile)
            </label>
            <button onClick={save} disabled={saving || !selectedId}
              className="mt-4 w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Program'}
            </button>
            {saveMsg && (
              <div className="mt-3 p-3 rounded bg-green-50 border border-green-200 text-green-700 text-sm flex gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0" />{saveMsg}
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 text-xs text-gray-400">
              <Calendar className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Saves the current 7-day microcycle as a program. Not medical advice — return-to-throw must be cleared clinically.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-2xl font-mono font-bold text-gray-900 leading-none">{value}</div>
      <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wide">{label}</div>
    </div>
  );
}
