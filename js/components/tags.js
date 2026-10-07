// Tags are named groups of passages (notes can carry tags too). The picker
// adds a selection to one; the indexes list tags, cross references and
// starred passages.
import { h, fill, svg, ICONS } from '../dom.js';
import { fmtRange } from '../canon.js';
import { openSheet, toast } from '../sheet.js';
import { store } from '../store.js';
import { passageRow } from './passage.js';
import { openNote } from './notes.js';

export function openTagPicker(sel) {
  const input = h('input', { class: 'field', type: 'text', placeholder: 'New tag', enterkeyhint: 'done', autocapitalize: 'off' });
  const chips = h('div', { class: 'chips' });
  const sheet = openSheet({ title: `Tag ${fmtRange(sel.s, sel.e, true)}`, close: 'x', body: h('div', { class: 'form' }, input, chips) });

  const add = name => {
    store.addTag(name, sel.s, sel.e);
    toast(`Added to #${name.replace(/^#/, '')}`);
    sheet.close();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) add(input.value); });
  const names = store.tagNames();
  fill(chips, names.length
    ? names.map(([name, n]) => h('button', { class: 'chip chip--tag', onclick: () => add(name) }, `#${name}`, h('small', {}, n)))
    : null);
  setTimeout(() => input.focus(), 250);
  return sheet;
}

// Every tag, with the passages and notes that carry it.
export function openTags({ go }) {
  const body = h('div', {});
  const sheet = openSheet({ title: 'Tags', body });
  function render(open) {
    const names = store.tagNames();
    if (!names.length) return fill(body, h('p', { class: 'empty' }, 'No tags yet.'));
    fill(body, names.map(([name, n]) => {
      const group = store.tag(name);
      const refs = group ? [...group.refs].sort((a, b) => a.s - b.s) : [];
      return h('details', { class: 'group', open: name === open },
        h('summary', { class: 'group__head' }, `#${name}`, h('small', {}, n)),
        refs.map(r => passageRow(r, { onGo: s => go(s, { flash: r.e }), onRemove: () => { store.removeRef(group.id, r); render(name); } })),
        store.notesTagged(name).map(note => h('button', { class: 'list__item list__item--note', onclick: () => openNote(note, { go }) },
          h('span', { class: 'list__main' }, svg(ICONS.note, 'icon icon--inline'), note.body.split('\n')[0] || 'Untitled note'))),
      );
    }));
  }
  render();
  return sheet;
}

// Every cross reference (a pair of passages).
export function openCrossRefs({ go }) {
  const body = h('div', {});
  const sheet = openSheet({ title: 'Cross references', body });
  function render() {
    const links = store.groups.filter(g => !g.name).sort((a, b) => b.t - a.t);
    fill(body, links.length ? links.map(g => h('div', { class: 'refpair' },
      g.refs.map(r => passageRow(r, { onGo: s => go(s, { flash: r.e }) })),
      h('button', { class: 'refgroup__leave', onclick: () => { store.removeGroup(g.id); render(); } }, 'Unlink'),
    )) : h('p', { class: 'empty' }, 'No cross references yet.'));
  }
  render();
  return sheet;
}

// Every starred passage, in Bible order.
export function openStars({ go }) {
  const body = h('div', {});
  const sheet = openSheet({ title: 'Starred', body });
  function render() {
    const stars = [...store.stars].sort((a, b) => a.s - b.s);
    fill(body, stars.length
      ? stars.map(x => passageRow(x, { onGo: s => go(s, { flash: x.e }), onRemove: () => { store.toggleStar(x.s, x.e); render(); } }))
      : h('p', { class: 'empty' }, 'Nothing starred yet.'));
  }
  render();
  return sheet;
}
