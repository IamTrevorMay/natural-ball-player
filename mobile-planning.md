# NBP Portal — Mobile Planning

Tracking doc for mobile version of the app. Living doc — update as decisions land.

## Goal

Native or native-feeling mobile experience for players and coaches. Primary user is a player checking schedule, viewing programs, signing up for facility events, and reviewing profile data (Whoop, Hit-Trax, assessments) on a phone.

## Current State

- Web app is CRA + Tailwind + Supabase, deployed on Vercel at `nbp-portal.vercel.app`
- Some responsive work already shipped (#173 ProgramViewerModal, partial Tailwind `sm:`/`md:` use in `App.js` and modals)
- No native shell, no PWA manifest configured, no push notification infra
- Auth is Supabase email/password; works on mobile browsers today

## Strategy Options

| Option | Effort | Pros | Cons |
|---|---|---|---|
| **A. PWA (installable web)** | Low (1–2 wk) | Reuses entire codebase. Ship via Add-to-Home-Screen. No store review. Push via Web Push (iOS 16.4+) | No App Store discovery. Limited deep OS integration. Some iOS quirks (file uploads, background sync) |
| **B. Capacitor wrap** | Medium (3–5 wk) | Reuses entire React codebase inside native iOS/Android shell. Real App Store / Play Store listings. Native push, camera, biometrics via plugins | Need Apple Dev account ($99/yr) + Play Console ($25 one-time). App review cycles. App icon / splash / store assets |
| **C. Expo / React Native rewrite** | High (3–6 mo) | True native feel, best performance, fully native nav | Codebase fork. Two stacks to maintain. Re-implement every screen. Loses Tailwind |

**Recommendation:** Start with **A (PWA)** as a 1–2 week sprint to validate mobile flows and field early feedback. Layer **B (Capacitor)** on top once PWA is stable — Capacitor wraps the same build, so the work compounds. Avoid C unless we hit a wall the wrap can't clear.

## Open Decisions

1. **PWA first vs Capacitor first?** Recommendation above is PWA first, but if App Store presence is a hard requirement for marketing, flip the order.
2. **Push notifications scope.** Which events page the user? (DMs, event sign-ups, schedule changes, training assignments, announcements.) Need separate per-channel preferences.
3. **Offline support.** Read-only cache of schedule + program for offline gym sessions, or fully online?
4. **Deep-linking.** Required if push notifications open specific views (`/profile/<id>`, `/schedule/event/<id>`).
5. **Player-only build vs unified.** Ship a player-focused mobile shell, or full-feature app with role-gated views like the web?

## Phase Plan (Tentative)

### Phase 0 — Audit (this week)
- Identify all screens with broken mobile layout
- Inventory dependencies that break in WebView (e.g. `react-pdf`, drag-and-drop, file pickers)
- Decide PWA vs Capacitor order

### Phase 1 — PWA foundation
- Add `manifest.json`, app icons, splash
- Service worker for asset caching
- Fix top-N mobile layout breaks
- Web Push setup (VAPID keys, subscribe flow, edge function for sending)
- Add-to-Home-Screen prompt

### Phase 2 — Capacitor wrap (if greenlit)
- `npx cap init`, iOS + Android projects
- Native push via FCM + APNs (replace or augment Web Push)
- Camera / file plugin for avatar + document uploads
- App Store + Play Store listings, screenshots, privacy policy URLs
- Submit to TestFlight + Internal Testing

### Phase 3 — Native polish
- Biometric login (Face ID / fingerprint)
- Native share sheet
- Background sync for offline queue
- App Store launch

## Critical User Flows (Mobile-First Priority)

1. Schedule view — today's events, sign up / RSVP
2. Program viewer — daily workout, log sets
3. Profile dashboard — stats, Whoop, Hit-Trax
4. Messaging — Work Portal DMs + channels
5. Announcements + notifications
6. Login / forgot password

## Known Constraints

- iOS Web Push requires iOS 16.4+ AND the app installed via Add-to-Home-Screen
- Supabase Auth deep-link redirect must include mobile schemes once Capacitor is added (update Site URL allowlist)
- Vercel deploys the web build; Capacitor builds are CI'd separately (likely GitHub Actions → EAS or Xcode Cloud)
- Tailwind safelist for dynamic classes used in PWA install prompt
- Some current modals (e.g. `CreateSlotPanel`) assume mouse hover / drag — need touch equivalents

## Out of Scope (For Now)

- Tablet-specific layouts (handled by responsive web)
- Apple Watch / wearable companion
- Smart TV / Roku
- Marketing site

## Open Risks

- App Store review may flag "wrapped web view" apps; need to demonstrate native integration (push, camera) to pass
- iOS Add-to-Home-Screen UX is poor — users don't know to do it; lowers PWA install rate
- Supabase Auth + Apple Sign-In is required for iOS submission once we wrap; need to wire it up

## Related Issues

- #173 — Responsive mobile layout for ProgramViewerModal (shipped)
- #185 — Players programs not showing data on mobile (partial fix deployed)
- Any new mobile-specific issues should be tagged `mobile` in GitHub

## Decisions Log

_(Append-only. Date + decision + rationale.)_

- 2026-06-18 — Doc created. Initial recommendation: PWA first, Capacitor second, no React Native rewrite.
- 2026-06-18 — **V1 scope locked.** Player-only mobile shell with 3 tabs: Dashboard, Schedule, Program (Workouts + Meals subviews).
- 2026-06-18 — **Delivery:** Responsive route inside existing CRA app. No PWA / Capacitor in V1. Defer install/native shell decisions until screens are validated.
- 2026-06-18 — **Dashboard "plan for today" sources:** all four — `schedule_events` (player's teams), `facility_events` (via `event_signups`), today's `training_day` from assigned `training_programs`, today's meal from assigned `meal_plans`.
- 2026-06-18 — **Workout completion model:** new `player_workout_logs` table. Coach's prescribed sets/reps remain immutable in `training_exercises`. Players log actuals (reps, load, notes) per set per exercise per date. Enables compliance + progress charts later.
- 2026-06-18 — **Meals tab V1:** read-only view of assigned meal plans. Completion logging / actuals deferred to V1.1.

## V1 Build Order

1. Lock decisions in this doc ← done
2. Scaffold mobile shell + bottom-nav routing under `/m`
3. Dashboard page (today's plan)
4. Schedule tab (next 7 days)
5. Program tab — Workouts subview + `player_workout_logs` migration
6. Program tab — Meals subview (read-only)

**Pacing:** one page at a time per Trevor. Each page reviewed before the next is started.
