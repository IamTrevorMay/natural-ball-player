# NBP Portal — Planning

## Recently Completed

### Players can add games to schedule (2026)
- #177 — CHECK constraint + defensive nulls

### Program colors aligned (2026)
- #179 — Program colors aligned across all views

### Intern role option restored (2026)
- #182 — Intern role option restored in EditUserModal

### Status badge on user cards (2026)
- #183 — Status badge on user cards in admin settings

### Practice Stats tab (2026)
- #186 — Practice Stats tab on player profiles

### Game Changer tab (2026)
- #187 — Game Changer tab on team pages

### CORS fix (2026)
- #188 — CORS fix for legacy domain

### Cascade communication_logs (2026)
- #184 — Cascade communication_logs on user delete

### Player age in profile (2026)
- #181 — Player age shown in profile header

### Calendar improvements (2026)
- #176 — Show all events per day in month view

### Program library colors (2026)
- #175 — Color-code program library folders by category

### School/coach directory (2026)
- #162 — School/coach contact directory on Recruitment tab

### Player-added games (2026)
- #169 — Players can add own games to schedule

### Mobile layout (2026)
- #173 — Responsive mobile layout for ProgramViewerModal

## Planned

### Near-term
- **#196** — Team roster sort order (coaches on top)
- **#180** — Dom's profile fix (deploy local changes: `ensureProfile` auto-creation + bats/throws display)
- **#190** — Repeating events for games

### Mid-term
- **#185** — Program data backfill script (one-time migration to copy template data into training_exercises)
- **#178** — School directory data import (waiting on CSV from Matteo)
- **#142** — Square payment integration (unlocks #189 facility fines)
- **#48** — HitTrax API integration (needs credentials)
- **#44** — Trackman API integration (needs credentials)

### Long-term
- **#174** — AI-powered athlete programming (auto-generate training plans from assessments + Whoop data)
- **#170** — AI agent for exercise video discovery (auto-populate missing YouTube links)

## Known Issues

| # | Title | Priority | Status | What's Needed |
|---|-------|----------|--------|---------------|
| 196 | Team members formatted incorrectly | High | Not started | Coaches should sort to the top of team roster lists, players below. Fix sort order in `MyTeam.js` roster rendering |
| 178 | Recruitment tab doesn't auto-populate | Medium | Blocked | School directory tables are live but empty. Need Matteo's CSV/spreadsheet of college coach contacts to import |
| 185 | Players programs not showing data | Medium | Partial fix deployed | "Sets/reps not set" placeholder shows on mobile. Root cause: `training_exercises` rows missing sets/reps/load data. Either backfill manually in Coach Tools or write a one-time script to copy from `workout_templates` JSONB |
| 189 | Facility fine document + payment | Medium | Partial | Doc can be uploaded via existing Documents tab. Payment/fining blocked on #142 (Square integration) |
| 190 | Repeating games/events button | Medium | Not started | Add recurring event support for games in the schedule. PlayerAddGameModal and coach event creation need a "repeat" option |
| 180 | Dom's profile not showing correctly | High | Fix ready locally | `ensureProfile` auto-creation + bats/throws display fix in local branch, not yet deployed |
| 174 | AI Programming | Low | Research phase | AI agent that reads assessment results + Whoop data and auto-generates training programs from the existing program vault. Large feature — needs architecture design |
| 170 | AI Agent for video hyperlinks | Low | Research phase | AI agent to find YouTube videos for exercises missing hyperlinks in workout templates and auto-populate the link field |
| 142 | Square & Lesson / Monthly Packages | Medium | Not started | Connect Square payment platform. Build packages/lessons/rentals/subscriptions catalog with purchase flow. Blocks #189 (facility fines) |
| 48 | Hit-Trax API | Medium | Not started | Connect HitTrax API to pull session data into the Hittrax profile tab. Need API credentials and documentation |
| 44 | Trackman Integration | Medium | Not started | Connect Trackman API to pull pitch/hit data into the Trackman profile tab. Need API access and credentials |

## Architecture Notes

- Supabase Auth Redirect URLs — Set Site URL to `https://nbp-portal.vercel.app`, add `https://nbp-portal.vercel.app/**` to Redirect URLs allowlist
- Leaked password protection — Enable in Supabase Dashboard under Authentication > Policies

## Open Risks

- School directory data blocked on external CSV delivery from Matteo
- Square integration (#142) blocks facility fines (#189) — external dependency on payment platform setup
- AI features (#174, #170) are large-scope with no architecture design yet
- Multiple API integrations (#48, #44) blocked on third-party credentials
