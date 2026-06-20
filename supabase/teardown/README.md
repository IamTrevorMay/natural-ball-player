# V2 Usage Experiment — Teardown Checklist

End of the 2-week window. Do these in order.

## 1. Disable tracking in production

Vercel → Project `nbp-portal` → Settings → Environment Variables.

Either flip `REACT_APP_USAGE_TRACKING` to `0` OR delete the variable. Redeploy
the latest production build (CRA inlines env vars at build time).

Confirm: open prod, DevTools → Application → Session Storage. After a fresh
sign-in there should NOT be a new row appearing in `usage_events` if you watch
the Supabase SQL editor.

## 2. (Optional) Snapshot the data

If you want to keep the raw events for later analysis, dump to CSV first via
the Supabase SQL editor:

```sql
\copy (SELECT * FROM public.usage_events) TO '/tmp/usage_events.csv' WITH CSV HEADER;
```

…or use the Supabase dashboard's "Export to CSV" on the table view.

## 3. Drop the DB surface

Run `usage_experiment_teardown.sql` (in this folder) via the SQL editor. It
drops the policies, the indexes, and the table.

```sql
\i supabase/teardown/usage_experiment_teardown.sql
```

## 4. Rip the client-side instrumentation

Code touchpoints to revert. Easiest path is a single PR that:

1. Deletes `src/usage.js`
2. Deletes `src/UsageDashboard.js`
3. Removes the `UsageDashboard` import + the `currentView === 'usage'` branch + the sidebar button in `src/App.js`
4. Removes the `import { initUsage, setUsageContext, trackView, trackViewExit } from './usage';` line + the three init/context/view useEffects in `src/App.js`
5. Removes every `import { useModalTracking, trackAction } from './usage';` (or any subset)
6. Removes every `useModalTracking('…');` body call
7. Removes every `trackAction('…');` body call
8. Removes the `import { trackError } from './usage';` + the `trackError(…)` line inside `src/errorMessage.js`

Quick greps to find each:

```bash
grep -rn "from './usage'" src/
grep -rn "useModalTracking" src/
grep -rn "trackAction" src/
grep -rn "trackError" src/
grep -rn "initUsage\|setUsageContext\|trackView" src/
```

After the sweep, `npx react-scripts build` should still pass with no new
warnings.

## 5. Delete this folder

Once everything above is reverted, `git rm -rf supabase/teardown` and commit.
The 14-day experiment leaves no permanent footprint.
