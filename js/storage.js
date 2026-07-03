// Persistence layer: everything lives in localStorage under one key.
//
// Shape of the state document:
// {
//   courses: [{ id, code, name, categoryIds: [catId,...], instructor, color,
//               sections: [
//                 // recurring (default): meets every week on these days within an optional sub-range
//                 { id, label, location, scheduleType: 'recurring',
//                   days: ['Mon',...], start: 'HH:MM', end: 'HH:MM',
//                   rangeStart: 'YYYY-MM-DD'|null, rangeEnd: 'YYYY-MM-DD'|null },
//                 // dates: an explicit list of one-off meetings, each with its own time —
//                 // for courses that don't follow a weekly pattern (block seminars, etc.)
//                 { id, label, location, scheduleType: 'dates',
//                   occurrences: [{ id, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }] },
//               ] }],
//   categories: [
//     { id, name, mode: 'required' },                                   // every course in it is mandatory
//     { id, name, mode: 'bucket', target: number, pool: [courseId,...] }, // choose `target` courses from `pool`
//     { id, name, mode: 'optional' },                                   // available extras, never auto-selected
//   ],
//   requiredSelections: { [courseId]: sectionId },  // which section is used for a multi-section required course
//   optionalSelections: { [courseId]: sectionId },  // courses the user has manually opted into, and which section
//   sortMode: string,
//   showWeekend: boolean,
//   semesterStart: 'YYYY-MM-DD',
//   semesterEnd: 'YYYY-MM-DD',
//   pinnedSchedule: { [courseId]: sectionId } | null
// }
//
// A course can belong to more than one category — e.g. a cross-listed
// elective that counts toward two different bucket requirements at once.

const STORAGE_KEY = 'semestral-deconflicter/v3';
const V2_STORAGE_KEY = 'semestral-deconflicter/v2';
const LEGACY_STORAGE_KEY = 'semestral-deconflicter/v1';

const COLOR_PALETTE = [
  '#4C6EF5', '#12B886', '#F76707', '#BE4BDB', '#E64980',
  '#1098AD', '#F59F00', '#7048E8', '#2F9E44', '#E03131',
];

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nextColor(existingCourses) {
  return COLOR_PALETTE[existingCourses.length % COLOR_PALETTE.length];
}

function isoDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// A sensible out-of-the-box range (today through 15 weeks out) so the
// semester calendar has something to show before the user sets real dates.
function defaultSemesterRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 15 * 7 - 1);
  return { semesterStart: isoDateStr(start), semesterEnd: isoDateStr(end) };
}

const DEFAULT_CORE_CATEGORY_ID = 'category-core';
const DEFAULT_ELECTIVE_CATEGORY_ID = 'category-electives';

function defaultState() {
  return {
    courses: [],
    categories: [
      { id: DEFAULT_CORE_CATEGORY_ID, name: 'Core', mode: 'required' },
      { id: DEFAULT_ELECTIVE_CATEGORY_ID, name: 'Electives', mode: 'bucket', target: 1, pool: [] },
    ],
    requiredSelections: {},
    optionalSelections: {},
    poolSectionSelections: {},
    sortMode: 'compact',
    showWeekend: false,
    pinnedSchedule: null,
    ...defaultSemesterRange(),
  };
}

// Upgrades a v1 document (flat course.type: 'core'|'elective') into the
// current category model, mapping 'core' -> the default Core category and
// 'elective' -> the default Electives bucket.
function migrateV1(v1) {
  const state = defaultState();
  const electiveCategory = state.categories[1];
  state.courses = (v1.courses || []).map(c => ({
    id: c.id,
    code: c.code,
    name: c.name,
    categoryIds: [c.type === 'core' ? DEFAULT_CORE_CATEGORY_ID : DEFAULT_ELECTIVE_CATEGORY_ID],
    instructor: c.instructor,
    color: c.color,
    sections: c.sections,
  }));
  electiveCategory.pool = state.courses.filter(c => c.categoryIds.includes(DEFAULT_ELECTIVE_CATEGORY_ID)).map(c => c.id);
  electiveCategory.target = v1.electiveTarget ?? 1;
  state.requiredSelections = v1.coreSelections || {};
  state.sortMode = v1.sortMode || 'compact';
  state.showWeekend = !!v1.showWeekend;
  state.pinnedSchedule = v1.pinnedSchedule || null;
  return state;
}

// Upgrades a v2 document (single course.categoryId string) to v3
// (course.categoryIds array), preserving everything else as-is.
function migrateV2(v2) {
  const migrated = { ...v2 };
  migrated.courses = (v2.courses || []).map(c => {
    const { categoryId, ...rest } = c;
    return { ...rest, categoryIds: categoryId ? [categoryId] : [] };
  });
  migrated.optionalSelections = {};
  return migrated;
}

function normalize(state) {
  const merged = Object.assign(defaultState(), state);
  merged.categories = (merged.categories && merged.categories.length) ? merged.categories : defaultState().categories;
  merged.categories.forEach(cat => {
    if (cat.mode === 'bucket') {
      cat.pool = cat.pool || [];
      cat.target = cat.target ?? 1;
    }
  });
  merged.courses = (merged.courses || []).map(c => {
    const course = c.categoryIds ? c : { ...c, categoryIds: c.categoryId ? [c.categoryId] : [] };
    course.sections = (course.sections || []).map(s => s.scheduleType ? s : { ...s, scheduleType: 'recurring' });
    return course;
  });
  merged.requiredSelections = merged.requiredSelections || {};
  merged.optionalSelections = merged.optionalSelections || {};
  merged.poolSectionSelections = merged.poolSectionSelections || {};
  if (!merged.semesterStart || !merged.semesterEnd) {
    Object.assign(merged, defaultSemesterRange());
  }
  return merged;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
    const v2 = localStorage.getItem(V2_STORAGE_KEY);
    if (v2) return normalize(migrateV2(JSON.parse(v2)));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return normalize(migrateV1(JSON.parse(legacy)));
    return defaultState();
  } catch (e) {
    console.warn('Failed to load saved state, starting fresh.', e);
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

function exampleState() {
  const mk = (code, name, categoryIds, sections, instructor) => ({
    id: uid(), code, name, categoryIds, instructor, color: '', sections: sections.map(s => ({ id: uid(), ...s })),
  });

  const state = defaultState();
  const aiBucket = { id: uid(), name: 'AI Electives', mode: 'bucket', target: 1, pool: [] };
  const sysBucket = { id: uid(), name: 'Systems Electives', mode: 'bucket', target: 1, pool: [] };
  const funBucket = { id: uid(), name: 'Just for fun', mode: 'optional' };
  state.categories = [state.categories[0], aiBucket, sysBucket, funBucket];

  const courses = [
    mk('CS301', 'Algorithms', [DEFAULT_CORE_CATEGORY_ID], [
      { label: '01', days: ['Mon', 'Wed'], start: '09:00', end: '10:15', location: 'Rm 101' },
    ], 'Dr. Novak'),
    mk('CS310', 'Operating Systems', [DEFAULT_CORE_CATEGORY_ID], [
      { label: '01', days: ['Tue', 'Thu'], start: '11:00', end: '12:15', location: 'Rm 204' },
    ], 'Dr. Patel'),
    // Cross-listed: counts toward both the AI and Systems buckets at once if chosen.
    mk('CS412', 'Machine Learning', [aiBucket.id, sysBucket.id], [
      { label: '01', days: ['Mon', 'Wed'], start: '10:30', end: '11:45', location: 'Rm 305' },
      { label: '02', days: ['Tue', 'Thu'], start: '14:00', end: '15:15', location: 'Rm 305' },
    ], 'Dr. Ibarra'),
    mk('CS420', 'Computer Graphics', [aiBucket.id], [
      { label: '01', days: ['Mon', 'Wed'], start: '13:00', end: '14:15', location: 'Rm 118' },
    ], 'Dr. Lund'),
    mk('CS430', 'Distributed Systems', [sysBucket.id], [
      { label: '01', days: ['Tue', 'Thu'], start: '09:30', end: '10:45', location: 'Rm 220' },
      { label: '02', days: ['Fri'], start: '09:00', end: '11:45', location: 'Rm 220' },
    ], 'Dr. Zhou'),
    mk('HUM210', 'Philosophy of Technology', [funBucket.id], [
      { label: '01', days: ['Wed'], start: '15:00', end: '17:45', location: 'Rm 150' },
    ], 'Dr. Okafor'),
  ];
  courses.forEach((c, i) => { c.color = COLOR_PALETTE[i % COLOR_PALETTE.length]; });
  state.courses = courses;
  aiBucket.pool = courses.filter(c => c.categoryIds.includes(aiBucket.id)).map(c => c.id);
  sysBucket.pool = courses.filter(c => c.categoryIds.includes(sysBucket.id)).map(c => c.id);
  return state;
}
