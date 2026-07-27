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
  { key: 'cmj',          label: 'Counter-movement / vertical jump', group: 'Strength & Power', unit: 'in' },
  { key: 'broad_jump',   label: 'Broad jump',                       group: 'Strength & Power', unit: 'in' },
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
export function extractMetricsFromSubmission(submission) {
  const out = {};
  if (!submission) return out;
  const responses = submission.responses || {};
  const tpl = submission.assessment_templates || submission.template || null;
  const schema = Array.isArray(tpl?.schema) ? tpl.schema : [];
  for (const el of schema) {
    const mk = el?.metric_key;
    if (!isMetricKey(mk)) continue;
    const raw = responses[el.id];
    if (raw === undefined || raw === null || typeof raw === 'object') continue;
    const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
    if (!Number.isNaN(num)) out[mk] = num;
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
