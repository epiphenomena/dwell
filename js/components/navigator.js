// Book → chapter navigator, with a reference box ("jn 3:16") for typing.
// Tiles carry a faint recency bar from the heatmap.
import { h } from '../dom.js';
import { BOOKS, OT_BOOKS, vid, parseRef, fmtRange, locate, CHAPTERS } from '../canon.js';
import { openSheet } from '../sheet.js';
import { store } from '../store.js';
import { bookHeat, chapterHeat, level } from '../heat.js';

export function openNavigator({ reader, go }) {
  const current = reader.book >= 0 ? locate(reader.range.s) : { b: 0, c: 0 };
  const days = store.settings.heatWindow;

  const input = h('input', {
    class: 'nav__input', type: 'text', inputmode: 'search', enterkeyhint: 'go',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'Go to… e.g. jn 3:16, ps 23, rom 8:28-39',
  });
  const preview = h('div', { class: 'nav__preview' });
  input.addEventListener('input', () => {
    const r = parseRef(input.value);
    preview.textContent = r ? fmtRange(r.s, r.e) : '';
  });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const r = parseRef(input.value);
    if (r) go(r.s, { flash: r.e - r.s < 200 ? r.e : false });
  });

  const content = h('div', { class: 'nav__content' });
  const sheet = openSheet({
    title: 'Go to',
    close: 'x',
    cls: 'sheet--nav',
    body: [h('div', { class: 'nav__search' }, input, preview), content],
  });

  function books() {
    sheet.setTitle('Go to');
    const heat = bookHeat(days);
    const tile = b => h('button', {
      class: `nav__tile${b === current.b ? ' is-current' : ''}`,
      'data-heat': level(heat[b]),
      onclick: () => BOOKS[b].verses.length === 1 ? go(vid(b, 0), { flash: false }) : chapters(b),
    }, h('span', { class: 'nav__abbr' }, BOOKS[b].abbr), h('span', { class: 'nav__name' }, BOOKS[b].name));
    content.replaceChildren(
      h('h3', { class: 'nav__group' }, 'Old Testament'),
      h('div', { class: 'nav__grid' }, BOOKS.slice(0, OT_BOOKS).map((_, i) => tile(i))),
      h('h3', { class: 'nav__group' }, 'New Testament'),
      h('div', { class: 'nav__grid' }, BOOKS.slice(OT_BOOKS).map((_, i) => tile(i + OT_BOOKS))),
    );
    content.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }

  function chapters(b) {
    sheet.setTitle(BOOKS[b].name);
    const heat = chapterHeat(days);
    const first = CHAPTERS.findIndex(ch => ch.b === b);
    content.replaceChildren(
      h('button', { class: 'nav__backlink', onclick: books }, '‹ All books'),
      h('div', { class: 'nav__grid nav__grid--chapters' }, BOOKS[b].verses.map((_, c) => h('button', {
        class: `nav__tile nav__tile--chapter${b === current.b && c === current.c ? ' is-current' : ''}`,
        'data-heat': level(heat[first + c]),
        onclick: () => go(vid(b, c), { flash: false }),
      }, c + 1))),
    );
    content.scrollTop = 0;
  }

  books();
  return sheet;
}
