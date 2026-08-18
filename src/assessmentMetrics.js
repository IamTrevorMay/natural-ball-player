/* ============================================================================
   assessmentMetrics.js — canonical assessment-metric registry.

   The problem this solves: assessment_submissions store metric values in a
   schema-less `responses` JSONB blob keyed by template-element id, and each
   generator used to *fuzzy-match the element LABEL text* to guess which value
   feeds which input. Renaming a field silently broke auto-fill.

   Fix: a template element can carry an optional `metric_key` chosen from the
   list below. When present, extractMetricsFromSubmission() maps values to these
   stable canonical keys, and every generator reads by key (rename-proof). Legacy
   templates with no metric_key still fall back to the per-generator fuzzy maps.

   Hitting keys are intentionally identical to src/hittingEngine.js BM/UNIV/METRICS
   keys so the mapping is the identity function there.
   ========================================================================== */

// Ordered groups for the template-editor dropdown.
export const METRIC_GROUPS = [
  'Hitting',
  'Throwing',
  'Strength & Power',
  'Mobility / Screen',
  'Anthropometric',
];

// key: stable canonical id (snake/lower). label: human. group: dropdown group. unit: display only.
export const ASSESSMENT_METRICS = [
  // ---- Hitting (keys match hittingEngine.js) ----
  { key: 'batspeed',  label: 'Bat speed',                 group: 'Hitting', unit: 'mph' },
  { key: 'evmax',     label: 'Exit velo — max',           group: 'Hitting', unit: 'mph' },
  { key: 'evavg',     label: 'Exit velo — average',       group: 'Hitting', unit: 'mph' },
  { key: 'rotaccel',  label: 'Rotational acceleration',   group: 'Hitting', unit: 'g' },
  { key: 'handspeed', label: 'Peak hand speed',           group: 'Hitting', unit: 'mph' },
  { key: 'ope',       label: 'On-plane efficiency',       group: 'Hitting', unit: '%' },
  { key: 'attack',    label: 'Attack angle',              group: 'Hitting', unit: '°' },
  { key: 'earlyconn', label: 'Early connection',          group: 'Hitting', unit: '°' },
  { key: 'impconn',   label: 'Connection @ impact',       group: 'Hitting', unit: '°' },
  { key: 'ttc',       label: 'Time to contact',           group: 'Hitting', unit: 's' },
  { key: 'xfactor',   label: 'Hip–shoulder separation',   group: 'Hitting', unit: '°' },
  { key: 'seq',       label: 'Kinematic sequence %',      group: 'Hitting', unit: '%' },
  { key: 'pelvis',    label: 'Peak pelvis velocity',      group: 'Hitting', unit: '°/s' },
  { key: 'mbthrow',   label: 'Rotational med-ball throw', group: 'Hitting', unit: 'mph' },

  // ---- Throwing ----
  { key: 'throwing_velo_max', label: 'Throwing velo — max (pulldown/mound)', group: 'Throwing', unit: 'mph' },
  { key: 'fb_velo',           label: 'Fastball velo',                        group: 'Throwing', unit: 'mph' },
  { key: 'arm_speed',         label: 'Arm speed',                            group: 'Throwing', unit: 'mph' },
  { key: 'biomech_score',     label: 'Biomechanics readiness (gate 0–100)',  group: 'Throwing', unit: '0-100' },

  // ---- Readiness gate scores (0-100) used by the throwing generator's assessment gates ----
  { key: 'mobility_score', label: 'Mobility readiness (gate 0–100)', group: 'Mobility / Screen', unit: '0-100' },
  { key: 'strength_score', label: 'Strength readiness (gate 0–100)', group: 'Strength & Power', unit: '0-100' },

  // ---- Strength & Power ----
  // #352: CMJ and the standing vertical jump are DIFFERENT tests and must not
  // share a key. Where both are recorded they disagree by up to ~7in, against a
  // HS grading band only 4in wide, so folding them together silently mis-grades.
  { key: 'cmj',          label: 'Counter-movement jump (CMJ)',      group: 'Strength & Power', unit: 'in' },
  { key: 'vertical_jump', label: 'Vertical jump (standing)',        group: 'Strength & Power', unit: 'in' },
  { key: 'broad_jump',   label: 'Broad jump',                       group: 'Strength & Power', unit: 'in' },
  // #351: the trap-bar JUMP is a jump height in inches. It is NOT a deadlift max
  // and must never fill `dl`, which is a bodyweight multiple.
  { key: 'trap_bar_jump', label: 'Trap-bar jump',                   group: 'Strength & Power', unit: 'in' },
  { key: 'dl',           label: 'Trap-bar deadlift (× BW)',         group: 'Strength & Power', unit: '× BW' },
  { key: 'back_squat',   label: 'Back squat 1RM',                   group: 'Strength & Power', unit: 'lb' },
  { key: 'bench',        label: 'Bench press 1RM',                  group: 'Strength & Power', unit: 'lb' },
  { key: 'grip',         label: 'Grip strength',                    group: 'Strength & Power', unit: 'kg' },

  // ---- Mobility / Screen ----
  { key: 'hipir',              label: 'Hip internal rotation',   group: 'Mobility / Screen', unit: '°' },
  { key: 'tspine',             label: 'T-spine rotation',        group: 'Mobility / Screen', unit: '°' },
  { key: 'ankle',              label: 'Ankle dorsiflexion',      group: 'Mobility / Screen', unit: 'cm' },
  { key: 'shoulder_ir',        label: 'Shoulder internal rot.',  group: 'Mobility / Screen', unit: '°' },
  { key: 'shoulder_er',        label: 'Shoulder external rot.',  group: 'Mobility / Screen', unit: '°' },
  { key: 'shoulder_rom_deficit', label: 'Shoulder ROM deficit', group: 'Mobility / Screen', unit: '°' },

  // ---- Anthropometric ----
  { key: 'body_weight',  label: 'Body weight',    group: 'Anthropometric', unit: 'lb' },
  { key: 'height',       label: 'Height',         group: 'Anthropometric', unit: 'in' },
  { key: 'body_fat_pct', label: 'Body fat %',     group: 'Anthropometric', unit: '%' },
  { key: 'training_age', label: 'Training age',   group: 'Anthropometric', unit: 'months' },
];

const METRIC_KEY_SET = new Set(ASSESSMENT_METRICS.map((m) => m.key));

export function isMetricKey(k) {
  return !!k && METRIC_KEY_SET.has(k);
}

export function metricLabel(k) {
  const m = ASSESSMENT_METRICS.find((x) => x.key === k);
  return m ? m.label : k;
}

// ASSESSMENT_METRICS grouped for a <select> — [{ group, items:[{key,label,unit}] }]
export function metricsByGroup() {
  return METRIC_GROUPS.map((g) => ({
    group: g,
    items: ASSESSMENT_METRICS.filter((m) => m.group === g),
  })).filter((g) => g.items.length > 0);
}

/**
 * Pull canonical metric values out of one assessment submission using the
 * template's metric_key tags. Returns { [metric_key]: number }.
 *
 * @param submission a row that includes `responses` (JSONB) and the joined
 *   template as `assessment_templates` (or `template`) with a `schema` array.
 *   Each schema element may have { id, type, label, metric_key }.
 *   Scalar responses are read as responses[element.id]; table/object responses
 *   are skipped (metrics are scalars).
 */
/**
 * Fuzzy label → canonical key fallback for legacy template elements that carry
 * no metric_key tag. This is the union of the per-generator fuzzy maps, so the
 * readiness panel and every generator agree on what data is "on file" — a
 * submission the generator can auto-fill from must never read as "Not assessed".
 * Evaluated in order; first match wins.
 */
const FUZZY_LABEL_TESTS = [
  ['batspeed', (l) => l.includes('bat speed') || l.includes('bat-speed')],
  // Front-toss EV is the ball-flight max the hitting assessment records.
  ['evmax', (l) => (l.includes('front toss') || l.includes('front-toss')) && (l.includes('ev') || l.includes('exit'))],
  ['evavg', (l) => (l.includes('exit') && (l.includes('avg') || l.includes('average'))) || l.includes('avg ev')],
  ['evmax', (l) => (l.includes('exit') && (l.includes('max') || l.includes('peak'))) || l.includes('max ev')],
  ['rotaccel', (l) => l.includes('rotational accel') || l.includes('rot accel')],
  ['handspeed', (l) => l.includes('hand speed')],
  ['ope', (l) => l.includes('on-plane') || l.includes('on plane')],
  ['attack', (l) => l.includes('attack angle')],
  ['earlyconn', (l) => l.includes('early') && l.includes('connection')],
  ['impconn', (l) => l.includes('connection') && (l.includes('impact') || l.includes('contact'))],
  ['ttc', (l) => l.includes('time to contact') || l.includes('time-to-contact')],
  ['xfactor', (l) => l.includes('separation') || l.includes('x-factor') || l.includes('x factor')],
  ['seq', (l) => l.includes('kinematic') || l.includes('sequence')],
  ['pelvis', (l) => l.includes('pelvis')],
  ['mbthrow', (l) => l.includes('med') && l.includes('ball')],
  // ---- Jumps (#352 / #351) ------------------------------------------------
  // These four labels all live side-by-side on the live S&C template:
  //   "Counter-Movement Jump", "Vertical Jump (in):", "Seated Vertical Jump (in):",
  //   "Approach Vertical Jump (in):", "Trap Bar Jump (in):".
  // They are five distinct tests. Order matters: the most specific claims its
  // label first so a looser test below can never steal it.
  ['cmj', (l) => l.includes('cmj') || l.includes('counter-movement') || l.includes('counter movement') || l.includes('countermovement')],
  // Standing vertical jump ONLY. Seated and approach jumps are separate tests
  // (no counter-movement / with a run-up) that used to masquerade as this one.
  ['vertical_jump', (l) => l.includes('vertical') && l.includes('jump')
    && !l.includes('seated') && !l.includes('approach')],
  // Trap-bar JUMP (inches) — must be tested BEFORE `dl` so it never lands in a
  // "× bodyweight" deadlift field (#351).
  ['trap_bar_jump', (l) => l.includes('trap') && l.includes('jump')],
  // Bilateral broad jump only — the single-leg broad jump is a different test.
  ['broad_jump', (l) => l.includes('broad') && l.includes('jump')
    && !/\bsl\b/.test(l) && !l.includes('single leg') && !l.includes('single-leg')],
  // #351: `dl` is a deadlift 1RM as a bodyweight multiple. Require an explicit
  // deadlift word (bare "trap" is not enough) and exclude jumps outright.
  ['dl', (l) => l.includes('deadlift') && !l.includes('jump')],
  ['grip', (l) => l.includes('grip')],
  ['shoulder_ir', (l) => l.includes('shoulder') && (l.includes(' ir') || l.includes('internal'))],
  ['shoulder_er', (l) => l.includes('shoulder') && (l.includes(' er') || l.includes('external'))],
  ['shoulder_rom_deficit', (l) => l.includes('total') && (l.includes('rom') || l.includes('motion'))],
  ['hipir', (l) => l.includes('hip') && (l.includes(' ir') || l.includes('internal'))],
  ['tspine', (l) => (l.includes('t-spine') || l.includes('tspine') || l.includes('thoracic')) && l.includes('rot')],
  ['ankle', (l) => l.includes('ankle') || l.includes('knee-to-wall') || l.includes('knee to wall') || l.includes('dorsi')],
  ['training_age', (l) => l.includes('training age')],
];

// Returns { key, rank } — rank is the test's position, so earlier (more
// specific) tests, like front-toss EV over generic max EV, win conflicts.
function fuzzyKeyForLabel(label) {
  const l = String(label || '').toLowerCase();
  if (!l) return null;
  for (let i = 0; i < FUZZY_LABEL_TESTS.length; i += 1) {
    const [key, test] = FUZZY_LABEL_TESTS[i];
    if (test(l)) return { key, rank: i };
  }
  return null;
}

/* ---------------------------------------------------------------------------
   MULTI-TRIAL VALUE PARSING

   Coaches record these fields as free text and routinely enter several trials
   or an R/L pair in one box: "82, 84", "100 / 75", "R-87, 96.6",
   "90 / 90    108 / 108", "19.7, 20.2", "14.4/15.5/16.7".

   The old parser stripped every non-digit and called parseFloat, which GLUED
   the trials together: "82, 84" -> 8284, "100 / 75" -> 10075,
   "90 / 90  108 / 108" -> 9090108108. Those numbers then fed benchmark grading
   and training-load selection.

   POLICY: take the FIRST number in the string (TRIAL_POLICY below).
   Reasoning:
     * It is conservative. The first entry is the first recorded trial, not a
       best-of, so it can never inflate a readiness/benchmark score.
     * Inflating is the dangerous direction: these values drive training load
       and exercise progression for minors. Under-reading produces a lighter,
       more remedial program; over-reading produces one the athlete cannot
       safely handle.
     * It is the only policy that is well defined for every observed shape,
       including R/L pairs where the numbers are not comparable trials at all.

   Switching to best-of-trials (or mean, or last) later is a ONE-LINE change:
   swap the body of pickTrial().
--------------------------------------------------------------------------- */

// Documented, single point of truth for the multi-trial policy.
export const TRIAL_POLICY = 'first';

// Change this one function to change the policy everywhere.
// e.g. best-of: `return Math.max(...nums);`  mean: `return nums.reduce(...)/nums.length;`
function pickTrial(nums) {
  return nums[0];
}

// Unsigned number tokens. The sign is decided separately (see below) because a
// hyphen in this data is almost always a separator or a side prefix ("R-87",
// "82-84"), not a minus. Negative jump heights / grip / deadlifts are
// meaningless, and "R-87" must not read as -87.
const NUM_TOKEN_RE = /\d+(?:\.\d+)?/g;

/**
 * Parse ONE numeric metric value out of a free-text response.
 * Returns a finite number or null. Never returns a glued-together trial pair.
 *
 * A leading "-" counts as a real minus sign only when nothing alphanumeric
 * precedes it (e.g. "-3.5" or "attack: -3"), so genuinely-signed metrics such
 * as attack angle keep working, while "R-87" yields +87.
 */
export function parseMetricValue(raw) {
  if (raw === undefined || raw === null || typeof raw === 'object' || typeof raw === 'boolean') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw);
  const nums = [];
  NUM_TOKEN_RE.lastIndex = 0;
  let m = NUM_TOKEN_RE.exec(s);
  while (m) {
    let n = parseFloat(m[0]);
    if (Number.isFinite(n)) {
      // Look back for a minus that is a SIGN rather than a separator/prefix.
      let i = m.index - 1;
      if (s[i] === '-') {
        let j = i - 1;
        while (j >= 0 && (s[j] === ' ' || s[j] === '\t')) j -= 1; // "x: -3" is still signed
        // Preceded by a letter/digit/'.'? then the '-' joined two tokens ("R-87", "82-84").
        if (j < 0 || !/[0-9A-Za-z.]/.test(s[j])) n = -n;
      }
      nums.push(n);
    }
    m = NUM_TOKEN_RE.exec(s);
  }
  if (!nums.length) return null;
  const picked = pickTrial(nums);
  return Number.isFinite(picked) ? picked : null;
}

/**
 * Same extraction as extractMetricsFromSubmission, but also reports HOW each
 * value was found: sources[key] === 'tag' (explicit metric_key, authoritative)
 * or 'fuzzy' (label guess, weakest evidence). Consumers that keep their own,
 * stricter label matcher need this so they can order the three sources
 * deliberately instead of relying on object-spread order (#351c).
 */
export function extractMetricSourcesFromSubmission(submission) {
  const values = extractMetricsFromSubmission(submission);
  const sources = {};
  const responses = submission?.responses || {};
  const tpl = submission?.assessment_templates || submission?.template || null;
  const schema = Array.isArray(tpl?.schema) ? tpl.schema : [];
  for (const el of schema) {
    // 'tag' only when the TAGGED element itself actually held a number — a tagged
    // element left blank is filled by the fuzzy pass and must not claim 'tag'.
    if (isMetricKey(el?.metric_key) && parseMetricValue(responses[el.id]) != null) sources[el.metric_key] = 'tag';
  }
  for (const k of Object.keys(values)) if (!sources[k]) sources[k] = 'fuzzy';
  return { values, sources };
}

/** Across submissions (newest-first), the newest value per key plus its source. */
export function extractMetricSourcesFromSubmissions(submissions) {
  const values = {};
  const sources = {};
  if (!Array.isArray(submissions)) return { values, sources };
  for (const sub of submissions) {
    const one = extractMetricSourcesFromSubmission(sub);
    for (const k in one.values) {
      if (values[k] === undefined) { values[k] = one.values[k]; sources[k] = one.sources[k]; }
    }
  }
  return { values, sources };
}

export function extractMetricsFromSubmission(submission) {
  const out = {};
  if (!submission) return out;
  const responses = submission.responses || {};
  const tpl = submission.assessment_templates || submission.template || null;
  const schema = Array.isArray(tpl?.schema) ? tpl.schema : [];
  const toNum = parseMetricValue;
  // Pass 1: explicit metric_key tags — authoritative.
  for (const el of schema) {
    const mk = el?.metric_key;
    if (!isMetricKey(mk)) continue;
    const num = toNum(responses[el.id]);
    if (num != null) out[mk] = num;
  }
  // Pass 2: fuzzy label match fills only keys the tags didn't cover. When two
  // labels map to the same key, the earlier (more specific) test wins.
  const fuzzyRank = {};
  for (const el of schema) {
    if (!el || el.metric_key) continue;
    const hit = fuzzyKeyForLabel(el.label);
    if (!hit) continue;
    if (out[hit.key] !== undefined && fuzzyRank[hit.key] === undefined) continue; // tagged — authoritative
    if (fuzzyRank[hit.key] !== undefined && fuzzyRank[hit.key] <= hit.rank) continue;
    const num = toNum(responses[el.id]);
    if (num != null) { out[hit.key] = num; fuzzyRank[hit.key] = hit.rank; }
  }
  return out;
}

/* ============================================================================
   Assessment "gates" / readiness — classify submissions into training areas so
   a generator can show which of S&C / Hitting / Throwing has real data on file
   before the coach picks a phase.
   ========================================================================== */

// The three program areas surfaced in the readiness panel.
export const ASSESSMENT_AREAS = [
  { key: 'sc', label: 'Strength & Conditioning' },
  { key: 'hitting', label: 'Hitting' },
  { key: 'throwing', label: 'Throwing / Pitching' },
];

// Metric-group → program area. Anthropometric is shared context and defines no area on its own.
const GROUP_TO_AREA = {
  Hitting: 'hitting',
  Throwing: 'throwing',
  'Strength & Power': 'sc',
  'Mobility / Screen': 'sc',
  Anthropometric: null,
};

const KEY_TO_GROUP = Object.fromEntries(ASSESSMENT_METRICS.map((m) => [m.key, m.group]));

// Which program areas a single submission carries real (numeric) data for.
export function assessmentAreas(submission) {
  const areas = new Set();
  const metrics = extractMetricsFromSubmission(submission);
  for (const k of Object.keys(metrics)) {
    const area = GROUP_TO_AREA[KEY_TO_GROUP[k]];
    if (area) areas.add(area);
  }
  return areas;
}

// Across an athlete's submissions, the most recent one that covers each area.
// Returns { sc: {date, submissionId}|null, hitting: ..., throwing: ... }.
export function assessmentReadiness(submissions) {
  const out = { sc: null, hitting: null, throwing: null };
  const rows = (submissions || []).slice().sort((a, b) => String(b.assessment_date || b.created_at || '')
    .localeCompare(String(a.assessment_date || a.created_at || '')));
  for (const s of rows) {
    const date = s.assessment_date || s.created_at || null;
    assessmentAreas(s).forEach((a) => { if (!out[a]) out[a] = { date, submissionId: s.id }; });
  }
  return out;
}

/**
 * Merge canonical metric values across MANY submissions, keeping the MOST-RECENT
 * value for each metric key. Pass submissions NEWEST-FIRST (e.g. queried with
 * .order('assessment_date', { ascending: false })). This lets one athlete's S&C,
 * hitting AND throwing assessments all feed a generator at once — every metric is
 * filled from the newest assessment that actually measured it, instead of only
 * the single latest submission (which often screens just one domain). Returns
 * { [metric_key]: number }.
 */
export function extractMetricsFromSubmissions(submissions) {
  const out = {};
  if (!Array.isArray(submissions)) return out;
  for (const sub of submissions) {
    const one = extractMetricsFromSubmission(sub);
    for (const k in one) if (out[k] === undefined) out[k] = one[k];
  }
  return out;
}
