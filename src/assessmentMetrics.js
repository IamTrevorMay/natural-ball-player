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
  // #351/#352 (Cordell): the S&C sheet has collected these three jumps on 300+
  // athletes and every one of them was thrown away. They are now captured and
  // displayed. They are DELIBERATELY not graded and drive no programming
  // decision — there are no calibrated benchmark bands for them yet.
  { key: 'seated_vertical_jump',   label: 'Seated vertical jump',   group: 'Strength & Power', unit: 'in' },
  { key: 'approach_vertical_jump', label: 'Approach vertical jump', group: 'Strength & Power', unit: 'in' },
  { key: 'depth_drop_jump',        label: 'Depth drop jump',        group: 'Strength & Power', unit: 'in' },
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
  // The seated / approach / depth-drop jumps claim their own labels FIRST so the
  // looser standing-vertical test below can never steal them. (The standing test
  // also excludes them explicitly — belt and braces, because these two guards
  // are what keep five distinct tests out of each other's fields.)
  ['seated_vertical_jump', (l) => l.includes('seated') && l.includes('jump')],
  ['approach_vertical_jump', (l) => l.includes('approach') && l.includes('jump')],
  ['depth_drop_jump', (l) => (l.includes('depth drop') || l.includes('depth-drop')
    || (l.includes('depth') && l.includes('drop'))) && l.includes('jump')],
  // Standing vertical jump ONLY. Seated and approach jumps are separate tests
  // (no counter-movement / with a run-up) that used to masquerade as this one.
  ['vertical_jump', (l) => l.includes('vertical') && l.includes('jump')
    && !l.includes('seated') && !l.includes('approach') && !l.includes('depth')],
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
  // ---- Anthropometric -----------------------------------------------------
  // These two were missing entirely, which is why `body_weight` was never
  // populated (so the trap-bar deadlift could not be converted to × BW) and
  // NutritionGenerator's height/weight auto-fill was dead code. The live labels
  // are "Weight (lbs):" and "Height (in):" on the Strength & Conditioning
  // template, neither of which carries a metric_key tag.
  // MUST exclude the Hitting sheet's "Bat Length (in)/ Weight (oz):" — that is
  // a bat weight in ounces, not an athlete.
  ['body_weight', (l) => l.includes('weight')
    && !l.includes('bat') && !l.includes('oz') && !l.includes('ball')
    && !l.includes('plate') && !l.includes('bar ')],
  // "height" only; a jump height is a jump, not an anthropometric.
  ['height', (l) => l.includes('height')
    && !l.includes('jump') && !l.includes('vert') && !l.includes('reach')],
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

   The original parser stripped every non-digit and called parseFloat, which
   GLUED the trials together: "82, 84" -> 8284, "100 / 75" -> 10075. Those
   numbers then fed benchmark grading and training-load selection.

   POLICY (Cordell, #351): "You need to be able to read all of the numbers …
   take the highest number and understand that commas or spaces mean they are
   two different numbers for the same metric." -> BEST TRIAL, i.e. the maximum.

   Taking a maximum re-opens the failure mode that "first" was originally chosen
   to avoid — a stray token (a year in "(12/2/2025): 60.1 / 59.4mph", a spin
   rate, a jersey number, a unit digit) becomes the answer and inflates a
   readiness score that sets training load for a minor. Three guards make "max"
   safe, and they must stay:

     1. DATE STRIPPING  — an explicit calendar date is removed before tokenizing,
        so "(12/2/2025): 60.1 / 59.4" reads 60.1 and never 2025. The pattern
        insists on a 19xx/20xx year so a legitimate three-trial entry
        ("90 / 90 / 108") is untouched.
     2. RANGE GUARD     — METRIC_PLAUSIBLE_RANGE below. Tokens outside the
        physically possible range for THAT metric are discarded before the
        policy runs. If nothing plausible survives, the metric reads as
        NOT MEASURED rather than as a wrong number — absent is recoverable,
        wrong is not.
     3. SIGN RULE       — a hyphen is only a minus when nothing alphanumeric
        precedes it, so "R-87" is +87 and "L-180 R-160" is 180, while a
        genuinely negative attack angle ("-3") survives as -3.

   DIRECTION. "Highest" is the best trial only for a higher-is-better metric.
   Two other kinds exist in this registry and are handled explicitly rather than
   silently: LOWER_IS_BETTER_METRICS (time to contact, shoulder ROM deficit,
   body-fat %) take the minimum, and BAND_METRICS (attack angle, early/impact
   connection — graded against a target band, where neither direction is
   "better") keep the FIRST recorded trial, because max(-5, -3) = -3 would
   silently assert an improvement that the band does not agree with.
--------------------------------------------------------------------------- */

// Documented, single point of truth for the multi-trial policy.
export const TRIAL_POLICY = 'best';

// Best trial = the LOWEST number (lower is better).
export const LOWER_IS_BETTER_METRICS = new Set(['ttc', 'shoulder_rom_deficit', 'body_fat_pct']);

// Graded against a target band — "best of trials" is undefined, so keep the
// first (chronologically first attempt) and never re-rank the trials.
export const BAND_METRICS = new Set(['attack', 'earlyconn', 'impconn']);

/* Physically possible range per metric, [min, max] inclusive. Deliberately WIDE
   — this is a garbage filter, not a benchmark. Anything not listed is not
   filtered. Units follow ASSESSMENT_METRICS.
   `dl`/`back_squat`/`bench` span both a × BW multiple and a raw pound figure
   because coaches enter both (see toRelativeStrength below). */
export const METRIC_PLAUSIBLE_RANGE = {
  batspeed: [15, 120], evmax: [10, 130], evavg: [10, 130], rotaccel: [0.2, 60],
  handspeed: [3, 45], ope: [0, 100], attack: [-45, 45], earlyconn: [-90, 200],
  impconn: [-90, 200], ttc: [0.01, 2], xfactor: [0, 120], seq: [0, 100],
  pelvis: [50, 2000], mbthrow: [2, 80],
  // 108 not 120, and this single number replaces what was a regex trying to
  // recognise spin-axis notes by the words around them. Coaches write the axis
  // as a clock time in the velocity box ("the spin axis is 115-230"), and 115
  // used to sit inside the range and win under a take-the-highest policy. Two
  // attempts at a word-based guard each fixed some pitchers and broke others.
  // The honest bound does it with no pattern-matching at all: the fastest
  // pitch ever thrown is ~105mph, so 115 / 130 / 230 / 1230 / 1245 are all
  // impossible and drop out, while 54.3, 75-79, 88-91 and even a legitimate
  // 100-105 are untouched. If a genuine 108+ ever needs recording, raise this.
  throwing_velo_max: [15, 108], fb_velo: [15, 108], arm_speed: [5, 150],
  biomech_score: [0, 100], mobility_score: [0, 100], strength_score: [0, 100],
  cmj: [1, 60], vertical_jump: [1, 60], seated_vertical_jump: [1, 60],
  approach_vertical_jump: [1, 70], depth_drop_jump: [1, 60], trap_bar_jump: [1, 60],
  broad_jump: [12, 200],
  dl: [0.3, 1200], back_squat: [0.3, 1200], bench: [0.3, 1000], grip: [3, 300],
  /* "Hip ER/IR R/L:" is ONE live field holding BOTH rotations plus, on many
     sheets, hip flexion ("R-156/18", "R ER76 IR59/L ER88 IR42"). This registry
     maps it to hip IR, so the 60 ceiling is doing real work: it keeps a flexion
     reading (120-170) out of a field the engine gates at "< 30 -> hip-mobility
     corrective". It cannot separate ER from IR — the template needs two
     elements for that. Flagged, not silently fixed. */
  hipir: [0, 60],
  // Widened to 200 deliberately: the live "T-Spine Rotation" field holds 180 /
  // 185 / "L-180 R-160" on real athletes. Those cannot be degrees of thoracic
  // rotation, but they are what the engine grades today and tightening the
  // range here would silently flip every one of those athletes from "passing"
  // to "not screened" (== null -> a tspine_rotation corrective) as a side
  // effect of a parser change. Out of scope; 200 still rejects a stray year.
  tspine: [0, 200],
  /* Ankle dorsiflexion is a knee-to-wall distance in CENTIMETRES; the engine
     flags "< 10" and a healthy adult is 5-15. Every numeric entry on the live
     sheet is in some other unit — "159/75 154/80", "R 150, 70, L 131, 63",
     "R-26, L-44", "R47,50/L44,48" — i.e. paired joint angles typed into a cm
     box. A 20 ceiling rejects all of them, so ankle reads as NOT MEASURED,
     which the engine already treats conservatively (null -> ankle_mobility
     corrective). That is the point: before this, 156 was read as the athlete's
     dorsiflexion and silently cleared the ankle-mobility gate. Nobody currently
     has a real dorsiflexion number on file, and pretending otherwise is worse
     than admitting it. */
  ankle: [0, 20],
  shoulder_ir: [0, 120], shoulder_er: [0, 180], shoulder_rom_deficit: [0, 90],
  body_weight: [50, 450], height: [30, 90], body_fat_pct: [1, 60],
  training_age: [0, 600],
};

// Change this one function to change the policy everywhere.
function pickTrial(nums, key) {
  if (nums.length === 1) return nums[0];
  if (key && BAND_METRICS.has(key)) return nums[0];
  if (key && LOWER_IS_BETTER_METRICS.has(key)) return Math.min(...nums);
  return Math.max(...nums);
}

// Unsigned number tokens. The sign is decided separately (see below) because a
// hyphen in this data is almost always a separator or a side prefix ("R-87",
// "82-84"), not a minus. Negative jump heights / grip / deadlifts are
// meaningless, and "R-87" must not read as -87.
// The `\.\d+` alternative matters: coaches write a time to contact as ".13",
// which without it tokenizes as 13.
const NUM_TOKEN_RE = /\d+(?:\.\d+)?|\.\d+/g;

// Calendar dates coaches paste into a value box: "12/2/2025", "12-2-2025",
// "2025-12-02". The 19xx/20xx anchor is what stops this eating a real trial
// triple such as "90 / 90 / 108".
const DATE_RE = /\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*(?:19|20)\d{2}|(?:19|20)\d{2}\s*-\s*\d{1,2}\s*-\s*\d{1,2}/g;

/* Metrics that ARE a percentage. Everywhere else a number written with a "%"
   is commentary — "at 85% intent", "cannot move farther then 45% without…",
   "90% control down, 15% push up" — and must not compete for the maximum.
   Dropping it is what keeps `hip IR` reading "not measured" for a prose note
   instead of reading 45°, and keeps a fastball velo at 83.2 instead of 85. */
const PERCENT_OK = new Set(['ope', 'seq', 'body_fat_pct', 'mobility_score', 'strength_score', 'biomech_score']);

const FEET_INCHES_RE = /(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)?/;
// QA: also accept the word form — two athletes' broad jumps are written "5ft"
// and "8ft" and were reading as NOT MEASURED because only the ' mark was known.
const FEET_INCHES_ALL_RE = /(\d{1,2})\s*(?:['’′]|\s*f(?:ee)?t\b)\s*(\d{1,2}(?:\.\d+)?)?/gi;

/**
 * Parse ONE numeric metric value out of a free-text response.
 * Returns a finite number or null. Never returns a glued-together trial pair.
 *
 * @param raw the response value (string | number | anything)
 * @param key OPTIONAL canonical metric key. Supplying it enables the range
 *   guard and the correct trial direction, so callers should always pass it
 *   when they know which metric they are reading.
 */
export function parseMetricValue(raw, key) {
  if (raw === undefined || raw === null || typeof raw === 'object' || typeof raw === 'boolean') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw);

  // Height and broad jump are routinely written in feet-and-inches. Convert
  // before tokenizing, or "5'11" reads as 11 inches. QA: broad jump was left
  // out of this first time round and 10 athletes lost the metric entirely,
  // because 7 and 11 both fall under the 12in floor of its plausible range.
  // A broad jump can be a MULTI-trial feet-inches entry ("7'11\", 8'1\"") so
  // take every pair and let pickTrial choose, rather than returning the first.
  if (key === 'height' || key === 'broad_jump') {
    const fiAll = [...s.matchAll(FEET_INCHES_ALL_RE)]
      .map((fi) => (parseInt(fi[1], 10) * 12) + (fi[2] ? parseFloat(fi[2]) : 0))
      .filter((n) => Number.isFinite(n));
    if (fiAll.length) {
      // Height keeps its long-standing "first pair" reading. Only the broad
      // jump is a repeated trial where the best attempt is the right answer;
      // taking the max for height would silently reinterpret one live value
      // ("5'9  5-10-25  6'") as a different person's height.
      // QA: the range guard must apply here too, or "20ft" becomes a 240in
      // broad jump instead of being rejected as implausible.
      const fiRange = METRIC_PLAUSIBLE_RANGE[key];
      const fiOk = fiRange ? fiAll.filter((n) => n >= fiRange[0] && n <= fiRange[1]) : fiAll;
      if (!fiOk.length) return null;
      const picked = key === 'broad_jump' ? pickTrial(fiOk, key) : fiOk[0];
      return Number.isFinite(picked) ? picked : null;
    }
  }

  s = s.replace(DATE_RE, ' ');

  const percentOk = !key || PERCENT_OK.has(key);
  const nums = [];
  NUM_TOKEN_RE.lastIndex = 0;
  let m = NUM_TOKEN_RE.exec(s);
  while (m) {
    let n = parseFloat(m[0]);
    // Look ahead for a '%' — commentary, not a trial, unless this metric is a %.
    if (!percentOk) {
      let k = m.index + m[0].length;
      while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k += 1;
      if (s[k] === '%') n = NaN;
    }
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

  // Range guard — drop impossible tokens before choosing the best trial.
  const range = key ? METRIC_PLAUSIBLE_RANGE[key] : null;
  const usable = range ? nums.filter((n) => n >= range[0] && n <= range[1]) : nums;
  // Nothing plausible was written in this box -> NOT MEASURED, not a guess.
  if (!usable.length) return null;

  const picked = pickTrial(usable, key);
  return Number.isFinite(picked) ? picked : null;
}

/* ---------------------------------------------------------------------------
   RELATIVE STRENGTH (#351, Cordell: "We always write the weight in pounds.")

   The Strength & Conditioning template labels the field "Trap Bar Deadlift
   (X BW)" but coaches enter POUNDS — the single real value on file is 405.
   Both grading tables that consume it (SC_BM.rel_trap_bar_dl in
   scProgramEngine.js and BM.dl in hittingEngine.js) are bodyweight multiples
   where a professional is 2.5-2.8x, so 405 grades as ~150x — off the top of
   every band, which biases the plan to "express power" and unlocks
   advanced-stage lifts for a kid who may not deadlift at all.

   Rule: a genuine multiple is single digits, so anything above
   MAX_PLAUSIBLE_XBW is pounds and is divided by the athlete's body weight.
   With no usable body weight on file we do NOT guess: the metric is dropped and
   reads as not measured. Grading nobody is safe; grading everybody wrong is not.
--------------------------------------------------------------------------- */

// An elite senior trap-bar pull is ~3x bodyweight; 8 is unreachable, so any
// value above it is a pound figure that was typed into a "(X BW)" box.
export const MAX_PLAUSIBLE_XBW = 8;

/**
 * Convert a recorded lift to a bodyweight multiple.
 * @returns number (× BW) or null when it cannot be interpreted.
 */
export function toRelativeStrength(recorded, bodyWeightLb) {
  const v = Number(recorded);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v <= MAX_PLAUSIBLE_XBW) return v; // already a multiple
  const bw = Number(bodyWeightLb);
  const range = METRIC_PLAUSIBLE_RANGE.body_weight;
  if (!Number.isFinite(bw) || bw < range[0] || bw > range[1]) return null;
  return Math.round((v / bw) * 100) / 100;
}

/**
 * Post-merge normalization of a { metric_key: number } bag.
 * Runs only on the MERGED (multi-submission) result, because the body weight
 * that interprets a deadlift is often recorded on a different assessment than
 * the deadlift itself. Mutates and returns the bag.
 */
function normalizeMergedMetrics(values, sources) {
  if (values.dl != null) {
    const rel = toRelativeStrength(values.dl, values.body_weight);
    if (rel == null) {
      delete values.dl;
      if (sources) delete sources.dl;
    } else {
      values.dl = rel;
    }
  }
  return values;
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
    if (isMetricKey(el?.metric_key) && parseMetricValue(responses[el.id], el.metric_key) != null) sources[el.metric_key] = 'tag';
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
  normalizeMergedMetrics(values, sources);
  return { values, sources };
}

/* NOTE: this returns `dl` RAW — exactly as the coach wrote it, which per
   Cordell is pounds. Only the multi-submission entry points below convert it to
   a bodyweight multiple, because the body weight may live on another
   submission. Read metrics through extractMetricsFromSubmissions() /
   extractMetricSourcesFromSubmissions() unless you specifically want raw. */
export function extractMetricsFromSubmission(submission) {
  const out = {};
  if (!submission) return out;
  const responses = submission.responses || {};
  const tpl = submission.assessment_templates || submission.template || null;
  const schema = Array.isArray(tpl?.schema) ? tpl.schema : [];
  // Pass 1: explicit metric_key tags — authoritative.
  for (const el of schema) {
    const mk = el?.metric_key;
    if (!isMetricKey(mk)) continue;
    const num = parseMetricValue(responses[el.id], mk);
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
    const num = parseMetricValue(responses[el.id], hit.key);
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
  // `dl` arrives RAW (pounds or × BW) from the per-submission pass; only here,
  // with every submission merged, is the athlete's body weight guaranteed to be
  // available to interpret it. See normalizeMergedMetrics / toRelativeStrength.
  return normalizeMergedMetrics(out, null);
}
