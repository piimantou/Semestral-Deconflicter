// UI layer: renders state to the DOM and wires up events.
// All persistent data lives in `state` (see storage.js) and is saved after every mutation.

let state = loadState();
let previewPicks = null; // transient: a result being previewed from the results list (not yet pinned)
let lastSearch = null; // last generateCombinations() output, kept so re-render doesn't require re-search

const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function persist() {
  saveState(state);
}

// Swaps #modal-root for a fresh, listener-free node. Modal open functions
// re-render their whole modal (and re-add their own listeners) every time
// they run, including recursively after an in-modal action like add/delete —
// reusing the same persistent node would stack duplicate listeners on every
// re-open, so each open starts from a clean element instead.
function resetModalRoot() {
  const old = document.getElementById('modal-root');
  const fresh = document.createElement('div');
  fresh.id = 'modal-root';
  old.replaceWith(fresh);
  return fresh;
}

// ---------- Category / course helpers ----------
//
// A course can belong to more than one category at once (categoryIds is an
// array) — e.g. a cross-listed elective that counts toward two buckets, or
// a course that's both required and separately worth flagging as optional.

function categoryById(id) {
  return state.categories.find(c => c.id === id);
}
function requiredCategories() {
  return state.categories.filter(c => c.mode === 'required');
}
function bucketCategoryDefs() {
  return state.categories.filter(c => c.mode === 'bucket');
}
function optionalCategoryDefs() {
  return state.categories.filter(c => c.mode === 'optional');
}
function coursesInCategory(catId) {
  return state.courses.filter(c => c.categoryIds.includes(catId));
}
function courseIsInMode(course, mode) {
  return course.categoryIds.some(id => categoryById(id)?.mode === mode);
}
function requiredCourses() {
  return state.courses.filter(c => courseIsInMode(c, 'required'));
}
function optionalCourses() {
  return state.courses.filter(c => courseIsInMode(c, 'optional'));
}

// Sentinel stored in a *SectionSelections map in place of a real section id,
// meaning "show every section of this course" rather than just one.
const ALL_SECTIONS = '__all__';

// Resolves a stored selection value (a section id, ALL_SECTIONS, or unset)
// to the list of sections it represents.
function sectionsForSelection(course, value) {
  if (value === ALL_SECTIONS) return course.sections;
  const section = course.sections.find(s => s.id === value);
  if (section) return [section];
  return course.sections[0] ? [course.sections[0]] : [];
}

function chosenRequiredValue(course) {
  return state.requiredSelections[course.id] || course.sections[0]?.id;
}

function requiredPicks() {
  return requiredCourses().flatMap(c =>
    sectionsForSelection(c, chosenRequiredValue(c)).map(section => ({ course: c, section }))
  );
}

// Optional courses the user has manually opted into (checked in the
// Optional courses panel), each with whichever section(s) they chose.
function optionalPicks() {
  return optionalCourses()
    .filter(c => state.optionalSelections[c.id])
    .flatMap(c => sectionsForSelection(c, state.optionalSelections[c.id]).map(section => ({ course: c, section })));
}

// Everything that's fixed in place before the bucket search runs: mandatory
// required-category courses, plus anything the user manually opted into.
function lockedPicks() {
  return requiredPicks().concat(optionalPicks());
}

// Bucket courses checked into a pool are shown on the calendar right away
// (as a raw preview of what's under consideration) even before running the
// search — a course cross-listed into multiple pools is only counted once.
function bucketPreviewPicks() {
  const picks = [];
  const seen = new Set();
  for (const cat of bucketCategoryDefs()) {
    for (const courseId of cat.pool || []) {
      if (seen.has(courseId)) continue;
      const course = state.courses.find(c => c.id === courseId);
      if (!course) continue;
      const value = state.poolSectionSelections[courseId] || course.sections[0]?.id;
      const sections = sectionsForSelection(course, value);
      if (sections.length) {
        sections.forEach(section => picks.push({ course, section }));
        seen.add(courseId);
      }
    }
  }
  return picks;
}

// ---------- Rendering: course list ----------

const MODE_BADGE_CLASS = { required: 'type-required', bucket: 'type-bucket', optional: 'type-optional' };

// Short "days · time" or "N dates" summary, used in the section list and
// in every section-picker dropdown (required/optional/bucket pool).
function sectionSummaryText(s) {
  if (s.scheduleType === 'dates') {
    const n = (s.occurrences || []).length;
    return `${n} specific date${n === 1 ? '' : 's'}`;
  }
  return `${(s.days || []).join(' ')} ${s.start}-${s.end}`;
}

function sectionMetaHtml(s) {
  if (s.scheduleType === 'dates') {
    const occ = (s.occurrences || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (occ.length === 0) return 'No dates set';
    const first = formatShortDate(parseISODate(occ[0].date));
    const last = formatShortDate(parseISODate(occ[occ.length - 1].date));
    const span = occ.length > 1 ? `${first}&ndash;${last}` : first;
    return `${occ.length} date${occ.length === 1 ? '' : 's'} &middot; ${span}, times vary${s.location ? ' &middot; ' + escapeHtml(s.location) : ''}`;
  }
  const days = (s.days || []).join(' ');
  const rangeText = s.rangeStart || s.rangeEnd ? ` &middot; ${s.rangeStart ? formatShortDate(parseISODate(s.rangeStart)) : 'start'}&ndash;${s.rangeEnd ? formatShortDate(parseISODate(s.rangeEnd)) : 'end'}` : '';
  return `${days} &middot; ${s.start}&ndash;${s.end}${s.location ? ' &middot; ' + escapeHtml(s.location) : ''}${rangeText}`;
}

function courseCardHtml(course) {
  const badges = course.categoryIds.map(id => {
    const cat = categoryById(id);
    if (!cat) return '';
    return `<span class="type-badge ${MODE_BADGE_CLASS[cat.mode] || ''}">${escapeHtml(cat.name)}</span>`;
  }).join('');
  const isRequired = courseIsInMode(course, 'required');
  const requiredValue = isRequired ? chosenRequiredValue(course) : null;
  const sectionsHtml = course.sections.map(s => {
    const isActive = isRequired && course.sections.length > 1 && (requiredValue === ALL_SECTIONS || s.id === requiredValue);
    return `<li class="section-row${isActive ? ' section-row-active' : ''}">
      <span class="section-swatch" style="background:${course.color}"></span>
      <span class="section-label">${escapeHtml(s.label || 'Section')}</span>
      <span class="section-meta">${sectionMetaHtml(s)}</span>
      ${isActive ? '<span class="section-in-use">in use</span>' : ''}
    </li>`;
  }).join('');

  let requiredSelector = '';
  if (isRequired && course.sections.length > 1) {
    const options = course.sections.map(s => `<option value="${s.id}" ${s.id === requiredValue ? 'selected' : ''}>${escapeHtml(s.label || 'Section')} (${sectionSummaryText(s)})</option>`).join('');
    const allOption = `<option value="${ALL_SECTIONS}" ${requiredValue === ALL_SECTIONS ? 'selected' : ''}>All sections</option>`;
    requiredSelector = `<label class="core-select-label">Section used:
      <select class="required-section-select" data-course-id="${course.id}">${allOption}${options}</select>
    </label>`;
  }

  return `<div class="course-card" data-course-id="${course.id}" style="border-left-color:${course.color}">
    <div class="course-card-header">
      <div>
        <span class="course-code">${escapeHtml(course.code || '')}</span>
        <span class="course-name">${escapeHtml(course.name)}</span>
        ${badges || '<span class="type-badge">Uncategorized</span>'}
      </div>
      <div class="course-card-actions">
        <button class="btn btn-small btn-edit" data-action="edit-course" data-course-id="${course.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-action="delete-course" data-course-id="${course.id}">Delete</button>
      </div>
    </div>
    ${course.instructor ? `<div class="course-instructor">${escapeHtml(course.instructor)}</div>` : ''}
    ${requiredSelector}
    <ul class="section-list">${sectionsHtml || '<li class="section-row section-empty">No sections yet</li>'}</ul>
  </div>`;
}

function renderCourseList() {
  const list = el('#course-list');
  if (state.courses.length === 0) {
    list.innerHTML = `<p class="empty-hint">No courses yet. Add your required courses first, then add electives to whichever bucket categories they belong to.</p>`;
    return;
  }
  let html = '';
  for (const category of state.categories) {
    const courses = coursesInCategory(category.id);
    if (!courses.length) continue;
    const modeLabel = category.mode === 'required' ? 'required' : category.mode === 'bucket' ? `bucket, take ${category.target}` : 'optional';
    html += `<h3 class="course-group-heading">${escapeHtml(category.name)} <span class="course-group-mode">(${modeLabel})</span></h3>` + courses.map(courseCardHtml).join('');
  }
  const uncategorized = state.courses.filter(c => c.categoryIds.length === 0);
  if (uncategorized.length) {
    html += `<h3 class="course-group-heading">Uncategorized</h3>` + uncategorized.map(courseCardHtml).join('');
  }
  list.innerHTML = html;
}

// ---------- Rendering: calendar (When2Meet-inspired grid, spanning the whole semester) ----------

const DEFAULT_RANGE_START = 7 * 60; // 07:00
const DEFAULT_RANGE_END = 21 * 60; // 21:00
const SLOT_MINUTES = 30;
const ROW_HEIGHT = 22; // px per 30-minute slot
const DAY_COL_MIN_WIDTH = 88; // px — keeps week columns readable even when the semester spans many weeks

function calendarDays() {
  return state.showWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);
}

function parseISODate(str) {
  if (!str) return null;
  const parts = str.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// ISO date strings sort lexicographically the same as chronologically, so
// plain string comparison is enough here — no need to parse Dates.
function sectionActiveOnDate(section, isoDate) {
  if (section.rangeStart && isoDate < section.rangeStart) return false;
  if (section.rangeEnd && isoDate > section.rangeEnd) return false;
  return true;
}

// Resolves every meeting time a section has on a given calendar date — zero
// for a recurring section that doesn't meet that day/date, one for a normal
// recurring meeting, and whatever's listed for a 'dates' (block-seminar)
// section, which can carry a different time on each date.
function occurrenceTimesForDate(section, isoDate, dayName) {
  if (section.scheduleType === 'dates') {
    return (section.occurrences || []).filter(o => o.date === isoDate);
  }
  if ((section.days || []).includes(dayName) && sectionActiveOnDate(section, isoDate)) {
    return [{ start: section.start, end: section.end }];
  }
  return [];
}

function mondayOnOrBefore(date) {
  const d = new Date(date);
  const dow = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Groups every included day of the configured semester range into real
// Mon–Sun calendar weeks (the first/last week can be partial if the
// semester starts or ends mid-week). Returns null if no valid range is set,
// so callers can fall back to a single generic week.
function semesterWeeks() {
  const start = parseISODate(state.semesterStart);
  const end = parseISODate(state.semesterEnd);
  if (!start || !end || end < start) return null;

  const includedDayNames = new Set(calendarDays());
  const week0Start = mondayOnOrBefore(start);
  const weeksByIndex = new Map();

  const cur = new Date(start);
  while (cur <= end) {
    const dayName = DAY_ORDER[(cur.getDay() + 6) % 7];
    if (includedDayNames.has(dayName)) {
      const weekIndex = Math.floor((cur - week0Start) / (7 * 24 * 3600 * 1000));
      if (!weeksByIndex.has(weekIndex)) weeksByIndex.set(weekIndex, []);
      weeksByIndex.get(weekIndex).push(new Date(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }

  return Array.from(weeksByIndex.keys()).sort((a, b) => a - b).map(idx => {
    const weekStart = new Date(week0Start);
    weekStart.setDate(weekStart.getDate() + idx * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return { weekStart, weekEnd, dates: weeksByIndex.get(idx) };
  });
}

function computeTimeRange(picks) {
  let minStart = DEFAULT_RANGE_START, maxEnd = DEFAULT_RANGE_END;
  for (const { section } of picks) {
    if (section.scheduleType === 'dates') {
      for (const o of section.occurrences || []) {
        minStart = Math.min(minStart, timeToMinutes(o.start));
        maxEnd = Math.max(maxEnd, timeToMinutes(o.end));
      }
    } else {
      minStart = Math.min(minStart, timeToMinutes(section.start));
      maxEnd = Math.max(maxEnd, timeToMinutes(section.end));
    }
  }
  minStart = Math.floor(minStart / 60) * 60;
  maxEnd = Math.ceil(maxEnd / 60) * 60;
  return { minStart, maxEnd };
}

// Assigns side-by-side column layout to a list of same-day time entries so
// overlapping ones sit next to each other instead of silently stacking on
// top of one another, and records which other entries each one actually
// conflicts with (for a tooltip + warning badge). entries: [{start,end,...}]
// with start/end in minutes; non-overlapping entries elsewhere in the day
// each still get the full column width, since clusters are handled
// independently.
function layoutDayBlocks(entries) {
  const sorted = entries.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const result = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columnEnds = [];
    const colIndexOf = new Map();
    for (const ev of cluster) {
      let colIndex = columnEnds.findIndex(end => end <= ev.start);
      if (colIndex === -1) { colIndex = columnEnds.length; columnEnds.push(ev.end); }
      else { columnEnds[colIndex] = ev.end; }
      colIndexOf.set(ev, colIndex);
    }
    const colCount = columnEnds.length;
    for (const ev of cluster) {
      const conflictsWith = cluster.filter(o => o !== ev && ev.start < o.end && o.start < ev.end);
      result.push({ ...ev, colIndex: colIndexOf.get(ev), colCount, conflictsWith });
    }
    cluster = [];
  };

  for (const ev of sorted) {
    if (cluster.length > 0 && ev.start >= clusterEnd) {
      flushCluster();
      clusterEnd = -Infinity;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  flushCluster();

  return result;
}

function calendarBlockHtml(entry, minStart, pxPerMin) {
  const top = (entry.start - minStart) * pxPerMin;
  const h = (entry.end - entry.start) * pxPerMin;
  const widthPct = 100 / entry.colCount;
  const leftPct = widthPct * entry.colIndex;
  const hasConflict = entry.conflictsWith.length > 0;
  const titleParts = [entry.course.name];
  if (hasConflict) titleParts.push(`Conflicts with ${entry.conflictsWith.map(c => c.course.name).join(', ')}`);
  return `<div class="cal-block${hasConflict ? ' cal-block-conflict' : ''}" style="top:${top}px;height:${h}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);background:${entry.course.color}" title="${escapeHtml(titleParts.join(' — '))}">
    <div class="cal-block-title">${escapeHtml(entry.course.code || entry.course.name)}${hasConflict ? ' <span class="cal-conflict-badge">&#9888;</span>' : ''}</div>
    <div class="cal-block-meta">${entry.startStr}&ndash;${entry.endStr}${entry.location ? '<br>' + escapeHtml(entry.location) : ''}</div>
  </div>`;
}

// Builds the {start,end,startStr,endStr,course,location} entries a set of
// picks contributes on one calendar date, ready for layoutDayBlocks().
function dayEntriesFor(picks, isoDate, dayName) {
  return picks.flatMap(p =>
    occurrenceTimesForDate(p.section, isoDate, dayName).map(t => ({
      start: timeToMinutes(t.start), end: timeToMinutes(t.end),
      startStr: t.start, endStr: t.end,
      course: p.course, location: p.section.location,
    }))
  );
}

// Used only when there's no real semester date range to anchor to (the
// generic single-week fallback, on-screen or in print): matches purely by
// weekday name. A 'dates' section is approximated by whichever weekday each
// of its occurrences actually falls on, without implying it's weekly.
function genericDayEntries(picks, day) {
  return picks.flatMap(p => {
    if (p.section.scheduleType === 'dates') {
      return (p.section.occurrences || [])
        .filter(o => dayOfWeekFromISODate(o.date) === day)
        .map(o => ({ start: timeToMinutes(o.start), end: timeToMinutes(o.end), startStr: o.start, endStr: o.end, course: p.course, location: p.section.location }));
    }
    if (!(p.section.days || []).includes(day)) return [];
    return [{ start: timeToMinutes(p.section.start), end: timeToMinutes(p.section.end), startStr: p.section.start, endStr: p.section.end, course: p.course, location: p.section.location }];
  });
}

function renderCalendar(picks) {
  const weeks = semesterWeeks();
  if (!weeks || weeks.length === 0) {
    renderGenericWeekCalendar(picks);
    return;
  }

  const { minStart, maxEnd } = computeTimeRange(picks);
  const numSlots = (maxEnd - minStart) / SLOT_MINUTES;
  const pxPerMin = ROW_HEIGHT / SLOT_MINUTES;
  const height = numSlots * ROW_HEIGHT;

  const gutterCells = [];
  for (let t = minStart; t <= maxEnd; t += 60) {
    const top = (t - minStart) * pxPerMin;
    gutterCells.push(`<div class="hour-label" style="top:${top}px">${formatMinutes(t)}</div>`);
  }

  const allDates = weeks.flatMap(w => w.dates);
  const totalCols = allDates.length;
  const colTemplate = `56px repeat(${totalCols}, minmax(${DAY_COL_MIN_WIDTH}px, 1fr))`;

  const weekHeaderCells = weeks.map(w =>
    `<div class="cal-week-header" style="grid-column: span ${w.dates.length}">${formatShortDate(w.weekStart)} &ndash; ${formatShortDate(w.weekEnd)}</div>`
  ).join('');

  const dayHeaderCells = allDates.map(d => {
    const dayName = DAY_ORDER[(d.getDay() + 6) % 7];
    return `<div class="cal-day-header"><span class="dow">${dayName}</span><span class="date-num">${formatShortDate(d)}</span></div>`;
  }).join('');

  const dayColumns = allDates.map(d => {
    const dayName = DAY_ORDER[(d.getDay() + 6) % 7];
    const isoD = isoDateStr(d);
    const blocks = layoutDayBlocks(dayEntriesFor(picks, isoD, dayName))
      .map(e => calendarBlockHtml(e, minStart, pxPerMin))
      .join('');
    return `<div class="cal-day-col" data-date="${isoD}">${blocks}</div>`;
  }).join('');

  el('#calendar').innerHTML = `
    <div class="cal-scroll">
      <div class="cal-header-row" style="grid-template-columns:${colTemplate}">
        <div class="cal-gutter-header"></div>
        ${weekHeaderCells}
      </div>
      <div class="cal-subheader-row" style="grid-template-columns:${colTemplate}">
        <div class="cal-gutter-header"></div>
        ${dayHeaderCells}
      </div>
      <div class="cal-body" style="height:${height}px;grid-template-columns:${colTemplate}">
        <div class="cal-gutter" style="height:${height}px">${gutterCells.join('')}</div>
        <div class="cal-grid" style="height:${height}px;background-size:100% ${ROW_HEIGHT}px, 100% ${ROW_HEIGHT * 2}px;grid-template-columns:repeat(${totalCols},minmax(${DAY_COL_MIN_WIDTH}px, 1fr))">${dayColumns}</div>
      </div>
    </div>`;
}

// Used only when no valid semester date range is set: a single representative
// week of day-of-week columns (Mon..Fri/Sun), same as before dates existed.
function renderGenericWeekCalendar(picks) {
  const days = calendarDays();
  const { minStart, maxEnd } = computeTimeRange(picks);
  const numSlots = (maxEnd - minStart) / SLOT_MINUTES;
  const pxPerMin = ROW_HEIGHT / SLOT_MINUTES;
  const height = numSlots * ROW_HEIGHT;

  const gutterCells = [];
  for (let t = minStart; t <= maxEnd; t += 60) {
    const top = (t - minStart) * pxPerMin;
    gutterCells.push(`<div class="hour-label" style="top:${top}px">${formatMinutes(t)}</div>`);
  }

  const dayColumns = days.map(day => {
    const blocks = layoutDayBlocks(genericDayEntries(picks, day)).map(e => calendarBlockHtml(e, minStart, pxPerMin)).join('');
    return `<div class="cal-day-col" data-day="${day}">${blocks}</div>`;
  }).join('');

  el('#calendar').innerHTML = `
    <div class="cal-scroll">
      <div class="cal-header-row" style="grid-template-columns:56px repeat(${days.length},1fr)">
        <div class="cal-gutter-header"></div>
        ${days.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
      </div>
      <div class="cal-body" style="height:${height}px;grid-template-columns:56px repeat(${days.length},1fr)">
        <div class="cal-gutter" style="height:${height}px">${gutterCells.join('')}</div>
        <div class="cal-grid" style="height:${height}px;background-size:100% ${ROW_HEIGHT}px, 100% ${ROW_HEIGHT * 2}px;grid-template-columns:repeat(${days.length},1fr)">${dayColumns}</div>
      </div>
    </div>`;
}

// ---------- Print view ----------
//
// The on-screen semester view is one continuous horizontally-scrolling
// strip, which doesn't paginate sensibly. Printing instead builds a
// separate, print-only DOM: a cover page listing every course currently
// shown on the calendar, then one real page per week, each a normal
// single-week grid (reusing the same block-layout/conflict logic as the
// live calendar). Only #print-view is visible in print media; see the
// @media print rules in style.css.

const PRINT_ROW_HEIGHT = 18; // px per 30-minute slot — denser than on-screen so a full day fits one page

function printWeekPageHtml(dates, picks, minStart, maxEnd, heading) {
  const numSlots = (maxEnd - minStart) / SLOT_MINUTES;
  const pxPerMin = PRINT_ROW_HEIGHT / SLOT_MINUTES;
  const height = numSlots * PRINT_ROW_HEIGHT;

  const gutterCells = [];
  for (let t = minStart; t <= maxEnd; t += 60) {
    const top = (t - minStart) * pxPerMin;
    gutterCells.push(`<div class="hour-label" style="top:${top}px">${formatMinutes(t)}</div>`);
  }

  const dayHeaderCells = dates.map(d => {
    if (typeof d === 'string') return `<div class="cal-day-header"><span class="dow">${d}</span></div>`;
    const dayName = DAY_ORDER[(d.getDay() + 6) % 7];
    return `<div class="cal-day-header"><span class="dow">${dayName}</span><span class="date-num">${formatShortDate(d)}</span></div>`;
  }).join('');

  const dayColumns = dates.map(d => {
    const isDate = typeof d !== 'string';
    const entries = isDate
      ? dayEntriesFor(picks, isoDateStr(d), DAY_ORDER[(d.getDay() + 6) % 7])
      : genericDayEntries(picks, d);
    const blocks = layoutDayBlocks(entries).map(e => calendarBlockHtml(e, minStart, pxPerMin)).join('');
    return `<div class="cal-day-col">${blocks}</div>`;
  }).join('');

  const colTemplate = `56px repeat(${dates.length}, 1fr)`;
  return `<section class="print-week-page">
    <h2>${escapeHtml(heading)}</h2>
    <div class="cal-header-row" style="grid-template-columns:${colTemplate}">
      <div class="cal-gutter-header"></div>
      ${dayHeaderCells}
    </div>
    <div class="cal-body" style="height:${height}px;grid-template-columns:${colTemplate}">
      <div class="cal-gutter" style="height:${height}px">${gutterCells.join('')}</div>
      <div class="cal-grid" style="height:${height}px;background-size:100% ${PRINT_ROW_HEIGHT}px, 100% ${PRINT_ROW_HEIGHT * 2}px;grid-template-columns:repeat(${dates.length},1fr)">${dayColumns}</div>
    </div>
  </section>`;
}

function renderPrintView() {
  const container = el('#print-view');
  if (!container) return;
  const picks = currentDisplayPicks();

  const courses = [];
  const seen = new Set();
  for (const p of picks) {
    if (seen.has(p.course.id)) continue;
    seen.add(p.course.id);
    courses.push(p.course);
  }

  const courseRows = courses.map(c => {
    const categories = c.categoryIds.map(id => categoryById(id)?.name).filter(Boolean).join(', ');
    const shownSections = picks.filter(p => p.course.id === c.id).map(p => `${p.section.label || 'Section'} (${sectionSummaryText(p.section)})`).join('; ');
    return `<tr>
      <td>${escapeHtml(c.code || '')}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(categories)}</td>
      <td>${escapeHtml(c.instructor || '')}</td>
      <td>${escapeHtml(shownSections)}</td>
    </tr>`;
  }).join('');

  const coverHtml = `
    <section class="print-cover">
      <h1>Selected Schedule</h1>
      <p>${courses.length} course${courses.length === 1 ? '' : 's'} &middot; printed ${formatShortDate(new Date())}</p>
      <table class="print-course-table">
        <thead><tr><th>Code</th><th>Course</th><th>Category</th><th>Instructor</th><th>Section(s) shown</th></tr></thead>
        <tbody>${courseRows || '<tr><td colspan="5">No courses currently shown.</td></tr>'}</tbody>
      </table>
    </section>`;

  const { minStart, maxEnd } = computeTimeRange(picks);
  const weeks = semesterWeeks();
  let weeksHtml;
  if (weeks && weeks.length) {
    weeksHtml = weeks.map(w =>
      printWeekPageHtml(w.dates, picks, minStart, maxEnd, `Week of ${formatShortDate(w.weekStart)} – ${formatShortDate(w.weekEnd)}`)
    ).join('');
  } else {
    weeksHtml = printWeekPageHtml(calendarDays(), picks, minStart, maxEnd, 'Weekly schedule (no semester date range set)');
  }

  container.innerHTML = coverHtml + weeksHtml;
}

// ---------- Conflict banner ----------

function updateConflictBanner() {
  const banner = el('#conflict-banner');
  const conflicts = findConflicts(lockedPicks());
  if (conflicts.length === 0) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  const items = conflicts.map(([a, b]) =>
    `<li>${escapeHtml(a.course.name)} (${a.section.label}) overlaps ${escapeHtml(b.course.name)} (${b.section.label})</li>`
  ).join('');
  banner.innerHTML = `<strong>Your required and optional-selected courses conflict with each other</strong> — fix these before electives can be deconflicted:<ul>${items}</ul>`;
}

// ---------- Bucket planner + results ----------

function renderBucketPanel() {
  const container = el('#bucket-panel');
  const buckets = bucketCategoryDefs();
  if (buckets.length === 0) {
    container.innerHTML = `<p class="empty-hint">No bucket categories yet. Use "Categories" to add one (e.g. "AI Electives, choose 2"), then assign courses to it.</p>`;
    return;
  }
  container.innerHTML = buckets.map(cat => {
    const courses = coursesInCategory(cat.id);
    if (!cat.pool) cat.pool = courses.map(c => c.id);
    const items = courses.map(c => {
      const checked = cat.pool.includes(c.id);
      const sectionValue = state.poolSectionSelections[c.id] || c.sections[0]?.id;
      const sectionSelect = checked && c.sections.length > 1
        ? `<select class="pool-section-select" data-course-id="${c.id}">
             <option value="${ALL_SECTIONS}" ${sectionValue === ALL_SECTIONS ? 'selected' : ''}>All sections</option>
             ${c.sections.map(s => `<option value="${s.id}" ${s.id === sectionValue ? 'selected' : ''}>${escapeHtml(s.label || 'Section')} (${sectionSummaryText(s)})</option>`).join('')}
           </select>`
        : '';
      return `<label class="pool-item">
        <input type="checkbox" class="bucket-pool-check" data-category-id="${cat.id}" data-course-id="${c.id}" ${checked ? 'checked' : ''} />
        <span class="section-swatch" style="background:${c.color}"></span>
        ${escapeHtml(c.code ? c.code + ' — ' : '')}${escapeHtml(c.name)}
        <span class="pool-item-sections">(${c.sections.length} section${c.sections.length === 1 ? '' : 's'})</span>
        ${sectionSelect}
      </label>`;
    }).join('') || `<p class="empty-hint">No courses assigned to this category yet.</p>`;

    return `<div class="bucket-block" data-category-id="${cat.id}">
      <div class="bucket-block-header">
        <strong>${escapeHtml(cat.name)}</strong>
        <label class="bucket-target-label">take
          <input type="number" class="bucket-target-input" data-category-id="${cat.id}" min="0" max="${courses.length}" value="${cat.target}" />
        </label>
      </div>
      ${items}
    </div>`;
  }).join('');
}

function renderOptionalPanel() {
  const container = el('#optional-panel');
  const courses = optionalCourses();
  if (courses.length === 0) {
    container.innerHTML = '';
    return;
  }
  const items = courses.map(c => {
    const included = !!state.optionalSelections[c.id];
    const sectionValue = state.optionalSelections[c.id] || c.sections[0]?.id;
    const sectionSelect = c.sections.length > 1
      ? `<select class="optional-section-select" data-course-id="${c.id}">
           <option value="${ALL_SECTIONS}" ${sectionValue === ALL_SECTIONS ? 'selected' : ''}>All sections</option>
           ${c.sections.map(s => `<option value="${s.id}" ${s.id === sectionValue ? 'selected' : ''}>${escapeHtml(s.label || 'Section')} (${sectionSummaryText(s)})</option>`).join('')}
         </select>`
      : '';
    return `<label class="pool-item">
      <input type="checkbox" class="optional-include-check" data-course-id="${c.id}" ${included ? 'checked' : ''} />
      <span class="section-swatch" style="background:${c.color}"></span>
      ${escapeHtml(c.code ? c.code + ' — ' : '')}${escapeHtml(c.name)}
      ${sectionSelect}
    </label>`;
  }).join('');
  container.innerHTML = `<div class="bucket-block">
    <div class="bucket-block-header"><strong>Optional courses</strong></div>
    <p class="modal-hint">Not required by any bucket — check any you want to include anyway. These are locked into the schedule just like required courses when you generate combinations.</p>
    ${items}
  </div>`;
}

function renderResults(search) {
  const summary = el('#results-summary');
  const list = el('#results-list');
  if (!search) {
    summary.innerHTML = '';
    list.innerHTML = '';
    return;
  }
  const { results, truncated } = search;
  if (results.length === 0) {
    summary.innerHTML = `<p class="empty-hint">No conflict-free combination found. Try lowering a bucket's target, adding more sections, or widening the bucket's pool.</p>`;
    list.innerHTML = '';
    return;
  }
  summary.innerHTML = `<p>${results.length} valid combination${results.length === 1 ? '' : 's'} found${truncated ? ' (search truncated — narrow your bucket pools for a full search)' : ''}. Showing top ${Math.min(50, results.length)}.</p>`;

  list.innerHTML = results.slice(0, 50).map((r, i) => {
    const byCategory = {};
    for (const p of r.picks) {
      for (const catId of p.course.categoryIds) {
        const cat = categoryById(catId);
        if (!cat || cat.mode !== 'bucket') continue;
        (byCategory[catId] = byCategory[catId] || { name: cat.name, picks: [] }).picks.push(p);
      }
    }
    const groupsHtml = Object.values(byCategory).map(g =>
      `<span class="result-group"><em>${escapeHtml(g.name)}:</em> ${g.picks.map(p => `${escapeHtml(p.course.code || p.course.name)} (${escapeHtml(p.section.label)})`).join(', ')}</span>`
    ).join(' ');
    const m = r.metrics;
    return `<div class="result-card" data-result-index="${i}">
      <div class="result-main"><strong>#${i + 1}</strong> ${groupsHtml || '<em>no electives</em>'}</div>
      <div class="result-metrics">
        ${m.daysUsedCount} day${m.daysUsedCount === 1 ? '' : 's'} on campus &middot;
        ${formatMinutes(m.earliestStart)}&ndash;${formatMinutes(m.latestEnd)} &middot;
        ${Math.round(m.idleMinutes / 60 * 10) / 10}h idle
      </div>
      <div class="result-actions">
        <button class="btn btn-small" data-action="preview-result" data-result-index="${i}">Preview</button>
        <button class="btn btn-small btn-primary" data-action="pin-result" data-result-index="${i}">Pin to calendar</button>
      </div>
    </div>`;
  }).join('');
}

// ---------- Actions ----------

function runGeneration() {
  const sortMode = el('#sort-mode').value;
  state.sortMode = sortMode;
  persist();

  const locked = lockedPicks();
  const lockedIds = new Set(locked.map(p => p.course.id));
  const fixedLocked = locked.map(p => ({ ...p.course, sections: [p.section] }));

  // A locked-in course (required, or manually opted into as optional) that
  // also happens to belong to a bucket already satisfies one slot of that
  // bucket's target for free — reduce what the search still needs to find,
  // and don't offer that course again as a fresh candidate.
  const buckets = bucketCategoryDefs().map(cat => {
    const alreadySatisfied = state.courses.filter(c => lockedIds.has(c.id) && c.categoryIds.includes(cat.id)).length;
    return {
      id: cat.id,
      name: cat.name,
      target: Math.max(0, cat.target - alreadySatisfied),
      courses: coursesInCategory(cat.id).filter(c => (cat.pool || []).includes(c.id) && !lockedIds.has(c.id)),
    };
  });
  lastSearch = generateCombinations(fixedLocked, buckets, sortMode);
  renderResults(lastSearch);
}

function applyPreview(index) {
  if (!lastSearch) return;
  const result = lastSearch.results[index];
  if (!result) return;
  previewPicks = result.picks;
  updatePinnedBanner();
  renderCalendar(previewPicks);
}

function pinResult(index) {
  if (!lastSearch) return;
  const result = lastSearch.results[index];
  if (!result) return;
  const map = {};
  result.picks.forEach(p => { map[p.course.id] = p.section.id; });
  state.pinnedSchedule = map;
  previewPicks = null;
  persist();
  updatePinnedBanner();
  renderCalendar(result.picks);
}

function currentDisplayPicks() {
  if (previewPicks) return previewPicks;
  if (state.pinnedSchedule) {
    const picks = [];
    for (const course of state.courses) {
      const sectionId = state.pinnedSchedule[course.id];
      if (!sectionId) continue;
      const section = course.sections.find(s => s.id === sectionId);
      if (section) picks.push({ course, section });
    }
    if (picks.length) return picks;
  }
  return lockedPicks().concat(bucketPreviewPicks());
}

// A pinned schedule (or an unpinned preview) is a frozen snapshot — once
// set, currentDisplayPicks() shows only that, ignoring any later changes
// to required/optional/bucket selections. Anything that changes those
// selections must call this first or the calendar will silently keep
// showing stale data instead of reflecting the edit.
function clearPinnedView() {
  state.pinnedSchedule = null;
  previewPicks = null;
}

function unpinSchedule() {
  clearPinnedView();
  persist();
  refreshAll();
}

function updatePinnedBanner() {
  const banner = el('#pinned-banner');
  if (previewPicks) {
    banner.hidden = false;
    banner.innerHTML = `Previewing a generated combination — it's not saved unless you click <strong>Pin to calendar</strong>. <button type="button" class="btn btn-small" id="btn-back-to-live">Back to live view</button>`;
    return;
  }
  if (state.pinnedSchedule) {
    banner.hidden = false;
    banner.innerHTML = `<strong>Showing a pinned schedule.</strong> Changes to required/optional/bucket selections won't appear here until you unpin. <button type="button" class="btn btn-small" id="btn-unpin">Unpin</button>`;
    return;
  }
  banner.hidden = true;
  banner.innerHTML = '';
}

const NARROW_LAYOUT_QUERY = '(max-width: 1100px)';

// Pegs the courses panel's height to the electives panel's rendered height
// so a long course list scrolls internally instead of stretching the page.
// Below the responsive breakpoint the two panels stack instead of sitting
// side by side, so the cap is dropped there.
function syncCoursesPanelHeight() {
  const courses = el('.panel-courses');
  const electives = el('.panel-electives');
  if (!courses || !electives) return;
  if (window.matchMedia(NARROW_LAYOUT_QUERY).matches) {
    courses.style.maxHeight = '';
    return;
  }
  courses.style.maxHeight = electives.offsetHeight + 'px';
}

function refreshAll() {
  renderCourseList();
  renderBucketPanel();
  renderOptionalPanel();
  updateConflictBanner();
  updatePinnedBanner();
  renderCalendar(currentDisplayPicks());
  renderResults(lastSearch);
  syncCoursesPanelHeight();
}

// ---------- Category manager modal ----------

function openCategoryModal(editingId) {
  const root = resetModalRoot();
  const editing = editingId ? categoryById(editingId) : null;
  const rows = () => state.categories.map((cat, idx) => {
    const count = coursesInCategory(cat.id).length;
    const modeText = cat.mode === 'required' ? 'Required' : cat.mode === 'bucket' ? `Bucket (take ${cat.target})` : 'Optional';
    return `<div class="category-row" data-category-id="${cat.id}">
      <span class="category-row-reorder">
        <button type="button" class="btn btn-small" data-action="move-category-up" data-category-id="${cat.id}" ${idx === 0 ? 'disabled' : ''} title="Move up">&uarr;</button>
        <button type="button" class="btn btn-small" data-action="move-category-down" data-category-id="${cat.id}" ${idx === state.categories.length - 1 ? 'disabled' : ''} title="Move down">&darr;</button>
      </span>
      <span class="category-row-name">${escapeHtml(cat.name)}</span>
      <span class="category-row-mode">${modeText}</span>
      <span class="category-row-count">${count} course${count === 1 ? '' : 's'}</span>
      <button type="button" class="btn btn-small" data-action="edit-category" data-category-id="${cat.id}">Edit</button>
      <button type="button" class="btn btn-small btn-danger" data-action="delete-category" data-category-id="${cat.id}">Delete</button>
    </div>`;
  }).join('');

  root.innerHTML = `
  <div class="modal-overlay" id="modal-overlay">
    <div class="modal">
      <h2>Categories</h2>
      <p class="modal-hint">A course can belong to more than one category — e.g. a cross-listed elective can count toward two buckets at once. A <strong>required</strong> category means every course in it is mandatory. A <strong>bucket</strong> category means you're choosing a fixed number of courses out of the ones assigned to it. An <strong>optional</strong> category is never auto-selected — you manually opt individual courses in. Use the arrows to reorder — this controls the order categories are grouped in on the Courses list.</p>
      <div id="category-rows">${rows()}</div>
      <h3>${editing ? `Edit "${escapeHtml(editing.name)}"` : 'Add category'}</h3>
      <form id="category-form">
        <div class="form-row">
          <label>Name<input type="text" name="name" required placeholder="e.g. AI Electives" value="${editing ? escapeAttr(editing.name) : ''}" /></label>
          <label class="radio-label"><input type="radio" name="mode" value="required" ${!editing || editing.mode === 'required' ? 'checked' : ''} /> Required</label>
          <label class="radio-label"><input type="radio" name="mode" value="bucket" ${editing && editing.mode === 'bucket' ? 'checked' : ''} /> Bucket</label>
          <label class="radio-label"><input type="radio" name="mode" value="optional" ${editing && editing.mode === 'optional' ? 'checked' : ''} /> Optional</label>
          <label id="target-field">Take how many?<input type="number" name="target" min="0" value="${editing && editing.mode === 'bucket' ? editing.target : 1}" /></label>
        </div>
        <p class="form-error" id="category-form-error" hidden></p>
        <div class="modal-actions">
          ${editing ? '<button type="button" class="btn btn-ghost" id="btn-cancel-edit-category">Cancel edit</button>' : ''}
          <button type="button" class="btn btn-ghost" id="btn-close-category-modal">Close</button>
          <button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Add category'}</button>
        </div>
      </form>
    </div>
  </div>`;

  const updateTargetVisibility = () => {
    const mode = el('input[name="mode"]:checked', root).value;
    el('#target-field').style.display = mode === 'bucket' ? 'flex' : 'none';
  };
  updateTargetVisibility();
  els('input[name="mode"]', root).forEach(r => r.addEventListener('change', updateTargetVisibility));

  root.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay' || e.target.id === 'btn-close-category-modal') closeModal();
    if (e.target.id === 'btn-cancel-edit-category') openCategoryModal();
    const editBtn = e.target.closest('[data-action="edit-category"]');
    if (editBtn) openCategoryModal(editBtn.dataset.categoryId);
    const delBtn = e.target.closest('[data-action="delete-category"]');
    if (delBtn) deleteCategory(delBtn.dataset.categoryId);
    const upBtn = e.target.closest('[data-action="move-category-up"]');
    if (upBtn) moveCategory(upBtn.dataset.categoryId, -1, editingId);
    const downBtn = e.target.closest('[data-action="move-category-down"]');
    if (downBtn) moveCategory(downBtn.dataset.categoryId, 1, editingId);
  });

  el('#category-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const mode = form.mode.value;
    const target = parseInt(form.target.value, 10) || 0;
    const errorEl = el('#category-form-error');
    if (!name) { errorEl.hidden = false; errorEl.textContent = 'Name is required.'; return; }
    if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingId)) {
      errorEl.hidden = false; errorEl.textContent = 'A category with that name already exists.'; return;
    }

    if (editing) {
      editing.name = name;
      editing.mode = mode;
      if (mode === 'bucket') {
        editing.target = target;
        if (!editing.pool) editing.pool = coursesInCategory(editing.id).map(c => c.id);
      } else {
        delete editing.target;
        delete editing.pool;
      }
    } else {
      const category = { id: uid(), name, mode };
      if (mode === 'bucket') { category.target = target; category.pool = []; }
      state.categories.push(category);
    }
    persist();
    lastSearch = null;
    openCategoryModal(); // re-render, back in "add" mode
    refreshAll();
  });
}

function deleteCategory(categoryId) {
  const inUse = coursesInCategory(categoryId);
  if (inUse.length) {
    alert(`Can't delete "${categoryById(categoryId).name}" — ${inUse.length} course(s) still use it. Reassign or delete those courses first.`);
    return;
  }
  if (state.categories.length <= 1) {
    alert("You need at least one category.");
    return;
  }
  if (!confirm(`Delete category "${categoryById(categoryId).name}"?`)) return;
  state.categories = state.categories.filter(c => c.id !== categoryId);
  persist();
  openCategoryModal();
  refreshAll();
}

function moveCategory(categoryId, direction, keepEditingId) {
  const idx = state.categories.findIndex(c => c.id === categoryId);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= state.categories.length) return;
  [state.categories[idx], state.categories[swapIdx]] = [state.categories[swapIdx], state.categories[idx]];
  persist();
  openCategoryModal(keepEditingId);
  refreshAll();
}

// ---------- Course modal ----------

const DAY_LABELS = DAY_ORDER;

const MODE_LABEL = { required: 'Required', bucket: 'Bucket', optional: 'Optional' };

function openCourseModal(existing) {
  const isEdit = !!existing;
  const course = existing || { id: null, code: '', name: '', categoryIds: state.categories[0] ? [state.categories[0].id] : [], instructor: '', sections: [] };
  const sections = course.sections.length ? course.sections : [{ id: null, label: 'Section 01', scheduleType: 'recurring', days: [], start: '09:00', end: '10:15', location: '' }];

  const categoryChecks = state.categories.map(cat =>
    `<label class="category-check"><input type="checkbox" name="categoryIds" value="${cat.id}" ${course.categoryIds.includes(cat.id) ? 'checked' : ''} /> ${escapeHtml(cat.name)} <span class="category-check-mode">(${MODE_LABEL[cat.mode]})</span></label>`
  ).join('');

  const root = resetModalRoot();
  root.innerHTML = `
  <div class="modal-overlay" id="modal-overlay">
    <div class="modal">
      <h2>${isEdit ? 'Edit course' : 'Add course'}</h2>
      <form id="course-form">
        <div class="form-row">
          <label>Code<input type="text" name="code" value="${escapeAttr(course.code)}" placeholder="CS301" /></label>
          <label>Name<input type="text" name="name" value="${escapeAttr(course.name)}" required placeholder="Algorithms" /></label>
        </div>
        <div class="form-row">
          <label>Instructor<input type="text" name="instructor" value="${escapeAttr(course.instructor || '')}" /></label>
        </div>
        <fieldset class="category-checklist">
          <legend>Categories (a course can belong to more than one)</legend>
          ${categoryChecks || '<p class="empty-hint">No categories yet — add one via "Categories" first.</p>'}
        </fieldset>
        <h3>Sections</h3>
        <div id="section-rows">${sections.map(sectionRowHtml).join('')}</div>
        <button type="button" class="btn btn-ghost" id="btn-add-section-row">+ Add section</button>
        <p class="form-error" id="form-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="btn-cancel-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;

  el('#btn-add-section-row').addEventListener('click', () => {
    const container = el('#section-rows');
    container.insertAdjacentHTML('beforeend', sectionRowHtml({ id: null, label: `Section ${container.children.length + 1}`, scheduleType: 'recurring', days: [], start: '09:00', end: '10:15', location: '' }));
  });

  el('#section-rows').addEventListener('change', (e) => {
    if (e.target.matches('.sec-schedule-type')) {
      const row = e.target.closest('.section-form-row');
      const isDates = e.target.value === 'dates';
      el('.recurring-fields', row).hidden = isDates;
      el('.dates-fields', row).hidden = !isDates;
    }
  });

  root.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay' || e.target.id === 'btn-cancel-modal') closeModal();
    if (e.target.matches('.btn-remove-section')) {
      e.target.closest('.section-form-row').remove();
    }
    if (e.target.matches('.btn-add-occurrence')) {
      const row = e.target.closest('.section-form-row');
      const container = el('.occurrence-rows', row);
      const rows = els('.occurrence-row', container);
      const last = rows[rows.length - 1];
      const defaults = last
        ? { start: el('.occ-start', last).value, end: el('.occ-end', last).value }
        : { date: '', start: '09:00', end: '10:00' };
      container.insertAdjacentHTML('beforeend', occurrenceRowHtml({ id: null, date: '', ...defaults }));
    }
    if (e.target.matches('.btn-remove-occurrence')) {
      e.target.closest('.occurrence-row').remove();
    }
  });

  el('#course-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCourseFromForm(course.id);
  });
}

function occurrenceRowHtml(o) {
  // Not marked required: these inputs are hidden whenever this section is in
  // "recurring" mode, and a hidden-but-required field silently blocks form
  // submission (the browser can't focus it to show the validation error).
  // saveCourseFromForm() validates these explicitly instead, only for rows
  // actually in "dates" mode.
  return `<div class="occurrence-row" data-occurrence-id="${o.id || ''}">
    <input type="date" class="occ-date" value="${o.date || ''}" />
    <input type="time" class="occ-start" value="${o.start || '09:00'}" />
    <span class="occ-time-sep">&ndash;</span>
    <input type="time" class="occ-end" value="${o.end || '10:00'}" />
    <button type="button" class="btn btn-small btn-danger btn-remove-occurrence" title="Remove this date">&times;</button>
  </div>`;
}

function sectionRowHtml(s) {
  const isDates = s.scheduleType === 'dates';
  const rowKey = s.id || uid();
  const dayBoxes = DAY_LABELS.map(d =>
    `<label class="day-box"><input type="checkbox" value="${d}" ${(s.days || []).includes(d) ? 'checked' : ''}/>${d}</label>`
  ).join('');
  const occurrenceRows = (s.occurrences && s.occurrences.length ? s.occurrences : [{ id: null, date: '', start: '09:00', end: '10:00' }])
    .map(occurrenceRowHtml).join('');
  return `<div class="section-form-row" data-section-id="${s.id || ''}">
    <div class="form-row">
      <label>Label<input type="text" class="sec-label" value="${escapeAttr(s.label)}" /></label>
      <label>Location<input type="text" class="sec-location" value="${escapeAttr(s.location || '')}" /></label>
      <button type="button" class="btn btn-small btn-danger btn-remove-section">Remove</button>
    </div>
    <div class="form-row schedule-type-row">
      <label class="radio-label"><input type="radio" name="sec-schedule-type-${rowKey}" class="sec-schedule-type" value="recurring" ${!isDates ? 'checked' : ''} /> Recurring weekly</label>
      <label class="radio-label"><input type="radio" name="sec-schedule-type-${rowKey}" class="sec-schedule-type" value="dates" ${isDates ? 'checked' : ''} /> Specific dates</label>
    </div>
    <div class="recurring-fields" ${isDates ? 'hidden' : ''}>
      <div class="form-row">
        <label>Start<input type="time" class="sec-start" value="${s.start || '09:00'}" /></label>
        <label>End<input type="time" class="sec-end" value="${s.end || '10:15'}" /></label>
      </div>
      <div class="day-picker">${dayBoxes}</div>
      <div class="form-row">
        <label title="Leave both blank for the whole semester">Runs from (optional)<input type="date" class="sec-range-start" value="${s.rangeStart || ''}" /></label>
        <label title="Leave both blank for the whole semester">Runs through (optional)<input type="date" class="sec-range-end" value="${s.rangeEnd || ''}" /></label>
      </div>
    </div>
    <div class="dates-fields" ${isDates ? '' : 'hidden'}>
      <p class="modal-hint">For courses that don't meet weekly — add each specific date it meets, with its own time (e.g. a Thursday-evening-plus-weekend block seminar).</p>
      <div class="occurrence-rows">${occurrenceRows}</div>
      <button type="button" class="btn btn-small btn-ghost btn-add-occurrence">+ Add date</button>
    </div>
  </div>`;
}

function saveCourseFromForm(existingId) {
  const form = el('#course-form');
  const code = form.code.value.trim();
  const name = form.name.value.trim();
  const categoryIds = els('input[name="categoryIds"]:checked', form).map(cb => cb.value);
  const instructor = form.instructor.value.trim();
  const errorEl = el('#form-error');

  if (categoryIds.length === 0) { errorEl.hidden = false; errorEl.textContent = 'Pick at least one category.'; return; }

  const sectionRows = els('.section-form-row');
  const sections = [];
  for (const row of sectionRows) {
    const label = el('.sec-label', row).value.trim() || 'Section';
    const location = el('.sec-location', row).value.trim();
    const existingSectionId = row.dataset.sectionId || null;
    const scheduleType = el('.sec-schedule-type:checked', row)?.value || 'recurring';

    if (scheduleType === 'dates') {
      const occurrenceRows = els('.occurrence-row', row);
      const occurrences = [];
      for (const occRow of occurrenceRows) {
        const date = el('.occ-date', occRow).value;
        const start = el('.occ-start', occRow).value;
        const end = el('.occ-end', occRow).value;
        if (!date || !start || !end) { errorEl.hidden = false; errorEl.textContent = `Section "${label}" has a date row missing a date or time.`; return; }
        if (timeToMinutes(start) >= timeToMinutes(end)) { errorEl.hidden = false; errorEl.textContent = `Section "${label}": each date must end after it starts.`; return; }
        occurrences.push({ id: occRow.dataset.occurrenceId || uid(), date, start, end });
      }
      if (occurrences.length === 0) { errorEl.hidden = false; errorEl.textContent = `Section "${label}" needs at least one date.`; return; }
      occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
      sections.push({ id: existingSectionId || uid(), label, location, scheduleType, occurrences });
      continue;
    }

    const start = el('.sec-start', row).value;
    const end = el('.sec-end', row).value;
    const days = els('.day-box input:checked', row).map(cb => cb.value);
    const rangeStart = el('.sec-range-start', row).value || null;
    const rangeEnd = el('.sec-range-end', row).value || null;
    if (!start || !end) { errorEl.hidden = false; errorEl.textContent = 'Every section needs a start and end time.'; return; }
    if (timeToMinutes(start) >= timeToMinutes(end)) { errorEl.hidden = false; errorEl.textContent = `Section "${label}" must end after it starts.`; return; }
    if (days.length === 0) { errorEl.hidden = false; errorEl.textContent = `Section "${label}" needs at least one day.`; return; }
    if (rangeStart && rangeEnd && rangeEnd < rangeStart) { errorEl.hidden = false; errorEl.textContent = `Section "${label}"'s end date must be after its start date.`; return; }
    sections.push({ id: existingSectionId || uid(), label, start, end, location, days, rangeStart, rangeEnd, scheduleType });
  }
  if (sections.length === 0) { errorEl.hidden = false; errorEl.textContent = 'Add at least one section.'; return; }
  if (!name) { errorEl.hidden = false; errorEl.textContent = 'Course name is required.'; return; }

  let savedCourse;
  if (existingId) {
    const idx = state.courses.findIndex(c => c.id === existingId);
    const prev = state.courses[idx];
    savedCourse = { ...prev, code, name, categoryIds, instructor, sections };
    state.courses[idx] = savedCourse;
  } else {
    savedCourse = { id: uid(), code, name, categoryIds, instructor, color: nextColor(state.courses), sections };
    state.courses.push(savedCourse);
  }

  // Keep bucket pools in sync: a course newly assigned to a bucket category
  // defaults to "considered"; remove it from pools of categories it no longer belongs to.
  for (const cat of bucketCategoryDefs()) {
    if (!cat.pool) cat.pool = [];
    if (categoryIds.includes(cat.id)) {
      if (!cat.pool.includes(savedCourse.id)) cat.pool.push(savedCourse.id);
    } else {
      cat.pool = cat.pool.filter(id => id !== savedCourse.id);
    }
  }

  persist();
  closeModal();
  lastSearch = null;
  refreshAll();
}

function closeModal() {
  el('#modal-root').innerHTML = '';
}

function deleteCourse(courseId) {
  if (!confirm('Delete this course and all its sections?')) return;
  state.courses = state.courses.filter(c => c.id !== courseId);
  for (const cat of bucketCategoryDefs()) {
    if (cat.pool) cat.pool = cat.pool.filter(id => id !== courseId);
  }
  if (state.pinnedSchedule) delete state.pinnedSchedule[courseId];
  if (state.requiredSelections) delete state.requiredSelections[courseId];
  if (state.optionalSelections) delete state.optionalSelections[courseId];
  if (state.poolSectionSelections) delete state.poolSectionSelections[courseId];
  persist();
  lastSearch = null;
  refreshAll();
}

// ---------- Import / export ----------

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'semestral-deconflicter-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = normalize(parsed);
      persist();
      lastSearch = null;
      previewPicks = null;
      syncTopControls();
      refreshAll();
    } catch (e) {
      alert('That file could not be read as a valid export: ' + e.message);
    }
  };
  reader.readAsText(file);
}

// ---------- Helpers ----------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------- Wiring ----------

function syncTopControls() {
  el('#sort-mode').value = state.sortMode;
  el('#chk-weekend').checked = !!state.showWeekend;
  el('#semester-start').value = state.semesterStart || '';
  el('#semester-end').value = state.semesterEnd || '';
  el('#semester-range-error').hidden = true;
}

function handleSemesterRangeChange() {
  const start = el('#semester-start').value;
  const end = el('#semester-end').value;
  const errorEl = el('#semester-range-error');
  if (start && end && end < start) {
    errorEl.hidden = false;
    errorEl.textContent = 'Semester end date must be after the start date.';
    return;
  }
  errorEl.hidden = true;
  state.semesterStart = start || null;
  state.semesterEnd = end || null;
  persist();
  renderCalendar(currentDisplayPicks());
}

function init() {
  syncTopControls();

  el('#btn-add-course').addEventListener('click', () => openCourseModal(null));
  el('#btn-manage-categories').addEventListener('click', () => openCategoryModal());

  el('#course-list').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-action="edit-course"]');
    const delBtn = e.target.closest('[data-action="delete-course"]');
    if (editBtn) {
      const course = state.courses.find(c => c.id === editBtn.dataset.courseId);
      openCourseModal(course);
    }
    if (delBtn) deleteCourse(delBtn.dataset.courseId);
  });

  el('#course-list').addEventListener('change', (e) => {
    if (e.target.matches('.required-section-select')) {
      state.requiredSelections[e.target.dataset.courseId] = e.target.value;
      clearPinnedView();
      persist();
      refreshAll();
    }
  });

  el('#bucket-panel').addEventListener('change', (e) => {
    if (e.target.matches('.bucket-pool-check')) {
      const cat = categoryById(e.target.dataset.categoryId);
      const courseId = e.target.dataset.courseId;
      if (!cat.pool) cat.pool = [];
      if (e.target.checked) {
        if (!cat.pool.includes(courseId)) cat.pool.push(courseId);
      } else {
        cat.pool = cat.pool.filter(id => id !== courseId);
      }
      clearPinnedView();
      persist();
      lastSearch = null;
      refreshAll();
    }
    if (e.target.matches('.pool-section-select')) {
      state.poolSectionSelections[e.target.dataset.courseId] = e.target.value;
      clearPinnedView();
      persist();
      lastSearch = null;
      refreshAll();
    }
    if (e.target.matches('.bucket-target-input')) {
      const cat = categoryById(e.target.dataset.categoryId);
      cat.target = Math.max(0, parseInt(e.target.value, 10) || 0);
      persist();
      lastSearch = null;
      renderResults(null);
    }
  });

  el('#optional-panel').addEventListener('change', (e) => {
    const courseId = e.target.dataset.courseId;
    if (e.target.matches('.optional-include-check')) {
      if (e.target.checked) {
        const course = state.courses.find(c => c.id === courseId);
        state.optionalSelections[courseId] = state.optionalSelections[courseId] || course.sections[0]?.id;
      } else {
        delete state.optionalSelections[courseId];
      }
      clearPinnedView();
      persist();
      lastSearch = null;
      refreshAll();
    }
    if (e.target.matches('.optional-section-select')) {
      state.optionalSelections[courseId] = e.target.value;
      clearPinnedView();
      persist();
      lastSearch = null;
      refreshAll();
    }
  });

  el('#pinned-banner').addEventListener('click', (e) => {
    if (e.target.id === 'btn-unpin') unpinSchedule();
    if (e.target.id === 'btn-back-to-live') {
      previewPicks = null;
      refreshAll();
    }
  });

  el('#btn-generate').addEventListener('click', () => {
    previewPicks = null;
    runGeneration();
  });

  el('#results-list').addEventListener('click', (e) => {
    const previewBtn = e.target.closest('[data-action="preview-result"]');
    const pinBtn = e.target.closest('[data-action="pin-result"]');
    if (previewBtn) applyPreview(parseInt(previewBtn.dataset.resultIndex, 10));
    if (pinBtn) pinResult(parseInt(pinBtn.dataset.resultIndex, 10));
  });

  el('#chk-weekend').addEventListener('change', (e) => {
    state.showWeekend = e.target.checked;
    persist();
    renderCalendar(currentDisplayPicks());
  });

  el('#semester-start').addEventListener('change', handleSemesterRangeChange);
  el('#semester-end').addEventListener('change', handleSemesterRangeChange);

  el('#btn-load-example').addEventListener('click', () => {
    if (state.courses.length && !confirm('Replace current data with the example schedule?')) return;
    state = exampleState();
    persist();
    lastSearch = null;
    previewPicks = null;
    syncTopControls();
    refreshAll();
  });

  el('#btn-export').addEventListener('click', exportJson);
  el('#btn-import').addEventListener('click', () => el('#file-import').click());
  el('#file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  el('#btn-print').addEventListener('click', () => {
    renderPrintView();
    window.print();
  });

  el('#btn-clear-all').addEventListener('click', () => {
    if (!confirm('This deletes all courses and settings. Continue?')) return;
    clearState();
    state = defaultState();
    lastSearch = null;
    previewPicks = null;
    syncTopControls();
    refreshAll();
  });

  window.addEventListener('resize', syncCoursesPanelHeight);

  refreshAll();
}

document.addEventListener('DOMContentLoaded', init);
