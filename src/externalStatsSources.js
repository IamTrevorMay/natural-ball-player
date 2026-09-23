// #421: the external stat providers an athlete can attach. Shared by the
// athlete's profile Stats tab (ExternalStatsTab) and the staff roster in
// Coach Tools → Player Stats. 'other' carries a free-text source_label.
export const EXTERNAL_STAT_SOURCES = [
  { value: 'gamechanger', label: 'GameChanger', color: 'bg-orange-100 text-orange-800' },
  { value: 'perfect_game', label: 'Perfect Game', color: 'bg-blue-100 text-blue-800' },
  { value: 'maxpreps', label: 'MaxPreps', color: 'bg-red-100 text-red-800' },
  { value: 'pbr', label: 'PBR', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-700' },
];

export const sourceInfo = (value) =>
  EXTERNAL_STAT_SOURCES.find((s) => s.value === value) || EXTERNAL_STAT_SOURCES[EXTERNAL_STAT_SOURCES.length - 1];

// Display name for a row: the provider, or the athlete's own label for "Other".
export const sourceName = (row) =>
  row?.source === 'other' && row?.source_label ? row.source_label : sourceInfo(row?.source).label;

export const EXTERNAL_STATS_BUCKET = 'external-stats';

// Storage-safe file name: strip any path, keep word chars . and -, cap length.
export const safeFileName = (rawName) =>
  (rawName || 'file')
    .split(/[\\/]/).pop()
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'file';

// Only http(s) links are accepted; anything else is rejected before insert
// so a pasted "javascript:" or bare word never becomes a clickable href.
export const normalizeUrl = (raw) => {
  const v = (raw || '').trim();
  if (!v) return '';
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
};
