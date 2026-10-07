// Reading recency, derived from the per-verse last-read tables. Each
// function takes the kind of reading: 'ribbon', 'other' or 'all'.
import { store } from './store.js';
import { CHAPTERS, BOOKS, bookStart } from './canon.js';

const DAY = 86400000;

export const WINDOWS = [
  { days: 7, label: 'Week' },
  { days: 30, label: 'Month' },
  { days: 90, label: '3 months' },
  { days: 365, label: 'Year' },
  { days: 0, label: 'Ever' },
];

// 0 = not read in window; otherwise 1 (just now) fading to 0.25 at the window edge.
function verseValue(last, id, now, win) {
  const t = last[id];
  if (!t) return 0;
  if (!win) return 1;
  const age = now - t;
  return age > win ? 0 : 1 - 0.75 * (age / win);
}

function meanOver(last, s, e, now, win) {
  let sum = 0;
  for (let id = s; id <= e; id++) sum += verseValue(last, id, now, win);
  return sum / (e - s + 1);
}

export function chapterHeat(days, kind = 'all') {
  const now = Date.now(), win = days * DAY, last = store.lastRead[kind];
  return CHAPTERS.map(ch => meanOver(last, ch.s, ch.e, now, win));
}

export function bookHeat(days, kind = 'all') {
  const now = Date.now(), win = days * DAY, last = store.lastRead[kind];
  return BOOKS.map((_, b) => meanOver(last, bookStart[b], bookStart[b + 1] - 1, now, win));
}

export function coverage(days, kind = 'all') {
  const now = Date.now(), win = days * DAY, last = store.lastRead[kind];
  let n = 0;
  for (let id = 0; id < last.length; id++) {
    const t = last[id];
    if (t && (!win || now - t <= win)) n++;
  }
  return n / last.length;
}

export function level(v) {
  if (v <= 0) return 0;
  if (v < 0.25) return 1;
  if (v < 0.5) return 2;
  if (v < 0.8) return 3;
  return 4;
}

// Local calendar day number, so a streak follows the reader's own midnight.
const dayNo = t => {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};

// Days in a row with reading at the ribbon. The current streak is still
// alive until today ends unread: it counts through yesterday if today has
// nothing yet.
export function ribbonStreak(now = Date.now()) {
  const days = [...new Set(store.entries('ribbon').map(e => dayNo(e.t)))].sort((a, b) => a - b);
  let longest = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev != null && d === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const today = dayNo(now);
  const current = prev === today || prev === today - 1 ? run : 0;
  return { current, longest, today: prev === today, days: days.length };
}
