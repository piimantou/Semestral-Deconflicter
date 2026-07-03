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

Click **Load example** to see a sample semester (2 core courses split across
a required category and two elective buckets) and get a feel for the tool.

## How it works

1. **Set up categories.** Click **Categories** to define the buckets your
   courses fall into. A category is either:
   - **Required** — every course assigned to it is mandatory (e.g. "Core").
   - **Bucket** — you're choosing a fixed number of courses out of the ones
     assigned to it (e.g. "AI Electives, take 2" or "Humanities, take 1").
   You can have as many bucket categories as you need — useful when your
   program requires "1 from group A and 2 from group B," not just a single
   flat elective pool.
2. **Add your courses**, assigning each to a category. Each course can have
   one or more sections (different day/time offerings).
3. If a required course has multiple sections, pick which one you're
   actually enrolled in from the dropdown on its card. A red banner appears
   if your required courses conflict with each other — fix that first, since
   no elective choice can work around it.
4. In the **Bucket deconfliction** panel, each bucket category shows its
   target count and the courses under consideration (uncheck any you want to
   exclude without deleting). Click **Generate valid combinations** — the
   tool exhaustively searches every way to satisfy every bucket's target
   simultaneously (and a section for each chosen course) without conflicting
   with your required schedule or each other.
5. Results are ranked by your chosen criterion (fewest days on campus, least
   idle time between classes, earliest finish, or latest start). **Preview**
   shows a combination on the calendar without saving it; **Pin to calendar**
   keeps it as your selected schedule.
6. **Print schedule** prints just the calendar view.

The weekly calendar is a compact time-grid in the style of When2Meet: sticky
day headers, a fixed time gutter, fine hour/half-hour gridlines, and
color-coded blocks per course.

## Project layout

- `index.html` — page structure
- `css/style.css` — styling (supports light/dark based on system theme)
- `js/storage.js` — localStorage persistence, category/course data model, sample data
- `js/scheduler.js` — pure conflict-detection and combination-search logic (no DOM)
- `js/app.js` — DOM rendering and event wiring
- `.github/workflows/deploy-pages.yml` — publishes this static site to GitHub Pages on push

## Notes on the search

Generating combinations is a backtracking search: for each bucket category it
tries every subset of the target size from that category's pool, then across
all bucket categories' subsets (a lazily-explored Cartesian product) it
backtracks over section choices, pruning as soon as two sections overlap. To
keep the browser responsive with several categories or large pools, the
search is capped (combinations explored, backtracking nodes, results kept);
if you hit the cap the UI tells you the search was truncated — narrow a
bucket's pool or lower its target to get an exhaustive result.
