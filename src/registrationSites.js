// #447: the tournament platforms an athlete must be registered on. Shared by
// the profile Records → Registration cards (RegistrationTab) and the staff
// roster in Coach Tools → Registrations. Fixed list on purpose — the point is
// that every athlete has exactly these two, and a missing one is visible.
export const REGISTRATION_SITES = [
  {
    value: 'perfect_game',
    label: 'Perfect Game',
    short: 'PG',
    color: 'bg-blue-100 text-blue-800',
    home: 'https://www.perfectgame.org',
    hint: 'Paste the link to your Perfect Game player profile and attach a screenshot or PDF of the registration.',
  },
  {
    value: 'top_tier',
    label: 'Top Tier',
    short: 'Top Tier',
    color: 'bg-purple-100 text-purple-800',
    home: null,
    hint: 'Paste the link to your Top Tier player page and attach a screenshot or PDF of the registration.',
  },
];

export const registrationSite = (value) => REGISTRATION_SITES.find((s) => s.value === value) || null;

export const REGISTRATIONS_BUCKET = 'registrations';

// A row "counts" as proof when it has either a link or a file — the same
// rule the player_registrations_has_content CHECK enforces.
export const hasRegistrationProof = (row) => !!(row && (row.profile_url || row.file_url));
