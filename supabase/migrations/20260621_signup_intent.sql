-- #200: capture an athlete's signup intent (Naturals team / training only / both)
-- so the public registration form can record what they're after and coaches can
-- place "team"/"both" signups on the right Naturals team.
alter table player_profiles
  add column if not exists signup_intent text
  check (signup_intent in ('team', 'training', 'both'));

comment on column player_profiles.signup_intent is
  'Self-signup intent (#200): team = wants a Naturals team, training = training only, both = both. Set at registration; coaches use it to place team/both athletes.';
