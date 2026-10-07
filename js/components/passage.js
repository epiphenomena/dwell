// A passage row: reference plus a couple of lines of its text.
import { h, svg, ICONS } from '../dom.js';
import { fmtRange } from '../canon.js';
import { passageText } from '../text.js';

export function passageRow({ s, e }, { onGo, onRemove, meta, color } = {}) {
  const text = h('span', { class: 'passage__text' }, '…');
  passageText(s, e, { max: 6 }).then(t => { text.textContent = t; }, () => { text.textContent = ''; });
  const row = h('div', { class: 'passage' },
    color != null ? h('i', { class: 'passage__swatch', style: { background: `var(--pin-${color})` } }) : null,
    h('button', { class: 'passage__go', onclick: () => onGo?.(s, e) },
      h('span', { class: 'passage__ref' }, fmtRange(s, e), meta ? h('span', { class: 'passage__meta' }, meta) : null),
      text,
    ),
    onRemove ? h('button', { class: 'passage__remove', 'aria-label': 'Remove', onclick: () => onRemove() }, svg(ICONS.close)) : null,
  );
  return row;
}
