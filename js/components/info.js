// Everything attached to some verses: pins, reference groups (cross
// references and tags), notes. Opened from the selection bar or by tapping
// a marked verse number.
//
// References reach a second level: if A and B are cross-referenced, and B
// and C, then A and C are referenced at the second level, through B.
import { h, fill } from '../dom.js';
import { fmtRange, overlaps } from '../canon.js';
import { openSheet } from '../sheet.js';
import { store, PIN_NAMES } from '../store.js';
import { passageRow } from './passage.js';
import { openNote } from './notes.js';

export function openInfo(sel, { go }) {
  const body = h('div', { class: 'info' });
  const sheet = openSheet({ title: fmtRange(sel.s, sel.e), body });

  // One block per group: its name (or "Cross reference") and the other
  // passages in it. An unnamed group can be named, which makes it a tag.
  function groupBlock(g) {
    const here = g.refs.filter(r => overlaps(sel.s, sel.e, r.s, r.e));
    const others = g.refs.filter(r => !here.includes(r));
    const nameInput = h('input', { class: 'field field--inline', type: 'text', placeholder: 'Name this group (makes it a tag)', enterkeyhint: 'done', autocapitalize: 'off' });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter' && nameInput.value.trim()) { store.nameGroup(g.id, nameInput.value); render(); } });
    return h('div', { class: 'refgroup' },
      h('div', { class: 'refgroup__head' },
        g.name ? h('span', { class: 'refgroup__name' }, `#${g.name}`) : h('span', { class: 'refgroup__name refgroup__name--plain' }, 'Cross reference'),
        h('span', { class: 'refgroup__meta' }, g.name ? `${g.refs.length} passages` : ''),
        h('button', { class: 'refgroup__leave', onclick: () => { here.forEach(r => store.removeRef(g.id, r)); render(); } }, g.name ? 'Remove from tag' : 'Unlink'),
      ),
      others.length ? others.map(r => passageRow(r, { onGo: s => go(s, { flash: r.e }), onRemove: () => { store.removeRef(g.id, r); render(); } }))
        : h('p', { class: 'empty empty--small' }, 'No other passages yet.'),
      g.name ? null : nameInput,
    );
  }

  // Passages one step beyond the direct references, each with the passage
  // it comes through. Not repeated: the selection itself, direct references.
  function secondLevel(groups) {
    const key = r => `${r.s}-${r.e}`;
    const near = new Set(), seen = new Set();
    const firsts = [];
    for (const g of groups) for (const r of g.refs) {
      if (overlaps(sel.s, sel.e, r.s, r.e)) continue;
      if (!near.has(key(r))) firsts.push(r);
      near.add(key(r));
    }
    const out = [];
    for (const via of firsts) {
      for (const g of store.groups) {
        if (groups.includes(g) || !g.refs.some(r => overlaps(via.s, via.e, r.s, r.e))) continue;
        for (const r of g.refs) {
          const k = key(r);
          if (overlaps(via.s, via.e, r.s, r.e) || overlaps(sel.s, sel.e, r.s, r.e) || near.has(k) || seen.has(k)) continue;
          seen.add(k);
          out.push({ ...r, via, tag: g.name });
        }
      }
    }
    return out.sort((x, y) => x.s - y.s);
  }

  function render() {
    const a = store.annotations(sel.s, sel.e);
    const second = secondLevel(a.groups);
    const section = (title, items, empty) => [
      h('h3', { class: 'list__group' }, title),
      items.length ? items : h('p', { class: 'empty empty--small' }, empty),
    ];
    const groups = [...a.groups].sort((x, y) => (x.name ? 1 : 0) - (y.name ? 1 : 0));
    fill(body,
      section('References', groups.map(groupBlock),
        'None.'),
      second.length ? [
        h('h3', { class: 'list__group' }, 'Second level'),
        second.map(r => passageRow(r, { meta: `via ${fmtRange(r.via.s, r.via.e, true)}${r.tag ? ` · #${r.tag}` : ''}`, onGo: s => go(s, { flash: r.e }) })),
      ] : null,
      section('Notes', a.notes.map(n => h('button', { class: 'list__item list__item--note', onclick: () => openNote(n, { go }) },
        h('span', { class: 'list__main' }, n.body.split('\n')[0] || 'Untitled note'))), 'No notes.'),
      section('Pins', a.pins.map(p => passageRow(p, { color: p.i, meta: PIN_NAMES[p.i], onGo: s => go(s, { flash: p.e }) })),
        'No pins here.'),
    );
  }
  render();
  return sheet;
}
