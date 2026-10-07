// Verse addressing. Every verse has a global id 0..TOTAL-1 in canonical order;
// everything persisted (bookmarks, links, log) keys on these ids.
// Book, chapter and verse indices are 0-based internally.
import { BOOKS } from './canon-data.js';

export { BOOKS };

export const bookStart = [];
export const chapStart = [];
let n = 0;
for (const b of BOOKS) {
  bookStart.push(n);
  chapStart.push(b.verses.map(len => { const s = n; n += len; return s; }));
}
export const TOTAL = n;
bookStart.push(TOTAL);

export const OT_BOOKS = 39;
export const chapterCount = b => BOOKS[b].verses.length;
export const vid = (b, c, v = 0) => chapStart[b][c] + v;

// Flat list of chapters for heatmap / progress: [{b, c, s, e}]
export const CHAPTERS = [];
BOOKS.forEach((bk, b) => bk.verses.forEach((len, c) => {
  const s = chapStart[b][c];
  CHAPTERS.push({ b, c, s, e: s + len - 1 });
}));

function bsearch(arr, id) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= id) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function locate(id) {
  const b = bsearch(bookStart, id);
  const c = bsearch(chapStart[b], id);
  return { b, c, v: id - chapStart[b][c] };
}

export const clampId = id => Math.max(0, Math.min(TOTAL - 1, id));

export function fmtRef(id, abbr = false) {
  const { b, c, v } = locate(id);
  return `${abbr ? BOOKS[b].abbr : BOOKS[b].name} ${c + 1}:${v + 1}`;
}

export function fmtRange(s, e = s, abbr = false) {
  if (e < s) [s, e] = [e, s];
  const A = locate(s), B = locate(e);
  const name = b => abbr ? BOOKS[b].abbr : BOOKS[b].name;
  if (s === e) return fmtRef(s, abbr);
  if (A.b !== B.b) return `${fmtRef(s, abbr)} – ${fmtRef(e, abbr)}`;
  // whole chapters read as "John 3" / "John 3–4"
  const wholeStart = A.v === 0, wholeEnd = B.v === BOOKS[B.b].verses[B.c] - 1;
  if (wholeStart && wholeEnd) {
    return A.c === B.c ? `${name(A.b)} ${A.c + 1}` : `${name(A.b)} ${A.c + 1}–${B.c + 1}`;
  }
  if (A.c === B.c) return `${name(A.b)} ${A.c + 1}:${A.v + 1}–${B.v + 1}`;
  return `${name(A.b)} ${A.c + 1}:${A.v + 1}–${B.c + 1}:${B.v + 1}`;
}

// Short label for tight spaces: "Rom 8"
export function shortRef(id) {
  const { b, c } = locate(id);
  return `${BOOKS[b].abbr} ${c + 1}`;
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BOOK_KEYS = BOOKS.map(b => [norm(b.name), norm(b.abbr)]);
const ALIASES = { psalm: 18, song: 21, songofsolomon: 21, canticles: 21, jn: 42, jhn: 42, mk: 40, mrk: 40, lk: 41, mt: 39, rv: 65, revelations: 65 };

const isSubseq = (k, n) => { let j = 0; for (const ch of n) if (ch === k[j]) j++; return j === k.length; };

export function findBook(q) {
  const k = norm(q);
  if (!k) return -1;
  if (k in ALIASES) return ALIASES[k];
  let i = BOOK_KEYS.findIndex(([n, a]) => n === k || a === k);
  if (i < 0) i = BOOK_KEYS.findIndex(([n]) => n.startsWith(k));
  if (i < 0) i = BOOK_KEYS.findIndex(([n, a]) => a.startsWith(k));
  // subsequence fallback: "2jn" → 2 John, "phm" → Philemon
  if (i < 0) i = BOOK_KEYS.findIndex(([n]) => n[0] === k[0] && isSubseq(k, n));
  return i;
}

// "jn 3:16-18", "1 cor 13", "ps 23:1-24:2", "gen" → {s, e} or null
export function parseRef(str) {
  const m = str.trim().match(/^(\d?\s*[a-z][a-z .]*?)\s*(\d+)?(?:[:.](\d+))?(?:\s*[-–]\s*(\d+)(?:[:.](\d+))?)?$/i);
  if (!m) return null;
  const b = findBook(m[1]);
  if (b < 0) return null;
  const nc = chapterCount(b);
  // single-chapter books: "jude 3" means verse 3
  if (nc === 1 && m[2] && !m[3]) { m[3] = m[2]; m[2] = '1'; }
  const c1 = m[2] ? Math.min(+m[2], nc) - 1 : 0;
  const vlen = c => BOOKS[b].verses[c];
  let v1 = m[3] ? Math.min(+m[3], vlen(c1)) - 1 : 0;
  let c2 = c1, v2;
  if (m[4] && m[5]) { c2 = Math.min(+m[4], nc) - 1; v2 = Math.min(+m[5], vlen(c2)) - 1; }
  else if (m[4] && m[3]) v2 = Math.min(+m[4], vlen(c1)) - 1;
  else if (m[4]) { c2 = Math.min(+m[4], nc) - 1; v2 = vlen(c2) - 1; }
  else if (m[3]) v2 = v1;
  else if (m[2]) v2 = vlen(c1) - 1;
  else { v2 = 0; }
  const s = vid(b, c1, Math.max(0, v1)), e = vid(b, c2, Math.max(0, v2));
  return { s: Math.min(s, e), e: Math.max(s, e) };
}

export const overlaps = (s1, e1, s2, e2) => s1 <= e2 && s2 <= e1;
