// Two kinds of history:
//  - the reading log: every page that stayed on screen long enough, with
//    timestamp and duration (append-only; feeds the heatmap and timeline).
//    A page read with the reading ribbon on it is reading at the ribbon
//    (k: 1); the ribbon's history is kept apart from everything else;
//  - the nav stack: locations before each jump, for back/forward. Page
//    flips don't create nav entries, so "back" returns to where you were
//    before you went somewhere else.
import { store, MIN_DWELL, MAX_DWELL } from './store.js';
import { onSheets } from './sheet.js';

let pending = null;
let reader;

const atRibbon = (s, e) => store.ribbon.id != null && store.ribbon.id >= s && store.ribbon.id <= e;

// A page being read. The ribbon is checked when it opens (turning on from the
// ribbon's page has already carried the ribbon here) and again if the ribbon
// is placed while it's open.
const open = (t, s, e) => ({ t, s, e, k: atRibbon(s, e) });

function finalize() {
  if (!pending) return;
  const d = Date.now() - pending.t;
  const { t, s, e, k } = pending;
  if (d >= MIN_DWELL) store.addLog({ t, d: Math.min(d, MAX_DWELL), s, e, ...(k ? { k: 1 } : {}) });
  pending = null;
}

export function trackReading(r) {
  reader = r;
  r.addEventListener('page', e => {
    const { s, e: end } = e.detail;
    if (pending && pending.s === s && pending.e === end) return;
    finalize();
    if (document.visibilityState === 'visible' && !document.querySelector('.sheet')) pending = open(Date.now(), s, end);
    store.position = r.anchor;
    store.save('position');
  });
  // Time only counts while the page is actually visible: not with the app
  // in the background, and not while a panel covers the text.
  let covered = false;
  const resume = () => {
    if (!covered && document.visibilityState === 'visible' && reader.book >= 0) pending = open(Date.now(), reader.range.s, reader.range.e);
  };
  store.addEventListener('change', e => {
    if (e.detail === 'ribbon' && pending && atRibbon(pending.s, pending.e)) pending.k = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') finalize();
    else resume();
  });
  onSheets(n => {
    if (n && !covered) { covered = true; finalize(); }
    else if (!n && covered) { covered = false; resume(); }
  });
  addEventListener('pagehide', finalize);
}

const NAV_MAX = 200;

// Go somewhere new, remembering where we were.
export async function jump(id, opts = { flash: true }) {
  const here = reader.book >= 0 ? reader.anchor : null;
  if (here != null) {
    const { s, e } = reader.range;
    // Already on screen: just flash it.
    if (id >= s && id <= e && reader.pageOf(id) === reader.page) {
      if (opts.flash) reader.flash(id, opts.flash === true ? id : opts.flash);
      return;
    }
    const { back } = store.nav;
    if (back[back.length - 1] !== here) back.push(here);
    if (back.length > NAV_MAX) back.shift();
    store.nav.fwd = [];
    store.save('nav');
  }
  await reader.goTo(id, opts);
}

export async function back() {
  const { back, fwd } = store.nav;
  if (!back.length) return;
  const to = back.pop();
  fwd.push(reader.anchor);
  store.save('nav');
  await reader.goTo(to, { flash: false });
}

export async function forward() {
  const { back, fwd } = store.nav;
  if (!fwd.length) return;
  const to = fwd.pop();
  back.push(reader.anchor);
  store.save('nav');
  await reader.goTo(to, { flash: false });
}

// Group log entries into sessions of contiguous reading (gap under 10 min),
// for one kind of reading, or both.
export function sessions(kind) {
  let log = store.entries(kind);
  log = log.sort((x, y) => x.t - y.t);
  const out = [];
  let cur = null;
  for (const entry of log) {
    if (cur && entry.t - cur.end < 10 * 60 * 1000 && entry.s <= cur.e + 40 && entry.e >= cur.s - 40) {
      cur.s = Math.min(cur.s, entry.s);
      cur.e = Math.max(cur.e, entry.e);
      cur.end = entry.t + entry.d;
      cur.d += entry.d;
      cur.pages++;
      cur.last = entry.s;
    } else {
      cur = { t: entry.t, end: entry.t + entry.d, d: entry.d, s: entry.s, e: entry.e, pages: 1, last: entry.s };
      out.push(cur);
    }
  }
  return out;
}
