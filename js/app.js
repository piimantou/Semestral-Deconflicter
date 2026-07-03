// UI layer: renders state to the DOM and wires up events.
// All persistent data lives in `state` (see storage.js) and is saved after every mutation.

let state = loadState();
let previewPicks = null; // transient: a result being previewed from the elective list (not yet pinned)
let lastSearch = null; // last generateCombinations() output, kept so re-render doesn't require re-search

const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function persist() {
  saveState(state);
}

function coreCourses() {
  return state.courses.filter(c => c.type === 'core');
}
function electiveCourses() {
  return state.courses.filter(c => c.type === 'elective');
}

function chosenCoreSection(course) {
  if (!state.coreSelections) state.coreSelections = {};
  const sectionId = state.coreSelections[course.id];
  return course.sections.find(s => s.id === sectionId) || course.sections[0] || null;
}

function corePicks() {
  return coreCourses()
    .map(c => {
      const section = chosenCoreSection(c);
      return section ? { course: c, section } : null;
    })
    .filter(Boolean);
}

// ---------- Rendering: course list ----------

function courseCardHtml(course) {
  const badge = course.type === 'core' ? 'Core (required)' : 'Elective';
  const sectionsHtml = course.sections.map(s => {
    const days = s.days.join(' ');
    return `<li class="section-row">
      <span class="section-swatch" style="background:${course.color}"></span>
      <span class="section-label">${escapeHtml(s.label || 'Section')}</span>
      <span class="section-meta">${days} &middot; ${s.start}&ndash;${s.end}${s.location ? ' &middot; ' + escapeHtml(s.location) : ''}</span>
    </li>`;
  }).join('');

  let coreSelector = '';
  if (course.type === 'core' && course.sections.length > 1) {
    const options = course.sections.map(s => `<option value="${s.id}">${escapeHtml(s.label || 'Section')} (${s.days.join(' ')} ${s.start}-${s.end})</option>`).join('');
    const current = chosenCoreSection(course)?.id || '';
    coreSelector = `<label class="core-select-label">Section used:
      <select class="core-section-select" data-course-id="${course.id}">${options}</select>
    </label>`;
  }

  return `<div class="course-card" data-course-id="${course.id}" style="border-left-color:${course.color}">
    <div class="course-card-header">
      <div>
        <span class="course-code">${escapeHtml(course.code || '')}</span>
        <span class="course-name">${escapeHtml(course.name)}</span>
        <span class="type-badge type-${course.type}">${badge}</span>
      </div>
      <div class="course-card-actions">
        <button class="btn btn-small btn-edit" data-action="edit-course" data-course-id="${course.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-action="delete-course" data-course-id="${course.id}">Delete</button>
      </div>
    </div>
    ${course.instructor ? `<div class="course-instructor">${escapeHtml(course.instructor)}</div>` : ''}
    ${coreSelector}
    <ul class="section-list">${sectionsHtml || '<li class="section-row section-empty">No sections yet</li>'}</ul>
  </div>`;
}

function renderCourseList() {
  const list = el('#course-list');
  if (state.courses.length === 0) {
    list.innerHTML = `<p class="empty-hint">No courses yet. Add your core (required) courses first, then add electives you're considering.</p>`;
    return;
  }
  const core = coreCourses();
  const electives = electiveCourses();
  let html = '';
  if (core.length) html += `<h3 class="course-group-heading">Core</h3>` + core.map(courseCardHtml).join('');
  if (electives.length) html += `<h3 class="course-group-heading">Electives</h3>` + electives.map(courseCardHtml).join('');
  list.innerHTML = html;
}

// ---------- Rendering: calendar ----------

const RANGE_START = 7 * 60; // 07:00
const RANGE_END = 21 * 60; // 21:00
const PX_PER_MIN = 1;

function calendarDays() {
  return state.showWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);
}

function renderCalendar(picks) {
  const days = calendarDays();
  let minStart = RANGE_START, maxEnd = RANGE_END;
  for (const { section } of picks) {
    minStart = Math.min(minStart, timeToMinutes(section.start));
    maxEnd = Math.max(maxEnd, timeToMinutes(section.end));
  }
  const totalMin = maxEnd - minStart;
  const height = totalMin * PX_PER_MIN;

  const hourLines = [];
  for (let t = Math.ceil(minStart / 60) * 60; t <= maxEnd; t += 60) {
    const top = (t - minStart) * PX_PER_MIN;
    hourLines.push(`<div class="hour-line" style="top:${top}px"><span>${formatMinutes(t)}</span></div>`);
  }

  const dayColumns = days.map(day => {
    const blocks = picks
      .filter(p => p.section.days.includes(day))
      .map(p => {
        const top = (timeToMinutes(p.section.start) - minStart) * PX_PER_MIN;
        const h = (timeToMinutes(p.section.end) - timeToMinutes(p.section.start)) * PX_PER_MIN;
        return `<div class="cal-block" style="top:${top}px;height:${h}px;background:${p.course.color}" title="${escapeHtml(p.course.name)}">
          <div class="cal-block-title">${escapeHtml(p.course.code || p.course.name)}</div>
          <div class="cal-block-meta">${p.section.start}&ndash;${p.section.end}${p.section.location ? '<br>' + escapeHtml(p.section.location) : ''}</div>
        </div>`;
      }).join('');
    return `<div class="cal-day-col" data-day="${day}">${blocks}</div>`;
  }).join('');

  el('#calendar').innerHTML = `
    <div class="cal-header-row">
      <div class="cal-gutter"></div>
      ${days.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
    </div>
    <div class="cal-body" style="height:${height}px">
      <div class="cal-gutter">${hourLines.join('')}</div>
      <div class="cal-grid" style="grid-template-columns:repeat(${days.length},1fr)">${dayColumns}</div>
    </div>`;
}

// ---------- Conflict banner ----------

function updateConflictBanner() {
  const banner = el('#conflict-banner');
  const conflicts = findConflicts(corePicks());
  if (conflicts.length === 0) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  const items = conflicts.map(([a, b]) =>
    `<li>${escapeHtml(a.course.name)} (${a.section.label}) overlaps ${escapeHtml(b.course.name)} (${b.section.label})</li>`
  ).join('');
  banner.innerHTML = `<strong>Your core courses conflict with each other</strong> — fix these before electives can be deconflicted:<ul>${items}</ul>`;
}

// ---------- Elective pool + results ----------

function renderElectivePool() {
  const pool = el('#elective-pool');
  const electives = electiveCourses();
  if (electives.length === 0) {
    pool.innerHTML = `<p class="empty-hint">Add elective courses above to start deconflicting.</p>`;
    return;
  }
  if (!state.electivePool || state.electivePool.length === 0) {
    state.electivePool = electives.map(c => c.id);
  }
  pool.innerHTML = `<p class="pool-label">Consider these electives:</p>` + electives.map(c => {
    const checked = state.electivePool.includes(c.id) ? 'checked' : '';
    return `<label class="pool-item">
      <input type="checkbox" class="elective-pool-check" data-course-id="${c.id}" ${checked} />
      <span class="section-swatch" style="background:${c.color}"></span>
      ${escapeHtml(c.code ? c.code + ' — ' : '')}${escapeHtml(c.name)}
      <span class="pool-item-sections">(${c.sections.length} section${c.sections.length === 1 ? '' : 's'})</span>
    </label>`;
  }).join('');
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
    summary.innerHTML = `<p class="empty-hint">No conflict-free combination found for that many electives. Try lowering the target, adding more sections, or widening the elective pool.</p>`;
    list.innerHTML = '';
    return;
  }
  summary.innerHTML = `<p>${results.length} valid combination${results.length === 1 ? '' : 's'} found${truncated ? ' (search truncated — narrow your elective pool for a full search)' : ''}. Showing top ${Math.min(50, results.length)}.</p>`;

  list.innerHTML = results.slice(0, 50).map((r, i) => {
    const electivePicks = r.picks.filter(p => p.course.type === 'elective');
    const names = electivePicks.map(p => `${escapeHtml(p.course.code || p.course.name)} (${escapeHtml(p.section.label)})`).join(', ');
    const m = r.metrics;
    return `<div class="result-card" data-result-index="${i}">
      <div class="result-main">
        <strong>#${i + 1}</strong> ${names || '<em>no electives</em>'}
      </div>
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
  const target = parseInt(el('#elective-target').value, 10) || 0;
  state.electiveTarget = target;
  const sortMode = el('#sort-mode').value;
  state.sortMode = sortMode;
  persist();

  const pool = electiveCourses().filter(c => state.electivePool.includes(c.id));
  // Lock each core course to its currently chosen section so the search doesn't
  // second-guess a mandatory course's schedule while placing electives around it.
  const fixedCore = corePicks().map(p => ({ ...p.course, sections: [p.section] }));
  const search = generateCombinations(fixedCore, pool, target, sortMode);
  lastSearch = search;
  renderResults(search);
}

function applyPreview(index) {
  if (!lastSearch) return;
  const result = lastSearch.results[index];
  if (!result) return;
  previewPicks = result.picks;
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
  return corePicks();
}

function refreshAll() {
  renderCourseList();
  renderElectivePool();
  updateConflictBanner();
  renderCalendar(currentDisplayPicks());
  renderResults(lastSearch);
}

// ---------- Course modal ----------

const DAY_LABELS = DAY_ORDER;

function openCourseModal(existing) {
  const isEdit = !!existing;
  const course = existing || { id: null, code: '', name: '', type: 'core', instructor: '', sections: [] };
  const sections = course.sections.length ? course.sections : [{ id: null, label: 'Section 01', days: [], start: '09:00', end: '10:15', location: '' }];

  const root = el('#modal-root');
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
          <label class="radio-label"><input type="radio" name="type" value="core" ${course.type === 'core' ? 'checked' : ''}/> Core (required)</label>
          <label class="radio-label"><input type="radio" name="type" value="elective" ${course.type === 'elective' ? 'checked' : ''}/> Elective</label>
          <label>Instructor<input type="text" name="instructor" value="${escapeAttr(course.instructor || '')}" /></label>
        </div>
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
    container.insertAdjacentHTML('beforeend', sectionRowHtml({ id: null, label: `Section ${container.children.length + 1}`, days: [], start: '09:00', end: '10:15', location: '' }));
  });

  root.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay' || e.target.id === 'btn-cancel-modal') closeModal();
    if (e.target.matches('.btn-remove-section')) {
      e.target.closest('.section-form-row').remove();
    }
  });

  el('#course-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCourseFromForm(course.id);
  });
}

function sectionRowHtml(s) {
  const dayBoxes = DAY_LABELS.map(d =>
    `<label class="day-box"><input type="checkbox" value="${d}" ${s.days.includes(d) ? 'checked' : ''}/>${d}</label>`
  ).join('');
  return `<div class="section-form-row" data-section-id="${s.id || ''}">
    <div class="form-row">
      <label>Label<input type="text" class="sec-label" value="${escapeAttr(s.label)}" /></label>
      <label>Start<input type="time" class="sec-start" value="${s.start}" required /></label>
      <label>End<input type="time" class="sec-end" value="${s.end}" required /></label>
      <label>Location<input type="text" class="sec-location" value="${escapeAttr(s.location || '')}" /></label>
      <button type="button" class="btn btn-small btn-danger btn-remove-section">Remove</button>
    </div>
    <div class="day-picker">${dayBoxes}</div>
  </div>`;
}

function saveCourseFromForm(existingId) {
  const form = el('#course-form');
  const code = form.code.value.trim();
  const name = form.name.value.trim();
  const type = form.type.value;
  const instructor = form.instructor.value.trim();
  const errorEl = el('#form-error');

  const sectionRows = els('.section-form-row');
  const sections = [];
  for (const row of sectionRows) {
    const label = el('.sec-label', row).value.trim() || 'Section';
    const start = el('.sec-start', row).value;
    const end = el('.sec-end', row).value;
    const location = el('.sec-location', row).value.trim();
    const days = els('.day-box input:checked', row).map(cb => cb.value);
    if (!start || !end) { errorEl.hidden = false; errorEl.textContent = 'Every section needs a start and end time.'; return; }
    if (timeToMinutes(start) >= timeToMinutes(end)) { errorEl.hidden = false; errorEl.textContent = `Section "${label}" must end after it starts.`; return; }
    if (days.length === 0) { errorEl.hidden = false; errorEl.textContent = `Section "${label}" needs at least one day.`; return; }
    const existingSectionId = row.dataset.sectionId || null;
    sections.push({ id: existingSectionId || uid(), label, start, end, location, days });
  }
  if (sections.length === 0) { errorEl.hidden = false; errorEl.textContent = 'Add at least one section.'; return; }
  if (!name) { errorEl.hidden = false; errorEl.textContent = 'Course name is required.'; return; }

  if (existingId) {
    const idx = state.courses.findIndex(c => c.id === existingId);
    const prev = state.courses[idx];
    state.courses[idx] = { ...prev, code, name, type, instructor, sections };
  } else {
    state.courses.push({ id: uid(), code, name, type, instructor, color: nextColor(state.courses), sections });
  }
  if (!state.electivePool) state.electivePool = [];
  if (type === 'elective') {
    const added = existingId ? state.courses.find(c => c.id === existingId) : state.courses[state.courses.length - 1];
    if (!state.electivePool.includes(added.id)) state.electivePool.push(added.id);
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
  if (state.electivePool) state.electivePool = state.electivePool.filter(id => id !== courseId);
  if (state.pinnedSchedule) delete state.pinnedSchedule[courseId];
  if (state.coreSelections) delete state.coreSelections[courseId];
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
      state = Object.assign(defaultState(), parsed);
      persist();
      lastSearch = null;
      previewPicks = null;
      el('#elective-target').value = state.electiveTarget;
      el('#sort-mode').value = state.sortMode;
      el('#chk-weekend').checked = !!state.showWeekend;
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

function init() {
  el('#elective-target').value = state.electiveTarget;
  el('#sort-mode').value = state.sortMode;
  el('#chk-weekend').checked = !!state.showWeekend;

  el('#btn-add-course').addEventListener('click', () => openCourseModal(null));

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
    if (e.target.matches('.core-section-select')) {
      if (!state.coreSelections) state.coreSelections = {};
      state.coreSelections[e.target.dataset.courseId] = e.target.value;
      persist();
      refreshAll();
    }
  });

  el('#elective-pool').addEventListener('change', (e) => {
    if (e.target.matches('.elective-pool-check')) {
      const id = e.target.dataset.courseId;
      if (e.target.checked) {
        if (!state.electivePool.includes(id)) state.electivePool.push(id);
      } else {
        state.electivePool = state.electivePool.filter(x => x !== id);
      }
      persist();
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

  el('#btn-load-example').addEventListener('click', () => {
    if (state.courses.length && !confirm('Replace current data with the example schedule?')) return;
    state = exampleState();
    persist();
    lastSearch = null;
    previewPicks = null;
    el('#elective-target').value = state.electiveTarget;
    refreshAll();
  });

  el('#btn-export').addEventListener('click', exportJson);
  el('#btn-import').addEventListener('click', () => el('#file-import').click());
  el('#file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  el('#btn-print').addEventListener('click', () => window.print());

  el('#btn-clear-all').addEventListener('click', () => {
    if (!confirm('This deletes all courses and settings. Continue?')) return;
    clearState();
    state = defaultState();
    lastSearch = null;
    previewPicks = null;
    el('#elective-target').value = state.electiveTarget;
    refreshAll();
  });

  refreshAll();
}

document.addEventListener('DOMContentLoaded', init);
