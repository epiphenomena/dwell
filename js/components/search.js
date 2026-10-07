// Search across the Bible text, notes, tags and pins.
// Terms match at word starts ("love" finds loved/loves, not glove); every
// term must match; "quoted phrases" match as a unit. Scope narrows to a
// testament or a book. Query, filters and scroll survive between openings
// so you can jump to a result and come back to the list.
import { h, fill, fmtDate } from '../dom.js';
import { BOOKS, OT_BOOKS, TOTAL, bookStart, locate, fmtRange, overlaps } from '../canon.js';
import { openSheet } from '../sheet.js';
import { store, PIN_NAMES } from '../store.js';
import { loadBook, version } from '../text.js';
import { openNote } from './notes.js';
import { pinIcon } from './dock.js';
import { passageRow } from './passage.js';

const TYPES = [['bible', 'Bible'], ['notes', 'Notes'], ['tags', 'Tags'], ['pins', 'Pins']];
const PAGE = 100;

const state = {
  query: '',
  scope: 'all', // all | ot | nt | book
  book: 0,
  types: new Set(TYPES.map(t => t[0])),
  scroll: 0,
};

let verses = null, loading = null, loadedFor = null; // flat verse text by global id, for one version
function allText() {
  if (loadedFor !== version().id) {
    loadedFor = version().id;
    verses = null;
    const p = loading = Promise.all(BOOKS.map((_, b) => loadBook(b))).then(books => {
      const flat = books.flat(2);
      if (flat.length !== TOTAL) console.warn('search: unexpected verse count', flat.length);
      if (loading === p) verses = flat;
      return flat;
    });
  }
  return loading;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Build one regex per term. Apostrophes match straight or curly.
function compile(query) {
  const terms = [];
  query.replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => {
    const t = (phrase ?? word).trim();
    if (t) terms.push(t);
  });
  return terms.map(t => {
    const src = escapeRe(t).replace(/['’‘]/g, "['’‘]").replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${src}`, 'giu');
  });
}

const matchesAll = (text, res) => res.every(re => { re.lastIndex = 0; return re.test(text); });

// Text with every term occurrence wrapped in <mark>.
function highlight(text, res, max = Infinity) {
  const spans = [];
  for (const re of res) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let start = 0;
  if (text.length > max && spans.length) start = Math.max(0, spans[0][0] - 40);
  const out = [];
  let pos = start;
  if (start > 0) out.push('…');
  for (const [a, b] of spans) {
    if (a < pos) continue;
    out.push(text.slice(pos, a), h('mark', {}, text.slice(a, b)));
    pos = b;
  }
  const rest = text.slice(pos);
  out.push(text.length - start > max ? rest.slice(0, Math.max(0, max - (pos - start))) + '…' : rest);
  return out;
}

function scopeRange() {
  if (state.scope === 'ot') return [0, bookStart[OT_BOOKS] - 1];
  if (state.scope === 'nt') return [bookStart[OT_BOOKS], TOTAL - 1];
  if (state.scope === 'book') return [bookStart[state.book], bookStart[state.book + 1] - 1];
  return [0, TOTAL - 1];
}

export function openSearch({ reader, go }) {
  const input = h('input', {
    class: 'nav__input', type: 'search', inputmode: 'search', enterkeyhint: 'search',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'Search the Bible, notes, tags…', value: state.query,
  });
  const scopeRow = h('div', { class: 'chips search__scope' });
  const typeRow = h('div', { class: 'chips search__types' });
  const bookPicker = h('div', { class: 'search__books', hidden: true });
  const summary = h('div', { class: 'search__summary' });
  const results = h('div', { class: 'search__results' });

  const sheet = openSheet({
    title: 'Search',
    close: 'x',
    cls: 'sheet--search',
    body: [h('div', { class: 'nav__search' }, input, scopeRow, typeRow), bookPicker, summary, results],
    onClose: () => { state.scroll = sheet.el.querySelector('.sheet__body').scrollTop; },
  });
  const scroller = sheet.el.querySelector('.sheet__body');

  const currentBook = () => (reader.book >= 0 ? reader.book : 0);

  function renderFilters() {
    const chip = (active, label, onclick) => h('button', { class: `chip${active ? ' is-active' : ''}`, onclick }, label);
    const cur = currentBook();
    const setScope = (scope, book) => { state.scope = scope; if (book != null) state.book = book; bookPicker.hidden = true; renderFilters(); run(); };
    fill(scopeRow,
      chip(state.scope === 'all', 'All', () => setScope('all')),
      chip(state.scope === 'ot', 'OT', () => setScope('ot')),
      chip(state.scope === 'nt', 'NT', () => setScope('nt')),
      chip(state.scope === 'book' && state.book === cur, BOOKS[cur].name, () => setScope('book', cur)),
      chip(state.scope === 'book' && state.book !== cur, state.scope === 'book' && state.book !== cur ? `${BOOKS[state.book].name} ▾` : 'Book ▾', () => {
        bookPicker.hidden = !bookPicker.hidden;
        if (!bookPicker.hidden) fill(bookPicker, h('div', { class: 'nav__grid' }, BOOKS.map((bk, b) => h('button', {
          class: `nav__tile${state.scope === 'book' && state.book === b ? ' is-current' : ''}`,
          onclick: () => setScope('book', b),
        }, h('span', { class: 'nav__abbr' }, bk.abbr)))));
      }),
    );
    fill(typeRow, TYPES.map(([key, label]) => chip(state.types.has(key), label, () => {
      if (state.types.has(key) && state.types.size > 1) state.types.delete(key); else state.types.add(key);
      renderFilters(); run();
    })));
  }

  let token = 0;
  async function run() {
    const query = state.query.trim();
    const my = ++token;
    if (!query) {
      fill(summary);
      fill(results);
      return;
    }
    const res = compile(query);
    const [lo, hi] = scopeRange();
    const out = [];   // your own material first: notes, tags, pins
    const bible = [];

    if (state.types.has('bible')) {
      if (!verses) fill(results, h('p', { class: 'empty' }, 'Loading the text…'));
      const text = await allText();
      if (my !== token) return;
      const hits = [];
      for (let id = lo; id <= hi; id++) if (text[id] && matchesAll(text[id], res)) hits.push(id);

      // Per-book counts double as a quick way to narrow the scope.
      const counts = new Map();
      for (const id of hits) { const { b } = locate(id); counts.set(b, (counts.get(b) || 0) + 1); }
      fill(summary,
        h('p', { class: 'search__count' }, `${hits.length.toLocaleString()} verse${hits.length === 1 ? '' : 's'}`,
          state.scope !== 'all' ? ` in ${state.scope === 'book' ? BOOKS[state.book].name : state.scope.toUpperCase()}` : ''),
        counts.size > 1 ? h('div', { class: 'search__dist' }, [...counts].map(([b, n]) => h('button', {
          class: 'search__distbtn', onclick: () => { state.scope = 'book'; state.book = b; renderFilters(); run(); },
        }, BOOKS[b].abbr, h('small', {}, n)))) : null,
      );

      const list = h('div', { class: 'list' });
      let shown = 0, lastBook = -1;
      const more = h('button', { class: 'btn btn--ghost search__more', onclick: page });
      function page() {
        for (const id of hits.slice(shown, shown + PAGE)) {
          const { b } = locate(id);
          if (b !== lastBook) { list.append(h('h3', { class: 'list__group' }, BOOKS[b].name)); lastBook = b; }
          list.append(h('button', { class: 'search__hit', onclick: () => go(id, { flash: true }) },
            h('span', { class: 'search__ref' }, fmtRange(id, id, true)),
            h('span', { class: 'search__text' }, highlight(text[id], res)),
          ));
        }
        shown += PAGE;
        more.textContent = `Show more (${(hits.length - shown).toLocaleString()} left)`;
        more.hidden = shown >= hits.length;
      }
      page();
      if (hits.length) bible.push(state.types.size > 1 ? h('h3', { class: 'search__section' }, 'Bible') : null, list, more);
    } else fill(summary);

    if (state.types.has('notes')) {
      const notes = store.notes.filter(n => matchesAll(n.body, res) &&
        (state.scope === 'all' || n.links.some(r => overlaps(lo, hi, r.s, r.e))));
      if (notes.length) out.push(h('h3', { class: 'search__section' }, `Notes · ${notes.length}`), notes.map(n => h('button', {
        class: 'search__hit', onclick: () => openNote(n, { go }),
      },
        h('span', { class: 'search__ref' }, fmtDate(n.updated)),
        h('span', { class: 'search__text search__text--ui' }, highlight(n.body.replace(/\s+/g, ' '), res, 160)),
      )));
    }

    if (state.types.has('tags')) {
      const inScope = refs => state.scope === 'all' || refs.some(r => overlaps(lo, hi, r.s, r.e));
      const tags = store.tagNames().filter(([name]) => matchesAll(name, res)).map(([name, n]) => ({
        name, n, refs: store.tag(name)?.refs ?? [], notes: store.notesTagged(name),
      })).filter(t => inScope(t.refs) || t.notes.some(note => inScope(note.links)));
      if (tags.length) out.push(h('h3', { class: 'search__section' }, `Tags · ${tags.length}`), tags.map(t => h('details', { class: 'group' },
        h('summary', { class: 'group__head' }, '#', highlight(t.name, res), h('small', {}, t.n)),
        [...t.refs].sort((a, b) => a.s - b.s).map(r => passageRow(r, { onGo: s => go(s, { flash: r.e }) })),
        t.notes.map(note => h('button', { class: 'list__item list__item--note', onclick: () => openNote(note, { go }) },
          h('span', { class: 'list__main' }, note.body.split('\n')[0] || 'Untitled note'))),
      )));
    }

    if (state.types.has('pins')) {
      const pins = store.pins.map((p, i) => ({ ...p, i })).filter(p => p.s != null &&
        matchesAll(`${PIN_NAMES[p.i]} ${fmtRange(p.s, p.e)}`, res) &&
        (state.scope === 'all' || overlaps(lo, hi, p.s, p.e)));
      if (pins.length) out.push(h('h3', { class: 'search__section' }, `Pins · ${pins.length}`), pins.map(p => h('button', {
        class: 'search__hit search__hit--pin', onclick: () => go(p.s, { flash: p.e }),
      }, pinIcon(p.i), h('span', { class: 'search__text search__text--ui' }, PIN_NAMES[p.i], h('small', {}, ` · ${fmtRange(p.s, p.e, true)}`)))));
    }

    if (my !== token) return;
    out.push(bible);
    fill(results, out.flat(Infinity).length ? out : h('p', { class: 'empty' }, 'Nothing found.'));
  }

  let t;
  input.addEventListener('input', () => {
    state.query = input.value;
    clearTimeout(t);
    t = setTimeout(() => { scroller.scrollTop = 0; run(); }, 180);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(t); input.blur(); run(); } });

  renderFilters();
  run().then(() => { if (state.query) scroller.scrollTop = state.scroll; });
  if (!state.query) setTimeout(() => input.focus(), 250);
  return sheet;
}
