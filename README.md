# Semestral Deconflicter

A small, no-build web app for planning a semester schedule and figuring out
which combination of electives you can actually take without time conflicts.

**Live:** https://piimantou.github.io/Semestral-Deconflicter/ once GitHub
Pages is enabled (one-time step — see below). Deploys automatically on every
push via `.github/workflows/deploy-pages.yml`.

<details>
<summary>One-time setup: enable Pages</summary>

The deploy workflow can't enable Pages for a repo on its own (GitHub
restricts that to repo admins, not the Actions token). To turn it on:

1. Go to **Settings → Pages** in this repo.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

After that, every push to this branch (or `main`) redeploys automatically —
no further action needed.

</details>

## Running it locally

No build step, no dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve it statically, e.g. `python3 -m http.server 8000` and visit `http://localhost:8000`

All data is saved to `localStorage` in your browser, so it persists between visits
on the same device/browser. Use **Export JSON** / **Import JSON** to back up or
move your data elsewhere.

Click **Load example** to see a sample semester (core courses, two
overlapping electives buckets sharing a cross-listed course, and an optional
course) and get a feel for the tool.

## How it works

1. **Set up categories.** Click **Categories** to define the groups your
   courses fall into. A category is one of:
   - **Required** — every course assigned to it is mandatory (e.g. "Core").
   - **Bucket** — you're choosing a fixed number of courses out of the ones
     assigned to it (e.g. "AI Electives, take 2" or "Humanities, take 1").
     You can have as many bucket categories as you need — useful when your
     program requires "1 from group A and 2 from group B," not just a
     single flat elective pool.
   - **Optional** — never auto-selected by the search; you individually
     check off any of these you want included, e.g. a course you're taking
     purely out of interest that isn't required by anything.
2. **Add your courses**, assigning each to one or more categories — a
   cross-listed course (e.g. one that satisfies both an "AI Electives" and a
   "Systems Electives" requirement) can be checked into both, and taking it
   once counts toward both targets at the same time rather than needing to
   be picked twice.
3. If a required course has multiple sections, pick which one you're
   actually enrolled in from the dropdown on its card. Check any courses you
   want in the **Optional courses** panel regardless of bucket targets. A
   red banner appears if your required/optional-selected courses conflict
   with each other — fix that first, since no bucket choice can work around it.
4. In the **Bucket deconfliction** panel, each bucket category shows its
   target count and the courses under consideration (uncheck any you want to
   exclude without deleting). Click **Generate valid combinations** — the
   tool exhaustively searches every way to satisfy every bucket's target
   simultaneously (crediting cross-listed courses toward every bucket they
   belong to) without conflicting with your locked-in schedule or each other.
5. Results are ranked by your chosen criterion (fewest days on campus, least
   idle time between classes, earliest finish, or latest start). **Preview**
   shows a combination on the calendar without saving it; **Pin to calendar**
   keeps it as your selected schedule.
6. **Print schedule** prints just the calendar view.

The calendar is a compact time-grid in the style of When2Meet — sticky
headers, a fixed time gutter, fine hour/half-hour gridlines, color-coded
blocks per course — but spans your whole semester rather than one generic
week. Set **Semester starts** / **ends** above it and it lays out one column
per actual calendar day, grouped into week headers; a course meeting "Mon
Wed" repeats in every week of the range. If the semester starts or ends
mid-week, that edge week is simply partial (e.g. only Wed–Fri).

## Project layout

- `index.html` — page structure
- `css/style.css` — styling (supports light/dark based on system theme)
- `js/storage.js` — localStorage persistence, category/course data model, sample data
- `js/scheduler.js` — pure conflict-detection and combination-search logic (no DOM)
- `js/app.js` — DOM rendering and event wiring
- `.github/workflows/deploy-pages.yml` — publishes this static site to GitHub Pages on push

## Notes on the search

Generating combinations is a backtracking search over the union of every
bucket category's candidate pool: for each candidate course it branches on
include/exclude, pruning a branch as soon as it can no longer reach some
bucket's target (or already overshot one), and checking section conflicts
against everything already locked in whenever it includes a course. A course
in more than one bucket's pool increments every one of those buckets' counts
at once when chosen, which is what makes cross-listed courses satisfy
multiple requirements with a single enrollment. To keep the browser
responsive with several categories or large pools, the search is capped
(backtracking nodes, results kept); if you hit the cap the UI tells you the
search was truncated — narrow a bucket's pool or lower its target to get an
exhaustive result.
