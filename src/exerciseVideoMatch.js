/*
 * Issue #170 — "AI Agent To Find Hyperlinks For All Videos".
 *
 * The honest shape of the problem, measured against the real database:
 *
 *   workout_templates.exercises   8,008 entries, 2,876 with an empty `link`,
 *                                 across 1,116 distinct names.
 *   training_exercises            275 rows, 211 with an empty `video_url`
 *                                 (note: that column is video_url, not link).
 *   exercise_videos               1,275 rows — the library.
 *
 * The library was built FROM entries that already had a link, so an exact-match
 * backfill scores exactly zero. Anything still missing is missing *because* it
 * is not in the library. This module therefore does not pretend to "fill in the
 * links"; it measures the gap precisely, offers the best library candidate with
 * a score, and — most importantly — is willing to say NOTHING MATCHES.
 *
 * That last part is the whole design. A wrong instructional video on a youth
 * baseball movement is worse than a blank one: the athlete does the wrong thing
 * and nobody finds out. An empty `bestMatches()` result is a first-class,
 * correct answer, not a failure to be papered over with the closest string.
 *
 * Pure and dependency-free on purpose: no React, no Supabase. Everything here
 * is testable in plain Node.
 */

// ---------------------------------------------------------------------------
// Tunable thresholds. Every heuristic in this file reads from a named constant
// so the numbers can be moved in one place, and so the UI cannot drift from the
// module (the screen imports MATCH_TIERS rather than hard-coding 0.75).
// ---------------------------------------------------------------------------

export const MATCH_TIERS = {
  high: {
    key: 'high',
    min: 0.75,
    label: 'High confidence',
    description: 'Near-certain the same movement. Still worth an eyeball before applying.',
  },
  review: {
    key: 'review',
    min: 0.6,
    label: 'Needs review',
    description: 'Plausibly the same movement. A human must confirm before this is written.',
  },
  weak: {
    key: 'weak',
    min: 0.4,
    label: 'Weak',
    description: 'Probably NOT the same movement. Shown only so the reviewer can rule it out.',
  },
};

// Below this, no candidate is offered at all. See NO_MATCH_TIER.
export const DEFAULT_MIN_SCORE = MATCH_TIERS.weak.min;
export const NO_MATCH_TIER = 'none';

// scoreMatch() blends two similarity measures. Word tokens carry more weight
// because exercise names are short compounds of meaningful words ("chest
// supported dumbbell row"), but character trigrams keep heavily abbreviated or
// mistyped names ("kb windmills" / "KB WIndmills") from falling off a cliff.
export const TOKEN_WEIGHT = 0.6;
export const TRIGRAM_WEIGHT = 0.4;
export const TRIGRAM_SIZE = 3;

// classifyExerciseName() heuristics.
export const CLASSIFY_THRESHOLDS = {
  // Anything longer than this is coaching prose, not a movement name. Real
  // movement names in this database top out around 60 characters.
  proseMaxChars: 80,
  // Belt-and-braces for a short-but-rambling instruction.
  proseMaxWords: 14,
  // A shorter-than-80-character string is still prose if it runs to this many
  // words AND carries sentence punctuation — "Fastball low away, then work the
  // arm side corner of the plate" is an instruction, not a movement. Set high
  // enough that a long-but-real movement name ("Single Leg Rear Foot Elevated
  // Split Squat, each side", 9 words) stays a movement: mislabelling a real
  // movement as prose would hide a genuine gap, which is the costlier error.
  proseMinWordsWithPunctuation: 10,
  // A plural is only stripped from words longer than this, so "abs" and short
  // codes are not mangled into nonsense.
  pluralMinLength: 3,
};

// Domain shorthand as it is actually typed into the workout builder. Applied
// per-token after pluralisation, so "BB RDLS" and "barbell rdl" land on the
// identical string "barbell romanian deadlift".
export const ABBREVIATIONS = {
  bb: 'barbell',
  db: 'dumbbell',
  kb: 'kettlebell',
  sl: 'single leg',
  oh: 'overhead',
  rdl: 'romanian deadlift',
  ssb: 'safety squat bar',
  bw: 'bodyweight',
  mb: 'medicine ball',
  dl: 'deadlift',
  ohp: 'overhead press',
  rfe: 'rear foot elevated',
  ffe: 'front foot elevated',
  iso: 'isometric',
  ecc: 'eccentric',
  alt: 'alternating',
  ea: 'each',
  es: 'each side',
};

// Pitch vocabulary. Matched against the RAW lowercased name — normalisation
// would expand abbreviations and confuse this.
const PITCH_TYPE_RE = /\b(fb|fastball|four\s?seam|two\s?seam|change\s?up|changeup|slider|curve\s?ball|curveball|cutter|splitter|sinker|knuckle\w*)\b/;

// "2-0 count", "3-1 COUNT ..." — bullpen prescriptions, never a movement.
const COUNT_DRILL_RE = /^\s*\d\s*[-–]\s*\d\s*count\b/;

// Sentence punctuation — a comma, semicolon, colon or full stop that is
// followed by a space or ends the string (so "3.5" and "1:1" are not caught).
const SENTENCE_PUNCTUATION_RE = /[,;:.](\s|$)/;

// Plate-location language: "low in", "up away", "arm side", "glove side",
// "black away", "zone 4", "down and away".
const LOCATION_RES = [
  /\b(low|up|middle|mid|belt|knee|thigh|letters|black)\s+(in|away|out|outside|inside)\b/,
  /\b(arm|glove)\s?side\b/,
  /\bzone\s*\d\b/,
  /\b(in|out|outer|inner)\s+(corner|third|half)\b/,
  /\bdown\s+and\s+(in|away|out)\b/,
  /\bpaint(ing)?\s+(the\s+)?(black|corner)/,
];

// Punctuation that should vanish rather than split a word: "fly;s" is one word
// with a stray keypress in it, and "athlete's" is not two tokens.
const GLUE_PUNCTUATION_RE = /['’`´;]/g;
const NON_ALPHANUMERIC_RE = /[^a-z0-9]+/g;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

// Simple trailing-plural stripper. It does not need to be linguistically
// correct — it needs to be *symmetric*, because both sides of every comparison
// pass through it. "raises" -> "raise" and "flies" -> "fly" are the two forms
// that actually show up in this data.
function singularise(word) {
  if (word.length <= CLASSIFY_THRESHOLDS.pluralMinLength) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Lowercase, de-punctuate, de-pluralise and expand domain shorthand.
 * Returns a normalized string; the empty string for junk input.
 */
export function normalizeExerciseName(name) {
  if (typeof name !== 'string') return '';
  const cleaned = name
    .toLowerCase()
    .replace(GLUE_PUNCTUATION_RE, '')
    .replace(NON_ALPHANUMERIC_RE, ' ')
    .trim();
  if (!cleaned) return '';

  const out = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    const singular = singularise(raw);
    const expansion = ABBREVIATIONS[singular];
    if (expansion) out.push(...expansion.split(' '));
    else out.push(singular);
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * 'movement' | 'pitch_sequence' | 'count_drill' | 'location_drill' | 'prose'
 *
 * Everything except 'movement' is a prescription that must NEVER be given a
 * video. These are heuristics, not truth — they exist so the screen can put a
 * defensible number on "how many of these gaps are real".
 */
export function classifyExerciseName(name) {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) return 'prose';
  const lower = raw.toLowerCase();

  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (raw.length > CLASSIFY_THRESHOLDS.proseMaxChars) return 'prose';
  if (wordCount > CLASSIFY_THRESHOLDS.proseMaxWords) return 'prose';
  if (wordCount >= CLASSIFY_THRESHOLDS.proseMinWordsWithPunctuation && SENTENCE_PUNCTUATION_RE.test(lower)) {
    return 'prose';
  }

  // A pitch type plus a slash is a sequence: "2 seam fb low in / changeup low in".
  if (PITCH_TYPE_RE.test(lower) && lower.includes('/')) return 'pitch_sequence';

  if (COUNT_DRILL_RE.test(lower)) return 'count_drill';

  if (LOCATION_RES.some((re) => re.test(lower))) return 'location_drill';

  // A bare pitch type with no slash and no location is still a prescription
  // ("2 seam curveball"), not something with an instructional video.
  if (PITCH_TYPE_RE.test(lower)) return 'pitch_sequence';

  return 'movement';
}

export const MOVEMENT_CLASSIFICATION = 'movement';

export const CLASSIFICATION_LABELS = {
  movement: 'Movement',
  pitch_sequence: 'Pitch sequence',
  count_drill: 'Count drill',
  location_drill: 'Location drill',
  prose: 'Coaching prose',
};

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

function tokenSet(normalized) {
  const set = new Set();
  if (!normalized) return set;
  for (const t of normalized.split(' ')) if (t) set.add(t);
  return set;
}

function trigramSet(normalized) {
  const set = new Set();
  if (!normalized) return set;
  // Padding lets short names ("bb rdl") still produce edge trigrams, so a
  // two-token name is not compared on a handful of interior slices.
  const padded = ` ${normalized} `;
  if (padded.length < TRIGRAM_SIZE) {
    set.add(padded);
    return set;
  }
  for (let i = 0; i + TRIGRAM_SIZE <= padded.length; i += 1) {
    set.add(padded.slice(i, i + TRIGRAM_SIZE));
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 0;
  // Iterate the smaller set.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const v of small) if (large.has(v)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function combine(tokenScore, trigramScore) {
  return (tokenScore * TOKEN_WEIGHT) + (trigramScore * TRIGRAM_WEIGHT);
}

/**
 * Similarity in [0, 1] between two ALREADY-NORMALIZED names.
 * Symmetric; returns exactly 1 for identical non-empty input.
 */
export function scoreMatch(a, b) {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  if (!left || !right) return 0;
  if (left === right) return 1;
  return combine(
    jaccard(tokenSet(left), tokenSet(right)),
    jaccard(trigramSet(left), trigramSet(right)),
  );
}

/** Which tier a score falls in. Returns NO_MATCH_TIER below the weak floor. */
export function tierForScore(score) {
  if (score >= MATCH_TIERS.high.min) return 'high';
  if (score >= MATCH_TIERS.review.min) return 'review';
  if (score >= MATCH_TIERS.weak.min) return 'weak';
  return NO_MATCH_TIER;
}

// ---------------------------------------------------------------------------
// Library index
//
// ~1,100 candidate names x ~1,275 library rows is 1.4M naive comparisons, each
// of which would otherwise re-normalize and re-tokenise both sides. Instead the
// library is normalized ONCE into an index with precomputed token and trigram
// sets, plus an inverted token index so a candidate is only ever scored against
// library entries that share at least one word with it.
//
// The deliberate trade-off: a candidate sharing NO whole word with a library
// entry is never scored, even if its trigrams overlap. Such a pair would score
// at most TRIGRAM_WEIGHT (0.4) — the very bottom of the weak tier — so nothing
// worth showing is lost, and the run drops to tens of milliseconds.
// ---------------------------------------------------------------------------

const indexCache = new WeakMap();

/** Build (or reuse) the precomputed index for a library array. */
export function buildLibraryIndex(library) {
  const rows = Array.isArray(library) ? library : [];
  const cached = indexCache.get(rows);
  if (cached) return cached;

  const entries = [];
  const byToken = new Map();
  rows.forEach((row) => {
    if (!row) return;
    const display = String(row.name || row.name_key || '').trim();
    const normalized = normalizeExerciseName(row.name_key || row.name || '');
    if (!normalized) return;
    const videoUrl = String(row.video_url || '').trim();
    if (!videoUrl) return; // A library row with no URL cannot fill a gap.
    const tokens = tokenSet(normalized);
    const entry = {
      name: display || normalized,
      name_key: row.name_key || normalized,
      video_url: videoUrl,
      normalized,
      tokens,
      trigrams: trigramSet(normalized),
    };
    const idx = entries.push(entry) - 1;
    tokens.forEach((token) => {
      const bucket = byToken.get(token);
      if (bucket) bucket.push(idx);
      else byToken.set(token, [idx]);
    });
  });

  const index = { entries, byToken, size: entries.length };
  try { indexCache.set(rows, index); } catch { /* non-object library; skip cache */ }
  return index;
}

// Score one already-normalized candidate against the index. Shared by
// bestMatches() and buildGapReport() so both use identical maths.
function matchAgainstIndex(normalized, index, limit, minScore) {
  if (!normalized || index.size === 0) return [];
  const tokens = tokenSet(normalized);
  const trigrams = trigramSet(normalized);

  const seen = new Set();
  const scored = [];
  tokens.forEach((token) => {
    const bucket = index.byToken.get(token);
    if (!bucket) return;
    for (const idx of bucket) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const entry = index.entries[idx];
      const score = entry.normalized === normalized
        ? 1
        : combine(jaccard(tokens, entry.tokens), jaccard(trigrams, entry.trigrams));
      if (score < minScore) continue;
      scored.push({
        name: entry.name,
        name_key: entry.name_key,
        video_url: entry.video_url,
        score,
        tier: tierForScore(score),
      });
    }
  });

  // Best first; ties broken on name so the output is deterministic.
  scored.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}

/**
 * Best library candidates for a name.
 *
 * @param {string} name        raw (un-normalized) exercise name
 * @param {Array}  library     [{ name, name_key, video_url }]
 * @param {object} options     { limit = 3, minScore = 0.4 }
 * @returns {Array} [{ name, name_key, video_url, score, tier }] best first.
 *
 * An EMPTY ARRAY is the correct, expected answer for most of the gap list. It
 * means "the library does not contain this movement" — it does not mean the
 * matcher failed, and the caller must not fall back to a lower threshold.
 */
export function bestMatches(name, library, { limit = 3, minScore = DEFAULT_MIN_SCORE } = {}) {
  const normalized = normalizeExerciseName(name);
  if (!normalized) return [];
  return matchAgainstIndex(normalized, buildLibraryIndex(library), limit, minScore);
}

// ---------------------------------------------------------------------------
// Gap report
// ---------------------------------------------------------------------------

function emptyClassificationCounts() {
  return { movement: 0, pitch_sequence: 0, count_drill: 0, location_drill: 0, prose: 0 };
}

/**
 * Group raw gap occurrences by normalized name, classify each, and attach the
 * best library candidates.
 *
 * @param {Array} gaps  occurrences, each { name, source, folder, ref }
 *                      where source === 'template' counts as a workout template
 *                      entry and anything else counts as an assigned program row.
 * @param {Array} library  [{ name, name_key, video_url }]
 * @param {object} options { limit, minScore, excludedKeys }
 *
 * @returns {{ rows: Array, summary: object }}
 *
 * summary is the honest headline. Note in particular:
 *   summary.needsNewVideo — movement names the library cannot cover at all.
 *     This is the real answer to #170: a video has to be filmed or sourced for
 *     each of these, and there is no YouTube API key on this project, so no
 *     tool here can produce them.
 */
export function buildGapReport(gaps, library, options = {}) {
  const {
    limit = 3,
    minScore = DEFAULT_MIN_SCORE,
    excludedKeys = [],
  } = options;

  const excluded = excludedKeys instanceof Set ? excludedKeys : new Set(excludedKeys || []);
  const index = buildLibraryIndex(library);

  // --- group by normalized name -------------------------------------------
  const groups = new Map();
  let excludedOccurrences = 0;
  let excludedNames = 0;
  let unusable = 0;

  (Array.isArray(gaps) ? gaps : []).forEach((gap) => {
    const rawName = gap && typeof gap.name === 'string' ? gap.name.trim() : '';
    const key = normalizeExerciseName(rawName);
    if (!key) { unusable += 1; return; }

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        normalized: key,
        displayCounts: new Map(),
        occurrences: 0,
        templateCount: 0,
        programCount: 0,
        folders: new Set(),
        refs: [],
      };
      groups.set(key, group);
    }
    group.occurrences += 1;
    if (gap.source === 'template') group.templateCount += 1;
    else group.programCount += 1;
    if (gap.folder) group.folders.add(String(gap.folder));
    group.displayCounts.set(rawName, (group.displayCounts.get(rawName) || 0) + 1);
    group.refs.push(gap);
  });

  // --- build rows ----------------------------------------------------------
  const rows = [];
  const byClassification = emptyClassificationCounts();
  const occurrencesByClassification = emptyClassificationCounts();
  const byTier = { high: 0, review: 0, weak: 0, [NO_MATCH_TIER]: 0 };
  const occurrencesByTier = { high: 0, review: 0, weak: 0, [NO_MATCH_TIER]: 0 };

  let totalOccurrences = 0;
  let templateOccurrences = 0;
  let programOccurrences = 0;
  let movementNames = 0;
  let movementOccurrences = 0;
  let nonMovementNames = 0;
  let nonMovementOccurrences = 0;

  groups.forEach((group) => {
    if (excluded.has(group.key)) {
      excludedNames += 1;
      excludedOccurrences += group.occurrences;
      return;
    }

    // The label a human sees: the spelling used most often, then the shortest,
    // then alphabetical — deterministic across runs.
    let displayName = group.key;
    let bestCount = -1;
    group.displayCounts.forEach((count, raw) => {
      if (!raw) return;
      if (count > bestCount
        || (count === bestCount && (raw.length < displayName.length
          || (raw.length === displayName.length && raw.localeCompare(displayName) < 0)))) {
        bestCount = count;
        displayName = raw;
      }
    });

    const classification = classifyExerciseName(displayName);
    const isMovement = classification === MOVEMENT_CLASSIFICATION;

    // Deliberate: non-movements are NOT matched at all. A pitch-sequence
    // prescription must never be handed a video, so no candidate is even
    // offered for a reviewer to accidentally click.
    const matches = isMovement ? matchAgainstIndex(group.key, index, limit, minScore) : [];
    const best = matches[0] || null;
    const tier = isMovement ? (best ? best.tier : NO_MATCH_TIER) : NO_MATCH_TIER;

    totalOccurrences += group.occurrences;
    templateOccurrences += group.templateCount;
    programOccurrences += group.programCount;
    byClassification[classification] = (byClassification[classification] || 0) + 1;
    occurrencesByClassification[classification] =
      (occurrencesByClassification[classification] || 0) + group.occurrences;

    if (isMovement) {
      movementNames += 1;
      movementOccurrences += group.occurrences;
      byTier[tier] += 1;
      occurrencesByTier[tier] += group.occurrences;
    } else {
      nonMovementNames += 1;
      nonMovementOccurrences += group.occurrences;
    }

    rows.push({
      key: group.key,
      normalized: group.normalized,
      displayName,
      occurrences: group.occurrences,
      templateCount: group.templateCount,
      programCount: group.programCount,
      folders: Array.from(group.folders).sort(),
      classification,
      isMovement,
      matches,
      bestMatch: best,
      bestScore: best ? best.score : 0,
      tier,
      refs: group.refs,
    });
  });

  // Most-repeated gaps first: clearing those buys the most coverage per click.
  rows.sort((a, b) => (b.occurrences - a.occurrences)
    || (b.bestScore - a.bestScore)
    || a.displayName.localeCompare(b.displayName));

  const needsNewVideoNames = byTier.weak + byTier[NO_MATCH_TIER];
  const needsNewVideoOccurrences = occurrencesByTier.weak + occurrencesByTier[NO_MATCH_TIER];

  const summary = {
    totalOccurrences,
    templateOccurrences,
    programOccurrences,
    distinctNames: rows.length,
    librarySize: index.size,

    byClassification,
    occurrencesByClassification,

    // Tier counts cover MOVEMENT rows only — a pitch sequence is not a gap the
    // library could ever fill, so counting it as "no match" would inflate the
    // number of videos anyone needs to go and film.
    byTier,
    occurrencesByTier,

    movementNames,
    movementOccurrences,
    nonMovementNames,
    nonMovementOccurrences,

    // The three numbers that actually answer #170.
    coverableHighNames: byTier.high,
    coverableHighOccurrences: occurrencesByTier.high,
    needsReviewNames: byTier.review,
    needsReviewOccurrences: occurrencesByTier.review,
    needsNewVideoNames,
    needsNewVideoOccurrences,

    excludedNames,
    excludedOccurrences,
    unusableOccurrences: unusable,
  };

  return { rows, summary };
}
