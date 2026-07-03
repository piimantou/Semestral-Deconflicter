# Semestral Deconflicter

A small, no-build web app for planning a semester schedule and figuring out
which combination of electives you can actually take without time conflicts.

## Running it

No build step, no dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve it statically, e.g. `python3 -m http.server 8000` and visit `http://localhost:8000`

All data is saved to `localStorage` in your browser, so it persists between visits
on the same device/browser. Use **Export JSON** / **Import JSON** to back up or
move your data elsewhere.

Click **Load example** to see a sample semester (2 core courses, 4 electives)
and get a feel for the tool.

## How it works

1. **Add your courses.** Mark each as **Core** (required — you must take it,
   exactly one section) or **Elective** (optional — you're choosing among them).
   Each course can have one or more sections (different day/time offerings).
2. If a core course has multiple sections, pick which one you're actually
   enrolled in from the dropdown on its card. A red banner appears if your
   core courses conflict with each other — fix that first, since no elective
   choice can work around it.
3. In the **Elective deconfliction** panel, set how many electives you want to
   take, choose which electives to consider, and click **Generate valid
   combinations**. The tool exhaustively searches every way to pick that many
   electives (and a section for each) that doesn't conflict with your core
   schedule or with each other.
4. Results are ranked by your chosen criterion (fewest days on campus, least
   idle time between classes, earliest finish, or latest start). **Preview**
   shows a combination on the calendar without saving it; **Pin to calendar**
   keeps it as your selected schedule.
5. **Print schedule** prints just the calendar view.

## Project layout

- `index.html` — page structure
- `css/style.css` — styling (supports light/dark based on system theme)
- `js/storage.js` — localStorage persistence, sample data
- `js/scheduler.js` — pure conflict-detection and combination-search logic (no DOM)
- `js/app.js` — DOM rendering and event wiring

## Notes on the search

Generating combinations is a backtracking search: for a target of *k*
electives, it tries every *k*-subset of your selected elective pool, and
within each subset backtracks over section choices, pruning as soon as two
sections overlap. To keep the browser responsive with large elective pools,
the search is capped (subsets explored, nodes per subset, results kept); if
you hit the cap the UI tells you the search was truncated — narrow the
elective pool or lower the target to get an exhaustive result.
