// Persistence layer: everything lives in localStorage under one key.
// Shape of the state document:
// {
//   courses: [{ id, code, name, type: 'core'|'elective', instructor, color,
//               sections: [{ id, label, days: ['Mon',...], start: 'HH:MM', end: 'HH:MM', location }] }],
//   electiveTarget: number,
//   electivePool: [courseId, ...],   // which elective courses are in consideration
//   sortMode: string,
//   showWeekend: boolean,
//   pinnedSchedule: { [courseId]: sectionId } | null
// }

const STORAGE_KEY = 'semestral-deconflicter/v1';

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

function defaultState() {
  return {
    courses: [],
    electiveTarget: 1,
    electivePool: [],
    sortMode: 'compact',
    showWeekend: false,
    pinnedSchedule: null,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
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
  const mk = (code, name, type, sections, instructor) => ({
    id: uid(), code, name, type, instructor, color: '', sections: sections.map(s => ({ id: uid(), ...s })),
  });

  const courses = [
    mk('CS301', 'Algorithms', 'core', [
      { label: '01', days: ['Mon', 'Wed'], start: '09:00', end: '10:15', location: 'Rm 101' },
    ], 'Dr. Novak'),
    mk('CS310', 'Operating Systems', 'core', [
      { label: '01', days: ['Tue', 'Thu'], start: '11:00', end: '12:15', location: 'Rm 204' },
    ], 'Dr. Patel'),
    mk('CS412', 'Machine Learning', 'elective', [
      { label: '01', days: ['Mon', 'Wed'], start: '10:30', end: '11:45', location: 'Rm 305' },
      { label: '02', days: ['Tue', 'Thu'], start: '14:00', end: '15:15', location: 'Rm 305' },
    ], 'Dr. Ibarra'),
    mk('CS420', 'Computer Graphics', 'elective', [
      { label: '01', days: ['Mon', 'Wed'], start: '13:00', end: '14:15', location: 'Rm 118' },
    ], 'Dr. Lund'),
    mk('CS430', 'Distributed Systems', 'elective', [
      { label: '01', days: ['Tue', 'Thu'], start: '09:30', end: '10:45', location: 'Rm 220' },
      { label: '02', days: ['Fri'], start: '09:00', end: '11:45', location: 'Rm 220' },
    ], 'Dr. Zhou'),
    mk('CS451', 'Human-Computer Interaction', 'elective', [
      { label: '01', days: ['Wed'], start: '15:00', end: '17:45', location: 'Rm 150' },
    ], 'Dr. Okafor'),
  ];

  courses.forEach((c, i) => { c.color = COLOR_PALETTE[i % COLOR_PALETTE.length]; });

  const state = defaultState();
  state.courses = courses;
  state.electiveTarget = 2;
  state.electivePool = courses.filter(c => c.type === 'elective').map(c => c.id);
  return state;
}
