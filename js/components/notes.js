// Notes. A note is free text connected to passages and optionally tagged.
// Passages are attached by picking a pin (its range is copied at that
// moment, so moving the pin later doesn't change the note) or the page.
import { h, fill, svg, ICONS, fmtDate } from '../dom.js';
import { fmtRange, fmtRef } from '../canon.js';
import { openSheet, toast } from '../sheet.js';
import { store, PIN_NAMES, cleanName } from '../store.js';
import { passageRow } from './passage.js';

let readerRef;
export const setNotesReader = r => { readerRef = r; };

// Words in a note's text or tags; every word must match the start of one.
function noteMatcher(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/^#/, ''));
  return n => {
    const hay = `${n.body} ${n.tags.join(' ')}`.toLowerCase();
    return words.every(w => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(hay));
  };
}

export function openNotes({ go }) {
  const list = h('div', { class: 'list' });
  const filter = h('input', {
    class: 'field notes__filter', type: 'search', placeholder: 'Filter notes', autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
  });
  filter.addEventListener('input', () => render());
  const onChange = e => { if (e.detail === 'notes') render(); };
  store.addEventListener('change', onChange);
  const sheet = openSheet({
    title: 'Notes',
    onClose: () => store.removeEventListener('change', onChange),
    body: [filter, list],
    actions: [h('button', { class: 'sheet__action', 'aria-label': 'New note', onclick: () => openNote(store.addNote(), { go, isNew: true }) }, svg(ICONS.plus))],
  });
  function render() {
    if (!store.notes.length) {
      list.replaceChildren(h('p', { class: 'empty' }, 'No notes yet.'));
      return;
    }
    const q = filter.value.trim();
    const notes = q ? store.notes.filter(noteMatcher(q)) : store.notes;
    filter.hidden = store.notes.length < 2;
    if (!notes.length) return list.replaceChildren(h('p', { class: 'empty' }, 'No notes match.'));
    list.replaceChildren(...[...notes].sort((a, b) => b.updated - a.updated).map(n => h('button', {
      class: 'list__item list__item--note', onclick: () => openNote(n, { go }),
    },
      h('span', { class: 'list__main' }, n.body.split('\n')[0] || 'Untitled note'),
      h('span', { class: 'list__meta' }, [fmtDate(n.updated), ...n.links.slice(0, 3).map(r => fmtRange(r.s, r.e, true)), ...n.tags.map(t => `#${t}`)].join(' · ')),
    )));
  }
  render();
  return sheet;
}

// `resume` puts the caret at the end, ready to carry on writing.
export function openNote(note, { go, isNew = false, resume = false }) {
  const body = h('textarea', { class: 'note__body', placeholder: 'Write…' });
  body.value = note.body;
  let t;
  body.addEventListener('input', () => {
    note.body = body.value;
    clearTimeout(t);
    t = setTimeout(() => store.updateNote(note), 400);
  });

  const tags = h('div', { class: 'chips note__tags' });
  const suggest = h('div', { class: 'chips note__suggest', hidden: true });
  const links = h('div', { class: 'note__links' });
  const attach = h('div', { class: 'note__attach' });
  let deleted = false;

  const sheet = openSheet({
    title: isNew ? 'New note' : fmtDate(note.created, { month: 'short', day: 'numeric', year: 'numeric' }),
    cls: 'sheet--note',
    // Done with a note: back to the text, wherever it was opened from.
    closesAll: true,
    body: [body, tags, suggest, links, attach],
    actions: [h('button', { class: 'sheet__action', 'aria-label': 'Delete note', onclick: () => {
      store.removeNote(note.id);
      deleted = true;
      sheet.close();
      toast('Note deleted');
    } }, svg(ICONS.trash))],
    onClose: () => {
      clearTimeout(t);
      if (deleted) return;
      if (!note.body.trim() && !note.links.length && !note.tags.length) store.removeNote(note.id);
      else store.updateNote(note);
    },
  });

  function addLink(r) {
    if (note.links.some(l => l.s === r.s && l.e === r.e)) return toast('Already attached');
    note.links.push(r);
    store.updateNote(note);
    render();
  }

  // Tag input with suggestions from the tags already in use: plain chips,
  // since <datalist> shows nothing in some mobile browsers (Firefox).
  function renderTags() {
    const input = h('input', { class: 'note__tagin', type: 'text', placeholder: note.tags.length ? 'Add tag' : 'Add a tag…', enterkeyhint: 'done', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
    const add = (value, refocus = true) => {
      const name = cleanName(value);
      if (name && !note.tags.includes(name)) { note.tags.push(name); store.updateNote(note); }
      renderTags();
      if (refocus) tags.querySelector('input').focus();
    };
    const showSuggestions = () => {
      const q = cleanName(input.value).toLowerCase();
      const names = store.tagNames().map(([name]) => name).filter(name => !note.tags.includes(name));
      const starts = names.filter(n => n.toLowerCase().startsWith(q));
      const within = q ? names.filter(n => !starts.includes(n) && n.toLowerCase().includes(q)) : [];
      const list = [...starts, ...within].slice(0, 12);
      fill(suggest, list.map(name => h('button', {
        class: 'chip chip--tag',
        // Keep the keyboard up: don't let the tap blur the input first.
        onpointerdown: e => e.preventDefault(),
        onclick: () => add(name),
      }, `#${name}`)));
      suggest.hidden = !list.length || (!q && document.activeElement !== input);
    };
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Enter takes the only suggestion left, or what was typed.
      const only = suggest.hidden ? null : suggest.querySelectorAll('button');
      add(only?.length === 1 && input.value.trim() ? only[0].textContent.slice(1) : input.value);
    });
    input.addEventListener('input', showSuggestions);
    // A tag typed but not entered is kept when you move on.
    input.addEventListener('change', () => { if (input.value.trim()) add(input.value, false); });
    input.addEventListener('focus', showSuggestions);
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) suggest.hidden = true; }, 150));
    showSuggestions();
    fill(tags,
      note.tags.map(name => h('span', { class: 'chip chip--tag' }, `#${name}`,
        h('button', { class: 'chip__x', 'aria-label': `Remove tag ${name}`, onclick: () => {
          note.tags = note.tags.filter(x => x !== name);
          store.updateNote(note);
          renderTags();
        } }, '×'))),
      input,
    );
  }

  function render() {
    fill(links, note.links.map((r, k) => passageRow(r, {
      color: r.pin, onGo: s => go(s, { flash: r.e }),
      onRemove: () => { note.links.splice(k, 1); store.updateNote(note); render(); },
    })));

    // Same layout as the dock: the seven pins, and This page where the ribbon sits.
    fill(attach,
      h('div', { class: 'note__attachlabel' }, note.links.length ? 'Attach another passage' : 'Attach a passage'),
      h('div', { class: 'dock dock--attach' },
        store.pins.map((p, i) => h('button', {
          class: `pin${p.s != null ? ' is-on' : ''}`, style: { '--c': `var(--pin-${i})` }, disabled: p.s == null,
          'aria-label': p.s != null ? `Attach ${PIN_NAMES[i]} pin passage ${fmtRange(p.s, p.e)}` : `${PIN_NAMES[i]} pin is off`,
          onclick: () => addLink({ s: p.s, e: p.e, pin: i }),
        }, h('span', { class: 'pin__label' }, p.s != null ? fmtRef(p.s, true) : ''))),
        readerRef ? h('button', { class: 'pin pin--ribbon is-on', onclick: () => addLink(readerRef.range) },
          h('span', { class: 'pin__label' }, 'This page')) : null,
      ),
    );
  }
  renderTags();
  render();
  if (isNew || resume) setTimeout(() => {
    body.focus();
    if (resume) { body.setSelectionRange(body.value.length, body.value.length); body.scrollTop = body.scrollHeight; }
  }, 250);
  return sheet;
}
