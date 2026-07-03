// Pure scheduling logic: conflict detection + combinatorial search.
// No DOM access in this file so it can be unit-tested / reused independently.

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function sectionsOverlap(a, b) {
  const sharedDay = a.days.some(d => b.days.includes(d));
  if (!sharedDay) return false;
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end);
  const bStart = timeToMinutes(b.start);
  const bEnd = timeToMinutes(b.end);
  return aStart < bEnd && bStart < aEnd;
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

function combinations(arr, k) {
  const results = [];
  if (k < 0) return results;
  if (k === 0) return [[]];
  const backtrack = (start, chosen) => {
    if (chosen.length === k) {
      results.push(chosen.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      chosen.push(arr[i]);
      backtrack(i + 1, chosen);
      chosen.pop();
    }
  };
  backtrack(0, []);
  return results;
}

function scheduleMetrics(picks) {
  const byDay = {};
  let totalClassMinutes = 0;
  for (const { section } of picks) {
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

// Limits to keep the browser responsive even with a large elective pool.
const LIMITS = {
  maxSubsets: 3000,
  maxNodesPerSubset: 20000,
  maxResults: 300,
};

/**
 * Generates every conflict-free way to combine all `coreCourses` (mandatory,
 * one section each) with exactly `electiveTarget` courses drawn from
 * `electivePoolCourses` (one section each).
 *
 * Returns { results, truncated, coreConflicts }
 *   results: [{ picks: [{course, section}], metrics }]  sorted by sortMode
 *   coreConflicts: conflicts that exist among core courses alone (unfixable by elective choice)
 */
function generateCombinations(coreCourses, electivePoolCourses, electiveTarget, sortMode) {
  const target = Math.max(0, Math.min(electiveTarget, electivePoolCourses.length));

  // Core courses must always be included; flag unavoidable internal conflicts up front.
  const coreConflicts = [];
  for (const c of coreCourses) {
    if (c.sections.length === 0) continue;
  }

  const results = [];
  let truncated = false;
  const subsets = combinations(electivePoolCourses, target);
  const subsetsToProcess = subsets.slice(0, LIMITS.maxSubsets);
  if (subsets.length > LIMITS.maxSubsets) truncated = true;

  for (const electiveSubset of subsetsToProcess) {
    const courseList = coreCourses.concat(electiveSubset).filter(c => c.sections.length > 0);
    if (courseList.length === 0) continue;

    let nodes = 0;
    const picks = [];

    const backtrack = (idx) => {
      if (results.length >= LIMITS.maxResults) return true; // signal stop
      if (nodes++ > LIMITS.maxNodesPerSubset) { truncated = true; return true; }
      if (idx === courseList.length) {
        results.push({ picks: picks.slice(), metrics: scheduleMetrics(picks) });
        return false;
      }
      const course = courseList[idx];
      for (const section of course.sections) {
        const candidate = { course, section };
        const conflict = picks.some(p => sectionsOverlap(p.section, section));
        if (conflict) continue;
        picks.push(candidate);
        const stop = backtrack(idx + 1);
        picks.pop();
        if (stop) return true;
      }
      return false;
    };

    const stop = backtrack(0);
    if (stop && results.length >= LIMITS.maxResults) { truncated = true; break; }
  }

  results.sort(comparatorFor(sortMode));
  return { results, truncated, coreConflicts };
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
