// #416 — graduation-year helpers shared by the recruiting board (Profile.js)
// and the athlete editor (ManageAthletes.js).
//
// player_profiles.grad_year is the HIGH-SCHOOL graduation year. It never
// changes, and the class label ("11th Grade", "College Sophomore") is derived
// from it against the current school year, so the recruiting board rolls
// over on its own every August with nobody editing 500 profiles.

export const GRAD_YEAR_MIN = 2015;
export const GRAD_YEAR_MAX = 2040;

export const GRAD_YEAR_OPTIONS = Array.from(
  { length: GRAD_YEAR_MAX - GRAD_YEAR_MIN + 1 },
  (_, i) => GRAD_YEAR_MIN + i,
);

// The calendar year the CURRENT school year ends in. The year rolls over on
// 1 August: on 2026-09-18 this is 2027 (the class of 2027 are seniors).
export function schoolYearEnd(today = new Date()) {
  const y = today.getFullYear();
  return today.getMonth() >= 7 ? y + 1 : y;
}

// The eight classes Cordell asked for, in board order. `offset` is
// grad_year - schoolYearEnd(): seniors are 0, juniors 1, a college freshman
// graduated HS last year so -1, and so on.
export const RECRUITING_CLASSES = [
  { offset: 0,  label: '12th Grade' },
  { offset: 1,  label: '11th Grade' },
  { offset: 2,  label: '10th Grade' },
  { offset: 3,  label: '9th Grade' },
  { offset: -1, label: 'College Freshman' },
  { offset: -2, label: 'College Sophomore' },
  { offset: -3, label: 'College Junior' },
  { offset: -4, label: 'College Senior' },
];

export function classForGradYear(gradYear, today = new Date()) {
  if (!gradYear) return null;
  const offset = gradYear - schoolYearEnd(today);
  const cls = RECRUITING_CLASSES.find(c => c.offset === offset);
  if (cls) return cls;
  if (offset > 3) return { offset, label: 'Middle School & Younger' };
  return { offset, label: 'Post-College' };
}

export function classLabelForGradYear(gradYear, today = new Date()) {
  return classForGradYear(gradYear, today)?.label || null;
}
