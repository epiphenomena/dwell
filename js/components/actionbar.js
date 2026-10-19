// Selection actions. While verses are selected this bar covers the top bar.
// Selecting starts in Link: tap a pin that's on to cross reference the
// selection with its passage, or an off pin to place it there. Turn Link off
// to move a pin that's on. The asterisk stars the passage; the book opens it
// in Blue Letter Bible.
import { h, svg, ICONS } from '../dom.js';
import { fmtRange, locate } from '../canon.js';
import { store } from '../store.js';
import { version } from '../text.js';

// Blue Letter Bible's book codes, in canon order. Its site has no BSB, so
// the link uses the version being read when BLB has it, otherwise the KJV.
// On Android the BLB app claims these links; on iOS they open in Safari.
const BLB_BOOKS = `gen exo lev num deu jos jdg rth 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job
  psa pro ecc sng isa jer lam eze dan hos joe amo oba jon mic nah hab zep hag zec mal
  mat mar luk jhn act rom 1co 2co gal eph phl col 1th 2th 1ti 2ti tit phm heb jas 1pe 2pe
  1jo 2jo 3jo jde rev`.split(/\s+/);
const BLB_VERSIONS = new Set(['kjv', 'nkjv', 'csb', 'net', 'esv', 'niv', 'nasb20', 'nlt']);

function blbUrl(s, e) {
  const A = locate(s), B = locate(e);
  const v = BLB_VERSIONS.has(version().id) ? version().id : 'kjv';
  // A range within one chapter shows as 16-18; otherwise the first verse.
  const verses = A.b === B.b && A.c === B.c && B.v > A.v ? `${A.v + 1}-${B.v + 1}` : A.v + 1;
  return `https://www.blueletterbible.org/${v}/${BLB_BOOKS[A.b]}/${A.c + 1}/${verses}/`;
}

export function initActionBar(el, { reader, dock, onStar, onTag, onNote, onCopy, onInfo }) {
  let mode = 'link';
  const ref = h('button', { class: 'actionbar__ref', onclick: () => onInfo(reader.selection) });
  const starBtn = h('button', { class: 'actionbar__btn actionbar__star', 'aria-label': 'Star', 'aria-pressed': 'false', onclick: () => onStar(reader.selection) }, svg(ICONS.star));
  const linkBtn = h('button', { class: 'actionbar__btn', 'aria-label': 'Cross reference with a pin', onclick: () => setMode(mode === 'link' ? 'place' : 'link') }, svg(ICONS.link));
  const blbBtn = h('a', { class: 'actionbar__btn', 'aria-label': 'Open in Blue Letter Bible', target: '_blank', rel: 'noopener' }, svg(ICONS.book));
  el.append(
    h('button', { class: 'actionbar__btn', 'aria-label': 'Clear selection', onclick: () => reader.clearSelection() }, svg(ICONS.close)),
    h('div', { class: 'actionbar__main' }, ref),
    starBtn,
    linkBtn,
    blbBtn,
    h('button', { class: 'actionbar__btn', 'aria-label': 'Tag', onclick: () => onTag(reader.selection) }, svg(ICONS.tag)),
    h('button', { class: 'actionbar__btn', 'aria-label': 'Note', onclick: () => onNote(reader.selection) }, svg(ICONS.note)),
    h('button', { class: 'actionbar__btn', 'aria-label': 'Copy', onclick: () => onCopy(reader.selection) }, svg(ICONS.copy)),
  );

  function setMode(m) {
    mode = m;
    linkBtn.classList.toggle('is-active', m === 'link');
    dock.setMode(reader.selection ? m : '');
  }

  function render(sel) {
    el.hidden = !sel;
    if (!sel) { setMode('link'); dock.setMode(''); return; }
    const a = store.annotations(sel.s, sel.e);
    const n = a.groups.length + a.notes.length;
    starBtn.classList.toggle('is-on', a.stars.length > 0);
    starBtn.setAttribute('aria-pressed', String(a.stars.length > 0));
    starBtn.setAttribute('aria-label', a.stars.length ? 'Unstar' : 'Star');
    blbBtn.href = blbUrl(sel.s, sel.e);
    ref.replaceChildren(fmtRange(sel.s, sel.e, true), n ? h('span', { class: 'actionbar__count' }, n) : '');
    setMode(mode);
  }

  reader.addEventListener('select', e => render(e.detail));
  store.addEventListener('change', () => reader.selection && render(reader.selection));

  return { get mode() { return mode; }, setMode };
}
