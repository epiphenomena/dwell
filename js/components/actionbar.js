// Selection actions. While verses are selected this bar covers the top bar:
// tap a pin to place it on the selection, or Link then a pin to make a
// cross reference with that pin's passage. The asterisk stars the passage.
import { h, svg, ICONS } from '../dom.js';
import { fmtRange } from '../canon.js';
import { store } from '../store.js';

export function initActionBar(el, { reader, dock, onStar, onTag, onNote, onCopy, onInfo }) {
  let mode = 'place';
  const ref = h('button', { class: 'actionbar__ref', onclick: () => onInfo(reader.selection) });
  const starBtn = h('button', { class: 'actionbar__btn actionbar__star', 'aria-label': 'Star', 'aria-pressed': 'false', onclick: () => onStar(reader.selection) }, svg(ICONS.star));
  const linkBtn = h('button', { class: 'actionbar__btn', 'aria-label': 'Cross reference with a pin', onclick: () => setMode(mode === 'link' ? 'place' : 'link') }, svg(ICONS.link));
  el.append(
    h('button', { class: 'actionbar__btn', 'aria-label': 'Clear selection', onclick: () => reader.clearSelection() }, svg(ICONS.close)),
    h('div', { class: 'actionbar__main' }, ref),
    starBtn,
    linkBtn,
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
    if (!sel) { setMode('place'); dock.setMode(''); return; }
    const a = store.annotations(sel.s, sel.e);
    const n = a.groups.length + a.notes.length;
    starBtn.classList.toggle('is-on', a.stars.length > 0);
    starBtn.setAttribute('aria-pressed', String(a.stars.length > 0));
    starBtn.setAttribute('aria-label', a.stars.length ? 'Unstar' : 'Star');
    ref.replaceChildren(fmtRange(sel.s, sel.e, true), n ? h('span', { class: 'actionbar__count' }, n) : '');
    setMode(mode);
  }

  reader.addEventListener('select', e => render(e.detail));
  store.addEventListener('change', () => reader.selection && render(reader.selection));

  return { get mode() { return mode; }, setMode };
}
