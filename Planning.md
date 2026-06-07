# NBP Portal — Planning

## Open Issues

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

## Roadmap

### Near-term (ready to ship or small fixes)
- **#196** — Team roster sort order (coaches on top)
- **#180** — Dom's profile fix (deploy local changes)
- **#190** — Repeating events for games

### Mid-term (moderate features, some dependencies)
- **#185** — Program data backfill script (one-time migration to copy template data into training_exercises)
- **#178** — School directory data import (waiting on CSV from Matteo)
- **#142** — Square payment integration (unlocks #189 facility fines)
- **#48** — HitTrax API integration (needs credentials)
- **#44** — Trackman API integration (needs credentials)

### Long-term (large features, architecture needed)
- **#174** — AI-powered athlete programming (auto-generate training plans from assessments + Whoop data)
- **#170** — AI agent for exercise video discovery (auto-populate missing YouTube links)

### Completed recently
- #177 — Players can add games to schedule (CHECK constraint + defensive nulls)
- #179 — Program colors aligned across all views
- #182 — Intern role option restored in EditUserModal
- #183 — Status badge on user cards in admin settings
- #186 — Practice Stats tab on player profiles
- #187 — Game Changer tab on team pages
- #188 — CORS fix for legacy domain
- #184 — Cascade communication_logs on user delete
- #181 — Player age shown in profile header
- #176 — Show all events per day in month view
- #175 — Color-code program library folders by category
- #162 — School/coach contact directory on Recruitment tab
- #169 — Players can add own games to schedule
- #173 — Responsive mobile layout for ProgramViewerModal

### Pending manual configuration
1. **Supabase Auth Redirect URLs** — Set Site URL to `https://nbp-portal.vercel.app`, add `https://nbp-portal.vercel.app/**` to Redirect URLs allowlist
2. **Leaked password protection** — Enable in Supabase Dashboard under Authentication > Policies
