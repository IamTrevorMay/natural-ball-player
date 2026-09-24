// Position text → depth-chart codes (#427).
//
// `player_profiles.position` is free text and athletes list several spots at
// once: "RHP/INF/OF", "RHP, INF", "SS / 2nd", "C / Corner INF / RHP",
// "OF RHP", "3rd, 1st". The old depth chart matched the WHOLE string against a
// list of single positions, so every multi-position athlete silently vanished
// from the field — that's why 18u looked right (mostly single "RHP" rows) and
// 12u looked empty.
//
// parsePositions() splits the string and returns every field code the athlete
// covers, in order, de-duplicated. Group labels fan out (INF → 1B/2B/SS/3B,
// OF → LF/CF/RF, MIF → 2B/SS, Corner INF → 1B/3B, Utility/All → every spot)
// per Cordell's call on #427. Unknown words ("Cricket", "Coach", "N/A",
// "Submarine") are ignored rather than failing the whole string.

export const FIELD_POSITION_CODES = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];

const INFIELD = ['1B', '2B', 'SS', '3B'];
const OUTFIELD = ['LF', 'CF', 'RF'];
const MIDDLE_INFIELD = ['2B', 'SS'];
const CORNER_INFIELD = ['1B', '3B'];
const CORNER_OUTFIELD = ['LF', 'RF'];

// Keys are upper-case with internal whitespace/hyphens collapsed to one space.
const TOKEN_MAP = {
  // Pitchers
  P: ['P'], RHP: ['P'], LHP: ['P'], SP: ['P'], RP: ['P'], CL: ['P'],
  PITCHER: ['P'], PITCHERS: ['P'], PITCHING: ['P'],
  'SUB RHP': ['P'], 'RHP SUBMARINE': ['P'], SUBMARINE: ['P'],
  // Catcher
  C: ['C'], CATCHER: ['C'], CATCHERS: ['C'],
  // Bases
  '1B': ['1B'], '1ST': ['1B'], '1ST BASE': ['1B'], '1STBASE': ['1B'], 'FIRST BASE': ['1B'], FIRSTBASE: ['1B'], 'FIRST BASEMAN': ['1B'], FIRST: ['1B'],
  '2B': ['2B'], '2ND': ['2B'], '2ND BASE': ['2B'], '2NDBASE': ['2B'], 'SECOND BASE': ['2B'], SECONDBASE: ['2B'], 'SECOND BASEMAN': ['2B'], SECOND: ['2B'],
  '3B': ['3B'], '3RD': ['3B'], '3RD BASE': ['3B'], '3RDBASE': ['3B'], 'THIRD BASE': ['3B'], THIRDBASE: ['3B'], 'THIRD BASEMAN': ['3B'], THIRD: ['3B'],
  SS: ['SS'], SHORTSTOP: ['SS'], 'SHORT STOP': ['SS'], SHORT: ['SS'],
  // Outfield spots
  LF: ['LF'], 'LEFT FIELD': ['LF'], LEFTFIELD: ['LF'], 'LEFT FIELDER': ['LF'], LEFTFIELDER: ['LF'], LEFT: ['LF'],
  CF: ['CF'], 'CENTER FIELD': ['CF'], CENTERFIELD: ['CF'], 'CENTER FIELDER': ['CF'], CENTERFIELDER: ['CF'], CENTER: ['CF'],
  RF: ['RF'], 'RIGHT FIELD': ['RF'], RIGHTFIELD: ['RF'], 'RIGHT FIELDER': ['RF'], RIGHTFIELDER: ['RF'], RIGHT: ['RF'],
  // Groups
  INF: INFIELD, IF: INFIELD, INFIELD: INFIELD, INFIELDER: INFIELD, INFIELDERS: INFIELD,
  OF: OUTFIELD, OUTFIELD: OUTFIELD, OUTFIELDER: OUTFIELD, OUTFIELDERS: OUTFIELD,
  MIF: MIDDLE_INFIELD, MINF: MIDDLE_INFIELD, MI: MIDDLE_INFIELD, 'M INF': MIDDLE_INFIELD,
  'MIDDLE INF': MIDDLE_INFIELD, 'MIDDLE INFIELD': MIDDLE_INFIELD, 'MIDDLE INFIELDER': MIDDLE_INFIELD,
  CIF: CORNER_INFIELD, CINF: CORNER_INFIELD, 'C INF': CORNER_INFIELD,
  'CORNER INF': CORNER_INFIELD, 'CORNER INFIELD': CORNER_INFIELD, 'CORNER INFIELDER': CORNER_INFIELD, CORNER: CORNER_INFIELD,
  'CORNER OF': CORNER_OUTFIELD, 'CORNER OUTFIELD': CORNER_OUTFIELD, 'CORNER OUTFIELDER': CORNER_OUTFIELD,
  UTL: FIELD_POSITION_CODES, UT: FIELD_POSITION_CODES, UTIL: FIELD_POSITION_CODES,
  UTILITY: FIELD_POSITION_CODES, UTIITY: FIELD_POSITION_CODES, ALL: FIELD_POSITION_CODES,
};

const normalizeToken = (s) => s.replace(/[-\s]+/g, ' ').trim();

const lookup = (token) => TOKEN_MAP[normalizeToken(token)] || null;

/**
 * @param {string|string[]|null|undefined} raw — a free-text position string or
 *   an array of them (prospects store `positions[]`).
 * @returns {string[]} field codes from FIELD_POSITION_CODES, de-duplicated.
 */
export function parsePositions(raw) {
  const inputs = Array.isArray(raw) ? raw : [raw];
  const out = [];
  const push = (codes) => codes.forEach(c => { if (!out.includes(c)) out.push(c); });

  for (const input of inputs) {
    if (!input || typeof input !== 'string') continue;
    const cleaned = input
      .toUpperCase()
      .replace(/\([^)]*\)/g, ' ')   // "(Utility)" annotations
      .replace(/\./g, ',');         // "1st. 3rd" typo for a comma

    for (const chunk of cleaned.split(/[/,;&+|]+/)) {
      const piece = normalizeToken(chunk);
      if (!piece) continue;
      const whole = lookup(piece);
      if (whole) { push(whole); continue; }
      // "OF RHP", "RHP SUBMARINE", "LHP 1ST BASE": match word by word,
      // trying two-word phrases first so "CORNER INF" still lands.
      const words = piece.split(' ');
      for (let i = 0; i < words.length; i++) {
        const pair = i + 1 < words.length ? lookup(`${words[i]} ${words[i + 1]}`) : null;
        if (pair) { push(pair); i += 1; continue; }
        const single = lookup(words[i]);
        if (single) push(single);
      }
    }
  }
  return out;
}
