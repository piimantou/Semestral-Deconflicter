// Pure scheduling logic: conflict detection + combinatorial search.
// No DOM access in this file so it can be unit-tested / reused independently.

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

// 'YYYY-MM-DD' compares lexicographically the same as chronologically, and
// JS's Date(y, m-1, d) constructor reads it in local time (no UTC-shift
// surprises), so this is safe without a date library.
function dayOfWeekFromISODate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return DAY_ORDER[(date.getDay() + 6) % 7];
}

// Sections without a rangeStart/rangeEnd are assumed to run the whole
// semester, so they always overlap on the date axis. Two sections that
// each specify a range only overlap if those ranges actually intersect —
// this lets two half-semester sections share a day/time slot without being
// flagged as conflicting, as long as they don't run at the same time.
function dateRangesOverlap(a, b) {
  if (a.rangeEnd && b.rangeStart && a.rangeEnd < b.rangeStart) return false;
  if (b.rangeEnd && a.rangeStart && b.rangeEnd < a.rangeStart) return false;
  return true;
}

// A section is either 'recurring' (meets every week on `days` at `start`-
// `end`, optionally only within `rangeStart`/`rangeEnd`) or 'dates' (an
// explicit list of one-off `occurrences`, each with its own date and time —
// for block seminars or anything that doesn't follow a weekly pattern).
function sectionsOverlap(a, b) {
  const aDated = a.scheduleType === 'dates';
  const bDated = b.scheduleType === 'dates';

  if (!aDated && !bDated) {
    if (!a.days.some(d => b.days.includes(d))) return false;
    if (!dateRangesOverlap(a, b)) return false;
    return timeRangesOverlap(a.start, a.end, b.start, b.end);
  }

  if (aDated && bDated) {
    return (a.occurrences || []).some(oa =>
      (b.occurrences || []).some(ob => oa.date === ob.date && timeRangesOverlap(oa.start, oa.end, ob.start, ob.end))
    );
  }

  // One dated, one recurring: each occurrence conflicts if it falls on one
  // of the recurring section's days, within its active range, and the
  // times overlap.
  const occSection = aDated ? a : b;
  const recSection = aDated ? b : a;
  return (occSection.occurrences || []).some(occ => {
    if (!recSection.days.includes(dayOfWeekFromISODate(occ.date))) return false;
    if (recSection.rangeStart && occ.date < recSection.rangeStart) return false;
    if (recSection.rangeEnd && occ.date > recSection.rangeEnd) return false;
    return timeRangesOverlap(occ.start, occ.end, recSection.start, recSection.end);
  });
}

// picks: array of { course, section }
function findConflicts(picks) {
  const conflicts = [];
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      if (sectionsOverlap(picks[i].section, picks[j].section)) {
        conflicts.push([picks[i], picks[j]]);
      }
    }
  }
  return conflicts;
}

function scheduleMetrics(picks) {
  const byDay = {};
  let totalClassMinutes = 0;
  for (const { section } of picks) {
    if (section.scheduleType === 'dates') {
      for (const occ of section.occurrences || []) {
        const dow = dayOfWeekFromISODate(occ.date);
        totalClassMinutes += timeToMinutes(occ.end) - timeToMinutes(occ.start);
        byDay[dow] = byDay[dow] || [];
        byDay[dow].push({ start: timeToMinutes(occ.start), end: timeToMinutes(occ.end) });
      }
      continue;
    }
    const dur = timeToMinutes(section.end) - timeToMinutes(section.start);
    totalClassMinutes += dur * section.days.length;
    for (const d of section.days) {
      byDay[d] = byDay[d] || [];
      byDay[d].push({ start: timeToMinutes(section.start), end: timeToMinutes(section.end) });
    }
  }
  const daysUsed = Object.keys(byDay);
  let idleMinutes = 0;
  let earliestStart = Infinity;
  let latestEnd = -Infinity;
  for (const d of daysUsed) {
    const spans = byDay[d].sort((a, b) => a.start - b.start);
    const dayStart = spans[0].start;
    const dayEnd = Math.max(...spans.map(s => s.end));
    earliestStart = Math.min(earliestStart, dayStart);
    latestEnd = Math.max(latestEnd, dayEnd);
    const busy = spans.reduce((sum, s) => sum + (s.end - s.start), 0);
    idleMinutes += (dayEnd - dayStart) - busy;
  }
  return {
    daysUsedCount: daysUsed.length,
    daysUsed: daysUsed.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)),
    idleMinutes,
    earliestStart: earliestStart === Infinity ? null : earliestStart,
    latestEnd: latestEnd === -Infinity ? null : latestEnd,
    totalClassMinutes,
  };
}

function comparatorFor(sortMode) {
  switch (sortMode) {
    case 'leastIdle':
      return (a, b) => a.metrics.idleMinutes - b.metrics.idleMinutes || a.metrics.daysUsedCount - b.metrics.daysUsedCount;
    case 'earlyFinish':
      return (a, b) => a.metrics.latestEnd - b.metrics.latestEnd || a.metrics.daysUsedCount - b.metrics.daysUsedCount;
    case 'lateStart':
      return (a, b) => b.metrics.earliestStart - a.metrics.earliestStart || a.metrics.daysUsedCount - b.metrics.daysUsedCount;
    case 'compact':
    default:
      return (a, b) => a.metrics.daysUsedCount - b.metrics.daysUsedCount || a.metrics.idleMinutes - b.metrics.idleMinutes;
  }
}

// Limits to keep the browser responsive even with several bucket categories
// or a large elective pool.
const LIMITS = {
  maxNodes: 300000,
  maxResults: 300,
};

/**
 * Generates every conflict-free way to combine all `fixedCourses` (already
 * locked in — mandatory required-category courses plus anything the user
 * manually opted into — one section each) with exactly `target` more
 * courses per bucket category.
 *
 * A course can appear in more than one bucket's `courses` pool (e.g. a
 * cross-listed elective); choosing it once counts toward every bucket it
 * belongs to simultaneously, rather than needing to be picked once per
 * bucket. bucketCategories' targets should already be reduced by whatever
 * fixedCourses contribute to them, and their pools should already exclude
 * fixedCourses — the caller (runGeneration in app.js) does this so this
 * function only has to solve for what's still needed.
 *
 * bucketCategories: [{ id, name, target, courses: [course, ...] }]
 *
 * Returns { results, truncated }
 *   results: [{ picks: [{course, section}], metrics }] sorted by sortMode
 */
function generateCombinations(fixedCourses, bucketCategories, sortMode) {
  const results = [];
  let truncated = false;
  let nodes = 0;

  // Union of every bucket's candidate courses, deduped, each tagged with
  // which bucket(s) choosing it would satisfy.
  const unionMap = new Map();
  for (const cat of bucketCategories) {
    for (const course of cat.courses) {
      if (!unionMap.has(course.id)) unionMap.set(course.id, { course, bucketIds: [] });
      unionMap.get(course.id).bucketIds.push(cat.id);
    }
  }
  const unionEntries = Array.from(unionMap.values());
  const targetById = new Map(bucketCategories.map(c => [c.id, Math.max(0, c.target)]));

  // Suffix sums: remainingCapacity[i][bucketId] = how many more entries from
  // index i onward could still contribute to that bucket, for pruning.
  const remainingCapacity = new Array(unionEntries.length + 1);
  remainingCapacity[unionEntries.length] = new Map(bucketCategories.map(c => [c.id, 0]));
  for (let i = unionEntries.length - 1; i >= 0; i--) {
    const next = new Map(remainingCapacity[i + 1]);
    for (const bid of unionEntries[i].bucketIds) next.set(bid, next.get(bid) + 1);
    remainingCapacity[i] = next;
  }

  const picks = fixedCourses.filter(c => c.sections.length > 0).map(c => ({ course: c, section: c.sections[0] }));
  const counts = new Map(bucketCategories.map(c => [c.id, 0]));

  const backtrack = (idx) => {
    if (results.length >= LIMITS.maxResults) return true;
    if (nodes++ > LIMITS.maxNodes) { truncated = true; return true; }

    if (idx === unionEntries.length) {
      for (const cat of bucketCategories) {
        if (counts.get(cat.id) !== targetById.get(cat.id)) return false;
      }
      results.push({ picks: picks.slice(), metrics: scheduleMetrics(picks) });
      return false;
    }

    // Prune: if some bucket can't reach its target even with every
    // remaining candidate, this whole branch is dead.
    const cap = remainingCapacity[idx];
    for (const cat of bucketCategories) {
      if (counts.get(cat.id) + cap.get(cat.id) < targetById.get(cat.id)) return false;
    }

    const entry = unionEntries[idx];

    // Branch: skip this course.
    if (backtrack(idx + 1)) return true;

    // Branch: take this course, if doing so wouldn't overshoot any target
    // it counts toward.
    const overshoots = entry.bucketIds.some(bid => counts.get(bid) + 1 > targetById.get(bid));
    if (!overshoots) {
      for (const section of entry.course.sections) {
        if (picks.some(p => sectionsOverlap(p.section, section))) continue;
        picks.push({ course: entry.course, section });
        entry.bucketIds.forEach(bid => counts.set(bid, counts.get(bid) + 1));
        const stop = backtrack(idx + 1);
        picks.pop();
        entry.bucketIds.forEach(bid => counts.set(bid, counts.get(bid) - 1));
        if (stop) return true;
      }
    }
    return false;
  };

  backtrack(0);

  results.sort(comparatorFor(sortMode));
  return { results, truncated };
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
