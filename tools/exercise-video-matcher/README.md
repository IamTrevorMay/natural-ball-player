# Exercise Video Matcher (#170)

Standalone tool — not part of the app, doesn't touch the database, doesn't
write to any table. It reads two CSVs and writes a third one for a human to
review. There's no "apply" step; nothing here changes `training_exercises`
or anything else in the product.

## Why

Exercises live in `training_exercises`, one row per day of one program, so
the same exercise name repeats across many rows with no central library.
There's a public YouTube playlist of 481 exercise demo videos. This tool
proposes, for each distinct exercise name, which video (if any) is probably
the right demo — so a human can review the proposals instead of manually
scrubbing through 481 videos per exercise.

## Files

| File | Purpose |
|---|---|
| `fetch-playlist.js` | Step 1 — pulls every video's title + URL from the playlist into `videos.csv` |
| `match.js` | Step 2 — the CLI that reads `exercises.csv` + `videos.csv` and writes `proposed-matches.csv` |
| `matcher.js` | The actual normalization + scoring logic, separated from the CLI/IO code |
| `abbreviations.js` | The shorthand → full-word expansion map — the thing you'll extend as real data turns up new abbreviations |
| `csv.js` | Tiny hand-rolled CSV reader/writer (proper quoting — video titles routinely contain commas and dashes) |
| `sample-exercises.csv` | 15 fake exercise rows for testing before the real list exists |
| `videos.csv` | Output of step 1 (committed here after the real run — see below) |
| `proposed-matches.csv` | Output of step 2 |

No `npm install` is required — everything is built on Node's standard
library. The only external dependency is the `yt-dlp` binary, which
`fetch-playlist.js` will try to install itself (`pip3` first, then `brew`)
if it isn't already on your PATH.

## Running it

```bash
# Step 1 — only needs to be re-run if the playlist changes
node fetch-playlist.js

# Step 2 — try it on the fake data first
node match.js sample-exercises.csv videos.csv sample-proposed-matches.csv

# Step 2 — once the real exercise list exists
node match.js exercises.csv videos.csv proposed-matches.csv
```

`match.js` prints a summary (total / auto-matched / needs review /
unmatched) after writing the CSV.

## Getting the real `exercises.csv`

This tool doesn't query the database — that's out of scope here on
purpose. When it's time to run this for real, someone with DB access should
export the distinct exercise names, e.g. roughly:

```sql
SELECT DISTINCT name, category FROM training_exercises ORDER BY name;
```

...and save the result as `exercises.csv` with `name,category` columns,
then run step 2 against it.

## The matching algorithm

For each exercise name and each video title:

1. **Normalize**: lowercase, strip punctuation, collapse whitespace,
   tokenize on whitespace, drop filler words (`the`, `a`, `and`, `with`,
   `how`, `to`, `setup`, `cues`, `demo`, `tutorial`, `exercise`).
2. **Expand abbreviations** (`abbreviations.js`) token-by-token — e.g. `db`
   → `dumbbell`, `rdl` → `romanian deadlift` (some expansions are more than
   one word; that's fine, they just become multiple tokens).
3. **Exact match**: if the exercise's normalized+expanded tokens exactly
   equal a video's, confidence is `1.0` and it's never flagged for review.
4. **Otherwise, fuzzy match** against every video and keep the best:
   - *Token overlap* — Jaccard similarity of the two token sets (how many
     words they share, regardless of order).
   - *String distance* — Levenshtein edit distance on the joined,
     normalized strings, turned into a 0–1 similarity.
   - Combined score = `0.6 × token overlap + 0.4 × string distance`. Token
     overlap is weighted higher because two names for the same exercise can
     have their words in a different order or with extra words ("Dumbbell
     Bench Press — Setup and Cues" vs. "DB Bench") and still clearly be the
     same movement, whereas raw character similarity is a weaker signal on
     its own. These weights are just constants at the top of `matcher.js` —
     retune them once we see how well they do against real names.
5. **Thresholds**:
   - `confidence >= 0.85` → `needs_review = false` (auto-accepted)
   - `confidence < 0.85` → `needs_review = TRUE`
   - `confidence < 0.35` → treated as **no reasonable candidate at all**:
     the row gets a blank video and `confidence = 0`, rather than reporting
     the least-bad guess. This `0.35` floor isn't something the issue
     specified explicitly — it's my read of "never guess a video just to
     fill a row," made a named, adjustable constant
     (`MIN_CANDIDATE_SCORE` in `matcher.js`) rather than buried logic, since
     it's exactly the kind of number that should move once real data shows
     whether it's too strict or too loose.

## Extending the abbreviation map

Edit `abbreviations.js`. Keys must be lowercase single words (no spaces);
values can be one or more words. It's applied after filler-word removal, so
you don't need to worry about `the`/`a`/etc. colliding with an abbreviation
key.
