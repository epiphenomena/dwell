// Unobtrusive position indicator: three hairlines — the current book
// (chapter segments), then the Old Testament and the New Testament (book
// segments). Tap to open the navigator; drag to scrub through the book.
import { h } from '../dom.js';
import { BOOKS, OT_BOOKS, bookStart, locate, fmtRef } from '../canon.js';

export function initLocator(el, { reader, onOpen, onScrubStart }) {
  const bibleSegs = BOOKS.map((b, i) => h('i', { style: { flexGrow: bookStart[i + 1] - bookStart[i] } }));
  const testaments = [[0, OT_BOOKS], [OT_BOOKS, BOOKS.length]].map(([from, to]) => ({
    from, to, s: bookStart[from], e: bookStart[to],
    mark: h('b', { class: 'locator__mark' }),
  }));
  const bookTrack = h('div', { class: 'locator__track locator__track--book' });
  const bookMark = h('b', { class: 'locator__mark' });
  const bubble = h('div', { class: 'locator__bubble' });
  el.append(
    bookTrack,
    ...testaments.map(t => h('div', { class: 'locator__track locator__track--bible' }, bibleSegs.slice(t.from, t.to), t.mark)),
    bubble,
  );

  let shownBook = -1, chapSegs = [];
  function update({ book, s }) {
    if (book !== shownBook) {
      shownBook = book;
      chapSegs = BOOKS[book].verses.map(n => h('i', { style: { flexGrow: n } }));
      bookTrack.replaceChildren(...chapSegs, bookMark);
      bibleSegs.forEach((seg, i) => seg.classList.toggle('is-current', i === book));
    }
    const { c } = locate(s);
    chapSegs.forEach((seg, i) => seg.classList.toggle('is-current', i === c));
    const bookLen = bookStart[book + 1] - bookStart[book];
    for (const t of testaments) {
      const here = book >= t.from && book < t.to;
      t.mark.hidden = !here;
      if (here) t.mark.style.left = `${((s - t.s) / (t.e - t.s)) * 100}%`;
    }
    bookMark.style.left = `${((s - bookStart[book]) / bookLen) * 100}%`;
  }
  reader.addEventListener('page', e => update(e.detail));

  // Scrubbing
  let d = null, raf = 0;
  el.addEventListener('pointerdown', e => {
    d = { x: e.clientX, scrub: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!d) return;
    if (!d.scrub && Math.abs(e.clientX - d.x) > 6) {
      d.scrub = true;
      onScrubStart?.();
      el.classList.add('is-scrubbing');
    }
    if (!d.scrub) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const p = Math.round(f * (reader.pages - 1));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (p !== reader.page) reader.showPage(p, false);
      bubble.textContent = `${fmtRef(reader.range.s)}  ·  ${p + 1}/${reader.pages}`;
      bubble.style.left = `${Math.max(15, Math.min(85, f * 100))}%`;
    });
  });
  const end = () => {
    if (!d) return;
    if (!d.scrub) onOpen();
    el.classList.remove('is-scrubbing');
    d = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') onOpen(); });
}
