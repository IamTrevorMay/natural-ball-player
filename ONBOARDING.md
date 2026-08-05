# Developer Onboarding — NBP Portal

Everything a new developer needs to get productive on this codebase.

> **This repo is public.** Never commit secrets, service-role keys, FTP credentials, or API tokens. The only key checked in is the Supabase **anon** key (`src/supabaseClient.js`), which is public by design and protected by Row Level Security.

---

## 1. Accounts & access

You'll be invited to these. Ping Trevor if any invite is missing.

| System | What it's for | Role you need |
|---|---|---|
| **GitHub** — `IamTrevorMay/natural-ball-player` | Source of truth. Push to `main` triggers deploy. | Admin (or Write) |
| **Vercel** — team `trevor-mays-projects`, project `nbp-portal` | Hosting, build logs, env vars, cron | Member |
| **Supabase** — project `cjilkqzifyhssbsiqgfu` (org plan: Pro) | Postgres, Auth, Storage, Edge Functions | Owner or Developer |
| **Square** | Store, checkout, subscriptions, public booking payments | Dashboard access |
| **Trackman FTP** | Nightly pitch-data sync | Credentials only |
| **Whoop** | Integration in progress (issue #224) | Dev app access |

Plus a **portal account** — see §8. GitHub/Vercel/Supabase access does *not* give you access inside the app.

---

## 2. Local setup

Requires Node 22+ (Vercel builds on Node 24).

```bash
git clone https://github.com/IamTrevorMay/natural-ball-player.git
cd natural-ball-player
npm install
npm start          # http://localhost:3000
```

That's it — **no `.env` file needed**. The Supabase URL and anon key are hardcoded in `src/supabaseClient.js`, so a clean clone talks to the live project immediately.

Optional local env vars (`.env.local`, gitignored):
- `REACT_APP_SUPABASE_URL` — override the Supabase endpoint
- `REACT_APP_USAGE_TRACKING` — toggle usage tracking

**You are hitting production data on localhost.** There is no staging project. Be deliberate with writes; prefer a test user account over editing real athletes.

### Build

```bash
npm run build      # or: npx react-scripts build
```

The build **must pass before committing**. Note `CI=false` in the build script — warnings don't fail the build, but errors do.

### What doesn't run locally

`/api/trackman-sync` is a Vercel serverless function. `react-scripts start` doesn't serve `/api`, so the Trackman sync only works on a deployed URL.

---

## 3. Stack & layout

- **Frontend:** React 18 (Create React App) + Tailwind CSS + lucide-react icons
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions (Deno)
- **Serverless:** one Vercel Node function (`api/trackman-sync.js`)
- **Deploy:** Vercel, auto-deploys on push to `main`

```
src/                     78 files — one file per major feature/page
  App.js                 routing, auth gate, role dispatch
  supabaseClient.js      shared client (URL + anon key)
  scheduleUtils.js       recurrence expansion helpers
  Work*.js               Work Portal pages (staff-only shell)
  PublicPortal.js        shell for role='public' (booking customers)
  PublicBookingPage.js   no-login /book route
api/trackman-sync.js     Vercel cron + on-demand Trackman FTP import
supabase/
  functions/             17 Deno edge functions
  functions/_shared/     shared code (availability.ts mirrors scheduleUtils.js)
  migrations/            59 SQL migrations, YYYYMMDD_name.sql
tools/bullpen-sync/      standalone Python tool (iPad/bullpen capture)
CLAUDE.md                dense architecture notes — READ THIS
```

**Read `CLAUDE.md` before touching anything.** It documents every notable table, the drag-and-drop MIME contracts, the portal split, and per-feature gotchas. It's the highest-value doc in the repo.

`README.md` and `INSTALLATION_CHECKLIST.md` are stale scaffolding from the original build — ignore them.

---

## 4. Roles & portals

`users.role` is lowercase text: `admin`, `coach`, `player`, `public`.

Three shells render off role:
1. **Main portal** — players, coaches, admins. Schedule, profiles, teams, training, store.
2. **Work Portal** (`src/WorkPortal.js`) — staff-only HR/ops (hours, time off, pay docs, messaging, announcements). Same URL, toggled at the bottom of the sidebar. Coach + admin only.
3. **Public portal** (`src/PublicPortal.js`) — `role='public'`, outside customers who only book and pay for sessions.

Extra role modifiers:
- `users.secondary_role` — adds a "View as \<role\>" sidebar toggle; `effectiveRole` flows to children. **UI scoping only** — RLS still uses the real `role`.
- `users.is_intern` — partitions a coach into the Manage Interns list. Still `role='coach'` for permissions.

---

## 5. Supabase rules (read before writing SQL)

These three have bitten this project repeatedly. Follow them on every new table:

1. **Always grant.** `GRANT ALL ON <table> TO authenticated;` — Supabase does not auto-grant. Missing grants produce "permission denied" *even when RLS policies are correct*.
2. **Always use `public.get_user_role()`** in RLS policies — never an inline `EXISTS (SELECT FROM users ...)` subquery. The `users` table has RLS too, so subqueries cause recursion failures.
3. **Separate policies per operation.** SELECT / INSERT / UPDATE / DELETE each get their own. INSERT needs `WITH CHECK`, not `USING`. Avoid `FOR ALL`.

### Migrations

Add a file to `supabase/migrations/` named `YYYYMMDD_short_name.sql`. Apply it to the project (dashboard SQL editor or Supabase MCP `apply_migration`). Migrations are the record — if you change schema in the dashboard, back-fill a migration file so the next person can reproduce it.

### Edge functions

17 functions in `supabase/functions/`. Public-facing ones (`public-availability`, `public-book-checkout`, `square-webhook`) must be deployed with **`verify_jwt=false`** — guests have no JWT.

Anything a guest writes goes through a service_role edge function. `public_bookings` RLS is staff-only by design; never open it up to fix a client-side error.

`supabase/functions/_shared/availability.ts` is a Deno port of `src/scheduleUtils.js`. **Change one, change the other** — the calendar and the public booking page must expand recurrence identically.

---

## 6. Secrets inventory

Names only. Values live in the dashboards.

**Vercel** (Project → Settings → Environment Variables):
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `TRACKMAN_FTP_HOST`, `TRACKMAN_FTP_USER`, `TRACKMAN_FTP_PASSWORD`

**Supabase** (Dashboard → Edge Functions → Secrets): Square, Whoop, and email-sender credentials.

`api/trackman-sync.js` accepts either the `CRON_SECRET` bearer token *or* a staff Supabase JWT — that's how the admin "Sync now" button works alongside the nightly cron (`vercel.json`, `0 8 * * *`).

---

## 7. Workflow

- Build must pass (`npx react-scripts build`) before committing.
- Vercel auto-deploys `main` on push. There is no staging environment — a push to `main` is live.
- Trevor batches feature requests and gates the publish step. **Confirm before pushing to `main`.**
- PRs are welcome and get Vercel preview deploys automatically.

---

## 8. Getting a portal account

App permissions are independent of infrastructure access. To use the portal as staff:

1. Sign up through the app (or have an admin create the user).
2. An existing admin sets your `users.role` to `admin` — via Admin Settings, or `UPDATE users SET role='admin' WHERE email='...'`.

Without this you'll see the player view regardless of your Supabase access.

---

## 9. Where the work is

Open issues: <https://github.com/IamTrevorMay/natural-ball-player/issues>

Currently open:
- **#224** Whoop integration
- **#174** AI Programming
- **#170** AI agent to find hyperlinks for all videos
- **#48** Hit-Trax API

---

## 10. First-day checklist

- [ ] Accept GitHub, Vercel, and Supabase invites
- [ ] Clone, `npm install`, `npm start` — confirm the login page loads
- [ ] `npm run build` — confirm it passes clean
- [ ] Read `CLAUDE.md` end to end
- [ ] Get a portal account with `role='admin'`
- [ ] Click through all three shells: main portal, Work Portal, `/book`
- [ ] Skim `supabase/migrations/` newest-first to see recent schema direction
