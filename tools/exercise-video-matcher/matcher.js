// Normalization + scoring logic shared by match.js. Kept separate from the
// CLI/IO code so the matching rules can be unit-tested or reused on their
// own later.
const ABBREVIATIONS = require('./abbreviations');

const FILLER_WORDS = new Set([
  'the', 'a', 'and', 'with', 'how', 'to',
  'setup', 'cues', 'demo', 'tutorial', 'exercise',
]);

// Weights for combining the two signals into one confidence score. Token
// overlap is weighted higher than raw string distance because word-level
// agreement ("dumbbell", "bench") is a stronger signal of "same exercise"
// than character-level similarity — two exercise names can share almost no
// characters in the same order (e.g. token order differs) and still be the
// same movement. These are plain constants specifically so they're easy to
// retune once we see how well they do against real exercise names.
const TOKEN_WEIGHT = 0.6;
const STRING_WEIGHT = 0.4;

// A candidate below this combined score isn't "the right video, just not
// confident" — it's noise. Per the spec: never guess a video just to fill a
// row, so below this floor we report no match at all rather than the least-
// bad option.
const MIN_CANDIDATE_SCORE = 0.35;

// Confidence at or above this is auto-accepted (needs_review = false).
const REVIEW_THRESHOLD = 0.85;

// lowercase -> strip punctuation -> collapse whitespace -> tokenize ->
// drop filler words -> expand abbreviations (which may themselves expand
// to multiple words, e.g. "rdl" -> "romanian deadlift" -> two tokens).
function normalizeToTokens(text) {
  const lowered = String(text || '').toLowerCase();
  const lettersAndDigitsOnly = lowered.replace(/[^a-z0-9\s]/g, ' ');
  const rawTokens = lettersAndDigitsOnly.split(/\s+/).filter(Boolean);
  const withoutFillers = rawTokens.filter((t) => !FILLER_WORDS.has(t));

  const expanded = [];
  for (const token of withoutFillers) {
    const expansion = ABBREVIATIONS[token];
    if (expansion) {
      expanded.push(...expansion.split(' '));
    } else {
      expanded.push(token);
    }
  }
  return expanded;
}

function jaccard(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

function stringSimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// videos: array of { title, url, normTokens, normStr } — pre-normalized once
// per run so matching N exercises against 481 videos doesn't re-normalize
// the same video title N times.
function prepareVideos(videos) {
  return videos.map((v) => {
    const normTokens = normalizeToTokens(v.title);
    return { ...v, normTokens, normStr: normTokens.join(' ') };
  });
}

function matchExercise(exerciseName, preparedVideos) {
  const exTokens = normalizeToTokens(exerciseName);
  const exStr = exTokens.join(' ');

  if (exStr.length > 0) {
    const exact = preparedVideos.find((v) => v.normStr === exStr);
    if (exact) {
      return {
        video: exact,
        confidence: 1.0,
        needsReview: false,
      };
    }
  }

  let best = null;
  for (const v of preparedVideos) {
    const tokenScore = jaccard(exTokens, v.normTokens);
    const stringScore = stringSimilarity(exStr, v.normStr);
    const combined = TOKEN_WEIGHT * tokenScore + STRING_WEIGHT * stringScore;
    if (!best || combined > best.confidence) {
      best = { video: v, confidence: combined };
    }
  }

  if (!best || best.confidence < MIN_CANDIDATE_SCORE) {
    return { video: null, confidence: 0, needsReview: true };
  }

  return {
    video: best.video,
    confidence: best.confidence,
    needsReview: best.confidence < REVIEW_THRESHOLD,
  };
}

module.exports = {
  normalizeToTokens,
  jaccard,
  levenshtein,
  stringSimilarity,
  prepareVideos,
  matchExercise,
  MIN_CANDIDATE_SCORE,
  REVIEW_THRESHOLD,
  TOKEN_WEIGHT,
  STRING_WEIGHT,
};
