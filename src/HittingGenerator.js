import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Target, Search, User, Save, Check, ChevronDown, ChevronUp } from 'lucide-react';
import {
  LEVELS, LEVEL_NAME, METRICS, BM, UNIV, KIND_COLOR,
  generatePlan, planToProgramDays,
} from './hittingEngine';
import { extractMetricsFromSubmission } from './assessmentMetrics';

/* --------------------------------------------------------------------------- *
 *  Hitting Program Generator — "Barrel Path" (engine #3).
 *
 *  Grades Blast/HitTrax/biomech metrics against level benchmarks, produces
 *  root-cause-branched findings, and builds a phased development roadmap. Fully
 *  wired: auto-fills exit velocity from the athlete's Trackman batted-ball data
 *  and the remaining metrics from their latest assessment submission, then saves
 *  the roadmap (one program day per phase) into the training-program library.
 * --------------------------------------------------------------------------- */

const ageFromDob = (dob) => {
  if (!dob) return null;
  const age = Math.floor((new Date() - new Date(dob + 'T00:00:00')) / (365.25 * 24 * 60 * 60 * 1000));
  return Number.isFinite(age) ? age : null;
};

function levelFromAge(age) {
  if (age == null) return 'hs_varsity';
  if (age < 13) return 'youth';
  if (age < 15) return 'middleschool';
  if (age < 19) return 'hs_varsity';
  if (age < 23) return 'college';
  return 'pro';
}

const METRIC_KEYS = METRICS.map((m) => m.key);
const BLANK = Object.fromEntries(METRIC_KEYS.map((k) => [k, '']));

// Fuzzy-map scalar assessment responses -> metric keys by label keyword.
function mapAssessment(submission) {
  const out = {};
  const matched = [];
  if (!submission) return { out, matched };
  const schema = submission.assessment_templates?.schema || [];
  const responses = submission.responses || {};
  const pairs = [];
  for (const el of schema) {
    if (!el || !el.id) continue;
    const val = responses[el.id];
    if (val == null || typeof val === 'object') continue;
    pairs.push([String(el.label || '').toLowerCase(), val]);
  }
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const find = (test) => {
    for (const [label, val] of pairs) { if (test(label)) { const n = num(val); if (n != null) return { label, n }; } }
    return null;
  };
  const assign = (key, hit) => { if (hit && out[key] == null) { out[key] = hit.n; matched.push(key); } };

  assign('batspeed', find((l) => l.includes('bat speed') || l.includes('bat-speed')));
  assign('handspeed', find((l) => l.includes('hand speed')));
  assign('rotaccel', find((l) => l.includes('rotational accel') || l.includes('rot accel') || (l.includes('accel') && l.includes('g'))));
  assign('ope', find((l) => l.includes('on-plane') || l.includes('on plane') || l.includes('ope')));
  assign('attack', find((l) => l.includes('attack angle')));
  assign('earlyconn', find((l) => l.includes('early') && l.includes('connection')));
  assign('impconn', find((l) => l.includes('connection') && (l.includes('impact') || l.includes('contact'))));
  assign('ttc', find((l) => l.includes('time to contact') || l.includes('time-to-contact')));
  assign('evmax', find((l) => (l.includes('exit') && l.includes('max')) || l.includes('max ev') || l.includes('peak exit')));
  assign('evavg', find((l) => (l.includes('exit') && (l.includes('avg') || l.includes('average'))) || l.includes('avg ev')));
  assign('xfactor', find((l) => l.includes('separation') || l.includes('x-factor') || l.includes('x factor')));
  assign('seq', find((l) => l.includes('sequence') || l.includes('kinematic')));
  assign('pelvis', find((l) => l.includes('pelvis')));
  assign('mbthrow', find((l) => l.includes('med') && l.includes('ball')));
  assign('cmj', find((l) => l.includes('cmj') || (l.includes('vertical') && l.includes('jump')) || l.includes('counter-movement')));
  assign('dl', find((l) => l.includes('deadlift')));
  assign('hipir', find((l) => l.includes('hip') && l.includes('ir')));
  assign('tspine', find((l) => (l.includes('t-spine') || l.includes('tspine') || l.includes('thoracic')) && l.includes('rot')));
  assign('ankle', find((l) => l.includes('ankle') || l.includes('knee-to-wall') || l.includes('dorsi')));
  assign('grip', find((l) => l.includes('grip')));
  return { out, matched };
}

const TAG_CLR = {
  red: 'border-red-300 bg-red-50', amber: 'border-amber-300 bg-amber-50',
  violet: 'border-purple-300 bg-purple-50', cyan: 'border-cyan-300 bg-cyan-50', green: 'border-green-300 bg-green-50',
};
const KIND_HEX = { violet: '#8b5cf6', cyan: '#06b6d4', amber: '#f59e0b', green: '#22c55e', blue: '#3b82f6', gray: '#9ca3af' };
const STATUS_CLR = { good: 'text-green-600', dev: 'text-amber-600', def: 'text-red-600' };

// Dev/good zone bar for one graded metric (mirrors the source barFor math).
function MetricBar({ mkey, s }) {
  if (!s) return null;
  const label = METRICS.find((m) => m.key === mkey)?.label || mkey;
  let devL = 0; let devR = 0; let goodL = 0; let goodR = 0; let pos = 0; let note = '';
  if (s.dir === 'up' || s.dir === 'down') {
    const min = s.dir === 'up' ? s.dev[0] * 0.8 : s.good * 0.7;
    const max = s.dir === 'up' ? s.good * 1.25 : s.dev[1] * 1.4;
    const span = max - min || 1;
    const clamp = (x) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
    if (s.dir === 'up') {
      devL = clamp(s.dev[0]); devR = clamp(s.dev[1]); goodL = clamp(s.good); goodR = 100;
      note = `dev ${s.dev[0]}–${s.dev[1]}${s.unit} · target ≥${s.good}${s.unit}`;
    } else {
      goodL = 0; goodR = clamp(s.good); devL = clamp(s.good); devR = clamp(s.dev[1]);
      note = `target ≤${s.good}${s.unit} · dev to ${s.dev[1]}${s.unit}`;
    }
    pos = clamp(s.value);
  } else {
    const min = s.soft[0] - 8; const max = s.soft[1] + 8; const span = max - min || 1;
    const clamp = (x) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
    devL = clamp(s.soft[0]); devR = clamp(s.soft[1]); goodL = clamp(s.band[0]); goodR = clamp(s.band[1]);
    pos = clamp(s.value);
    note = `ideal ${s.band[0]}–${s.band[1]}${s.unit}`;
  }
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={`font-mono font-bold ${STATUS_CLR[s.status]}`}>{Math.round(s.value * 100) / 100}{s.unit}</span>
      </div>
      <div className="relative h-2 rounded bg-gray-100">
        <div className="absolute h-full bg-amber-200 rounded" style={{ left: `${devL}%`, width: `${Math.max(0, devR - devL)}%` }} />
        <div className="absolute h-full bg-green-300 rounded" style={{ left: `${goodL}%`, width: `${Math.max(0, goodR - goodL)}%` }} />
        <div className="absolute w-1 h-3 -top-0.5 bg-gray-900 rounded" style={{ left: `calc(${pos}% - 2px)` }} />
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">{note}</div>
    </div>
  );
}

export default function HittingGenerator({ userId, userRole }) {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedName, setSelectedName] = useState('');
  const [autoNote, setAutoNote] = useState('');

  const [level, setLevel] = useState('hs_varsity');
  const [age, setAge] = useState('16');
  const [weeks, setWeeks] = useState('16');
  const [values, setValues] = useState({ ...BLANK });

  const [openPhase, setOpenPhase] = useState({});
  const [programName, setProgramName] = useState('');
  const [assignAthlete, setAssignAthlete] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from('users')
        .select('id, full_name, player_profiles!player_profiles_user_id_fkey(level)')
        .in('role', ['player', 'coach', 'admin'])
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
    const next = { ...BLANK };
    try {
      const { data: u } = await supabase
        .from('users').select('date_of_birth').eq('id', p.id).single();
      const a = ageFromDob(u?.date_of_birth);
      if (a != null) { setAge(String(a)); setLevel(levelFromAge(a)); }

      // Trackman batted-ball -> evmax / evavg.
      const { data: bb } = await supabase
        .from('trackman_pitches')
        .select('exit_speed')
        .eq('batter_user_id', p.id)
        .not('exit_speed', 'is', null);
      const evs = (bb || []).map((r) => r.exit_speed).filter((v) => v != null);
      if (evs.length) {
        next.evmax = String(Math.round(Math.max(...evs) * 10) / 10);
        next.evavg = String(Math.round((evs.reduce((s, v) => s + v, 0) / evs.length) * 10) / 10);
        notes.push(`EV from ${evs.length} Trackman swings`);
      }

      // Latest assessment -> the rest.
      const { data: subs } = await supabase
        .from('assessment_submissions')
        .select('id, assessment_date, responses, assessment_templates(name, schema)')
        .eq('player_id', p.id)
        .order('assessment_date', { ascending: false })
        .limit(1);
      const sub = subs && subs[0];
      const { out, matched } = mapAssessment(sub);
      matched.forEach((k) => { if (next[k] === '' || next[k] == null) next[k] = String(out[k]); });
      // Structured metric_key tags are authoritative — override fuzzy/blank with tagged values.
      const byKey = extractMetricsFromSubmission(sub);
      const keyed = Object.keys(byKey).filter((k) => METRIC_KEYS.includes(k));
      keyed.forEach((k) => { next[k] = String(byKey[k]); });
      const total = new Set([...matched, ...keyed]).size;
      if (total) notes.push(`${total} metric${total > 1 ? 's' : ''} from "${sub.assessment_templates?.name || 'assessment'}"`);

      setValues(next);
      setProgramName(`${p.full_name} — Hitting Roadmap`);
      setAutoNote(notes.length ? `Auto-filled: ${notes.join(', ')}. Review & edit below.` : 'No Trackman/assessment data on file — enter metrics manually (blanks are treated as not-screened).');
    } catch (e) {
      setError(e.message || 'Failed to load athlete.');
    }
  }, []);

  const gen = useMemo(() => {
    const V = {};
    METRIC_KEYS.forEach((k) => { const n = parseFloat(values[k]); V[k] = Number.isFinite(n) ? n : null; });
    const anySet = Object.values(V).some((x) => x !== null);
    if (!anySet) return null;
    return generatePlan({ values: V, level, age: parseInt(age, 10) || null, weeks: parseInt(weeks, 10) || 16, days: 4 });
  }, [values, level, age, weeks]);

  const save = async () => {
    if (!gen) return;
    setSaving(true); setError(''); setSaveMsg('');
    try {
      const rows = planToProgramDays(gen.phases, gen.plan);
      const topFindings = gen.findings.slice(0, 3).map((f) => f.title).join('; ');
      const { data: prog, error: pErr } = await supabase
        .from('training_programs')
        .insert({
          name: programName || `${selectedName} — Hitting Roadmap`,
          description: `Hitting roadmap · ${LEVEL_NAME[level]} · top priorities: ${topFindings || 'balanced'} (generated ${new Date().toISOString().slice(0, 10)})`,
          duration_weeks: parseInt(weeks, 10) || 16, created_by: userId,
        }).select('id').single();
      if (pErr) throw pErr;
      for (let i = 0; i < rows.length; i += 1) {
        const d = rows[i];
        const { data: dayRow, error: dErr } = await supabase
          .from('training_days')
          .insert({ program_id: prog.id, day_number: d.day_number || (i + 1), title: d.title, notes: d.notes })
          .select('id').single();
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
          program_id: prog.id, player_id: selectedId, start_date: new Date().toISOString().slice(0, 10), assigned_by: userId,
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

  const filteredPlayers = players.filter((p) => p.full_name?.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
  const card = 'bg-white rounded-lg border border-gray-200 p-5';
  const eyebrow = 'text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3';
  const label = 'block text-xs font-medium text-gray-500 mb-1';
  const inp = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm';

  const groups = [...new Set(METRICS.map((m) => m.group))];

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-1">
        <Target className="w-7 h-7 text-cyan-600" />
        <h1 className="text-2xl font-bold text-gray-900">Hitting Program Generator</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Grades bat-tracking, ball-flight and biomech metrics against level benchmarks, finds the root-cause
        limiters, and builds a phased development roadmap. Auto-fills exit velo from Trackman + the rest from assessments.
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
            {autoNote && <div className="mt-2 text-xs text-cyan-700 bg-cyan-50 rounded p-2">{autoNote}</div>}
          </div>

          <div className={card}>
            <div className={eyebrow}>Plan setup</div>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <span className={label}>Level</span>
                <select className={inp} value={level} onChange={(e) => setLevel(e.target.value)}>
                  {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAME[l]}</option>)}
                </select>
              </div>
              <div>
                <span className={label}>Age</span>
                <input className={inp} type="number" value={age} onChange={(e) => setAge(e.target.value)} />
              </div>
              <div>
                <span className={label}>Weeks</span>
                <input className={inp} type="number" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
              </div>
            </div>
          </div>

          {groups.map((g) => (
            <div className={card} key={g}>
              <div className={eyebrow}>{g}</div>
              <div className="grid grid-cols-2 gap-3">
                {METRICS.filter((m) => m.group === g).map((m) => (
                  <div key={m.key}>
                    <span className={label}>{m.label}{BM[m.key] ? '' : UNIV[m.key] ? '' : ' (info)'}</span>
                    <input className={inp} type="number" value={values[m.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* -------------------------------- RIGHT ------------------------------- */}
        <div className="space-y-5">
          {!gen && (
            <div className={`${card} text-center text-gray-400 py-16`}>
              <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
              Enter a few assessment numbers (or pick an athlete with data), and the roadmap builds live.
            </div>
          )}

          {gen && (
            <>
              {/* Snapshot */}
              <div className={card}>
                <div className={eyebrow}>Athlete snapshot · benchmarked vs {LEVEL_NAME[level]}</div>
                {METRIC_KEYS.filter((k) => gen.S[k]).map((k) => <MetricBar key={k} mkey={k} s={gen.S[k]} />)}
                {!METRIC_KEYS.some((k) => gen.S[k]) && <div className="text-xs text-gray-400">No gradable metrics entered yet.</div>}
              </div>

              {/* Findings */}
              <div className={card}>
                <div className={eyebrow}>Priorities — ranked by leverage × severity</div>
                <div className="space-y-3">
                  {gen.findings.filter((f) => f.sev >= 1 || f.flag).map((f, i) => (
                    <div key={i} className={`rounded-lg border p-3 ${TAG_CLR[f.tag] || TAG_CLR.amber}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-gray-900 text-sm">{f.title}</div>
                        <div className="text-[10px] font-mono text-gray-400 uppercase">{f.cat}</div>
                      </div>
                      <div className="text-xs text-gray-600 mt-1">{f.measured}</div>
                      <div className="text-xs text-gray-500 mt-1.5"><span className="font-semibold text-gray-600">Root:</span> {f.root}</div>
                      <div className="text-xs text-gray-500 mt-1"><span className="font-semibold text-gray-600">Why it matters:</span> {f.why}</div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {f.targets.map((t, j) => <span key={j} className="text-[10px] bg-white/70 border border-gray-200 rounded px-1.5 py-0.5 text-gray-500">{t}</span>)}
                      </div>
                      <div className="text-xs text-gray-500 mt-2"><span className="font-semibold text-gray-600">Drills:</span> {f.rx.slice(0, 4).join(' · ')}</div>
                    </div>
                  ))}
                  {!gen.findings.some((f) => f.sev >= 1 || f.flag) && <div className="text-sm text-green-600">No deficiencies flagged — everything screened on-level. Progress the phase plan.</div>}
                </div>
              </div>

              {/* Phase timeline */}
              <div className={card}>
                <div className={eyebrow}>Phase plan · {weeks} weeks</div>
                <div className="flex rounded overflow-hidden h-8 mb-2">
                  {gen.phases.map((ph, i) => {
                    const w = (ph.span[1] - ph.span[0] + 1) / (parseInt(weeks, 10) || 16) * 100;
                    return (
                      <div key={i} title={ph.name} className="flex items-center justify-center text-[9px] text-white font-semibold"
                        style={{ width: `${w}%`, background: KIND_HEX[KIND_COLOR[ph.kind]] }}>
                        {ph.span[1] - ph.span[0] + 1}w
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  {gen.phases.map((ph, i) => (
                    <div key={i} className="text-xs flex gap-2">
                      <span className="w-2.5 h-2.5 rounded-full mt-0.5 shrink-0" style={{ background: KIND_HEX[KIND_COLOR[ph.kind]] }} />
                      <span className="font-semibold text-gray-700 w-40 shrink-0">{ph.name}</span>
                      <span className="text-gray-500">wk {ph.span[0]}–{ph.span[1]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Weekly roadmap (accordion by phase) */}
              <div className={card}>
                <div className={eyebrow}>Weekly roadmap</div>
                {gen.phases.map((ph, i) => {
                  const wk = gen.plan.find((w) => w.week >= ph.span[0] && w.week <= ph.span[1]);
                  const open = openPhase[i];
                  return (
                    <div key={i} className="border-t border-gray-100 first:border-t-0 py-2">
                      <button className="w-full flex items-center justify-between" onClick={() => setOpenPhase((o) => ({ ...o, [i]: !o[i] }))}>
                        <div className="text-left">
                          <span className="font-semibold text-gray-800 text-sm">{ph.name}</span>
                          <span className="text-xs text-gray-400 ml-2">wk {ph.span[0]}–{ph.span[1]} · {ph.focus}</span>
                        </div>
                        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </button>
                      {open && wk && (
                        <div className="mt-2 space-y-2">
                          {wk.blocks.map((b, j) => (
                            <div key={j}>
                              <div className="text-xs font-semibold text-gray-700">{b.t} <span className="font-normal text-gray-400">· {b.vol}</span></div>
                              <ul className="mt-0.5 ml-4 list-disc text-xs text-gray-600 space-y-0.5">
                                {b.items.map((it, k) => <li key={k}>{it}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Save */}
              <div className={card}>
                <div className={eyebrow}>Save to library</div>
                <label className={label}>Program name</label>
                <input className={inp} value={programName} onChange={(e) => setProgramName(e.target.value)}
                  placeholder={selectedName ? `${selectedName} — Hitting Roadmap` : 'Select an athlete first'} />
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={assignAthlete} onChange={(e) => setAssignAthlete(e.target.checked)} />
                  Assign to {selectedName || 'athlete'} (appears on their profile)
                </label>
                <button onClick={save} disabled={saving || !selectedId}
                  className="mt-4 w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg">
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Roadmap (one day per phase)'}
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
