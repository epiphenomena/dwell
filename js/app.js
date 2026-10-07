// Wires the reader, chrome and panels together.
import { Reader } from './reader.js';
import { fmtRange, fmtRef, clampId, overlaps } from './canon.js';
import { store, PIN_NAMES } from './store.js';
import { trackReading, jump, back, forward } from './history.js';
import { closeAllSheets, topSheet, toast } from './sheet.js';
import { passageText, version, setVersion, prefetchVersions, purgeLicensed } from './text.js';
import * as acct from './account.js';
import { $, longPress } from './dom.js';
import { initDock } from './components/dock.js';
import { initLocator } from './components/locator.js';
import { initActionBar } from './components/actionbar.js';
import { openNavigator } from './components/navigator.js';
import { openHistory } from './components/history-view.js';
import { openInfo } from './components/info.js';
import { openTagPicker } from './components/tags.js';
import { openNote, setNotesReader } from './components/notes.js';
import { openMenu } from './components/menu.js';
import { openSearch } from './components/search.js';
import sync, { initSync, syncNow } from './sync.js';

await store.load();
// Opened from a sign-in email: sign in before anything reads the account.
await acct.takeLinkToken();
await initSync();
navigator.storage?.persist?.().catch(() => {});

const reader = new Reader($('#reader'));
setNotesReader(reader);

// Jump from anywhere (panels, pins, heatmap): close panels, then go.
function go(id, opts = { flash: true }) {
  closeAllSheets();
  reader.clearSelection();
  return jump(clampId(id), opts);
}

// ---- settings → presentation ----
let layoutKey = '', versionId = null;
function applySettings() {
  const s = store.settings;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.font = s.font;
  document.documentElement.style.setProperty('--text-size', `${s.textSize}px`);
  document.documentElement.style.setProperty('--text-leading', s.leading);
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  // Re-paginating a long book takes a moment; only do it when layout changed.
  const key = JSON.stringify([s.textSize, s.leading, s.lines, s.chapterBreak, s.numbers, s.headings, s.font]);
  if (key !== layoutKey) {
    const fontChanged = layoutKey && JSON.parse(layoutKey)[6] !== s.font;
    layoutKey = key;
    const apply = () => reader.setOptions({ lines: s.lines, chapterBreak: s.chapterBreak, numbers: s.numbers, headings: s.headings });
    // A newly used face may still be loading; measure pages once it's in.
    if (fontChanged) document.fonts.ready.then(apply); else apply();
  }
  keepAwake(s.keepAwake);
  const v = setVersion(s.version).id;
  if (versionId && v !== versionId) reader.reload();
  versionId = v;
}

// ---- keep the screen on (where the browser can) ----
let wakeLock = null, wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  if (!('wakeLock' in navigator)) return;
  if (on && !wakeLock && document.visibilityState === 'visible') {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* refused (battery saver, etc.) */ }
  } else if (!on && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
// The lock is dropped whenever the app is hidden; take it again on return.
document.addEventListener('visibilitychange', () => { if (wantAwake) keepAwake(true); });

// ---- decorations: star and pin underlines + annotation markers ----
reader.decorator = (s, e) => {
  const pins = new Map(), xref = new Set(), note = new Set(), star = new Set();
  store.pins.forEach((p, i) => {
    if (p.s == null || !overlaps(s, e, p.s, p.e)) return;
    for (let id = Math.max(s, p.s); id <= Math.min(e, p.e); id++) {
      if (!pins.has(id)) pins.set(id, []);
      pins.get(id).push(i);
    }
  });
  const mark = (set, a, b) => { if (overlaps(s, e, a, b)) for (let id = Math.max(s, a); id <= Math.min(e, b); id++) set.add(id); };
  for (const g of store.groups) for (const r of g.refs) mark(xref, r.s, r.e);
  for (const n of store.notes) for (const r of n.links) mark(note, r.s, r.e);
  for (const x of store.stars) mark(star, x.s, x.e);
  return { pins, xref, note, star };
};

store.addEventListener('change', e => {
  if (e.detail === 'settings') applySettings();
  if (['pins', 'groups', 'notes', 'stars'].includes(e.detail)) reader.decorate();
  if (e.detail === 'nav') updateNavButtons();
});

// ---- top bar ----
const btnBack = $('#btn-back'), btnFwd = $('#btn-fwd');
function updateNavButtons() {
  btnBack.disabled = !store.nav.back.length;
  btnFwd.disabled = !store.nav.fwd.length;
}
btnBack.addEventListener('click', () => back());
btnFwd.addEventListener('click', () => forward());
longPress(btnBack, () => openHistory({ go, tab: 'timeline' }));
$('#btn-nav').addEventListener('click', () => openNavigator({ reader, go }));
$('#btn-search').addEventListener('click', () => openSearch({ reader, go }));
$('#btn-menu').addEventListener('click', () => openMenu({ go, toggleFullscreen }));

reader.addEventListener('marker', e => openInfo({ s: e.detail, e: e.detail }, { go }));

// Swipe up: carry on with the latest note (or start one). Swipe down: the timeline.
reader.addEventListener('swipe', e => {
  if (topSheet()) return;
  reader.clearSelection();
  if (e.detail === 'up') {
    const latest = store.notes.reduce((a, n) => (!a || n.updated > a.updated ? n : a), null);
    if (latest) openNote(latest, { go, resume: true });
    else openNote(store.addNote(), { go, isNew: true });
  } else openHistory({ go, tab: 'timeline' });
});
// No browser menus or lookups from holding on the text.
$('#reader').addEventListener('contextmenu', e => e.preventDefault());

reader.addEventListener('page', e => {
  const { s, e: end } = e.detail;
  $('#page-ref').textContent = fmtRange(s, end);
});

// ---- pins ----
const dock = initDock($('#dock'), {
  reader,
  onTap(i) {
    const pin = store.pins[i];
    const sel = reader.selection;
    if (sel && actionbar.mode === 'link') {
      if (pin.s == null) return;
      store.addLink(sel, pin);
      toast(`Linked ${fmtRange(sel.s, sel.e, true)} ↔ ${fmtRange(pin.s, pin.e, true)}`);
      reader.clearSelection();
    } else if (sel) {
      store.placePin(i, sel.s, sel.e);
      reader.clearSelection();
      toast(`Pinned ${fmtRange(sel.s, sel.e, true)}`);
    } else if (pin.s != null) {
      go(pin.s, { flash: pin.e });
    }
  },
  // Holding a pin clears it.
  onHold(i) {
    const pin = store.pins[i];
    if (pin.s == null) return;
    const ref = fmtRange(pin.s, pin.e, true);
    store.turnOffPin(i);
    toast(`Cleared ${PIN_NAMES[i].toLowerCase()} pin (${ref})`);
  },
  onRibbonTap() {
    const sel = reader.selection;
    const r = store.ribbon.id;
    if (sel) {
      store.setRibbon(sel.s);
      reader.clearSelection();
      toast(`Ribbon moved to ${fmtRef(sel.s, true)}`);
    } else if (r == null) {
      store.setRibbon(reader.anchor);
      toast('Ribbon placed here');
    } else if (r >= reader.range.s && r <= reader.range.e) {
      // already here
    } else {
      go(r, { flash: false });
    }
  },
  onRibbonHold() {
    store.setRibbon(reader.anchor);
    toast(`Ribbon moved to ${fmtRef(reader.anchor, true)}`);
  },
});

// The ribbon travels with you: turning forward from the page it's on carries
// it to the next page. Going back, or reading elsewhere, leaves it in place.
let lastPage = null;
reader.addEventListener('page', e => {
  const cur = e.detail, r = store.ribbon.id;
  if (r != null && lastPage && r >= lastPage.s && r <= lastPage.e && cur.s > lastPage.s && cur.s <= lastPage.e + 1) {
    store.setRibbon(reader.anchor);
  }
  lastPage = cur;
});

const actionbar = initActionBar($('#actionbar'), {
  reader, dock,
  onStar(sel) {
    store.toggleStar(sel.s, sel.e);
    reader.clearSelection();
  },
  onTag: sel => openTagPicker(sel),
  onNote: sel => { openNote(store.addNote([{ s: sel.s, e: sel.e }]), { go, isNew: true }); reader.clearSelection(); },
  onInfo: sel => openInfo(sel, { go }),
  async onCopy(sel) {
    const text = await passageText(sel.s, sel.e, { numbers: false });
    try {
      await navigator.clipboard.writeText(`${text}\n— ${fmtRange(sel.s, sel.e)} (${version().abbr})`);
      toast('Copied');
    } catch { toast('Copy not available'); }
    reader.clearSelection();
  },
});

initLocator($('#locator'), {
  reader,
  onOpen: () => openNavigator({ reader, go }),
  onScrubStart: () => {
    const { back } = store.nav;
    if (back[back.length - 1] !== reader.anchor) back.push(reader.anchor);
    store.nav.fwd = [];
    store.save('nav');
  },
});

// ---- fullscreen ----
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return toast('Fullscreen isn’t available here — add Dwell to your home screen');
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
$('#reader').addEventListener('pointerup', () => {
  if (store.settings.autoFullscreen && coarse && !standalone && !document.fullscreenElement && document.fullscreenEnabled) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
}, { once: true });

// ---- keyboard ----
addEventListener('keydown', e => {
  const sheet = topSheet();
  if (e.key === 'Escape') {
    if (sheet) sheet.close();
    else reader.clearSelection();
    return;
  }
  if (e.target.closest('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (sheet) return;
  const k = e.key;
  if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'l') { e.preventDefault(); reader.next(); }
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'h') { e.preventDefault(); reader.prev(); }
  else if (k === 'g') { e.preventDefault(); openNavigator({ reader, go }); }
  else if (k === '/') { e.preventDefault(); openSearch({ reader, go }); }
  else if (k === '[') back();
  else if (k === ']') forward();
  else if (k === 'f') toggleFullscreen();
  else if (/^[1-8]$/.test(k)) $(`#dock .pin[data-i="${+k - 1}"]`).click();
});

// ---- account ----
// A sign-in link opened while the app is already open in this tab.
addEventListener('hashchange', () => acct.takeLinkToken());
// Which versions may be read depends on the account; licensed text is kept
// offline for an owner and dropped when signing out.
let wasSignedIn = acct.signedIn();
acct.account.addEventListener('change', () => {
  applySettings();
  if (acct.signedIn()) prefetchVersions();
  else if (wasSignedIn) purgeLicensed();
  wasSignedIn = acct.signedIn();
});

// ---- sync ----
// Another device's reading position is adopted only if this session hasn't
// moved yet (one page shown since launch).
let pagesShown = 0;
reader.addEventListener('page', () => pagesShown++);
sync.addEventListener('position', e => {
  if (pagesShown <= 1 && !topSheet() && e.detail !== reader.anchor) reader.goTo(clampId(e.detail));
});
sync.addEventListener('status', e => $('#btn-menu').classList.toggle('has-alert', !!e.detail.error));

// ---- start ----
trackReading(reader);
applySettings();
updateNavButtons();
await document.fonts.ready;
await reader.goTo(clampId(store.position ?? 0));
// Confirm the account (and its versions) once the text is up.
acct.refresh();

syncNow();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
}

window.dwell = { reader, store };
