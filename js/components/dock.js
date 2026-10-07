// The dock: seven colored pin buttons plus the reading ribbon, always
// visible at the foot of the screen. A pin is on (filled, labelled with its
// passage) or off (outline only, pointing nowhere); holding it clears it.
// The ribbon marks the page you're reading through. Anything whose place is
// on screen gets a ring.
import { h, longPress } from '../dom.js';
import { fmtRef, overlaps } from '../canon.js';
import { store, PIN_COUNT, PIN_NAMES } from '../store.js';

// Small ribbon swatch in a pin's color, for lists and editors.
export function pinIcon(i, cls = 'pin__icon') {
  const el = document.createElement('span');
  el.className = cls;
  el.style.setProperty('--c', i === 'ribbon' ? 'var(--ribbon)' : `var(--pin-${i})`);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function initDock(el, { reader, onTap, onHold, onRibbonTap, onRibbonHold }) {
  const buttons = [];
  for (let i = 0; i < PIN_COUNT; i++) {
    const label = h('span', { class: 'pin__label' });
    const btn = h('button', { class: 'pin', 'data-i': i, onclick: () => onTap(i) }, label);
    btn.style.setProperty('--c', `var(--pin-${i})`);
    longPress(btn, () => onHold(i));
    buttons.push({ btn, label });
    el.append(btn);
  }
  const ribbonLabel = h('span', { class: 'pin__label' });
  const ribbon = h('button', { class: 'pin pin--ribbon', onclick: () => onRibbonTap() }, pinIcon('ribbon'), ribbonLabel);
  ribbon.style.setProperty('--c', 'var(--ribbon)');
  longPress(ribbon, () => onRibbonHold());
  el.append(ribbon);

  function render() {
    const { s, e } = reader.book >= 0 ? reader.range : { s: -1, e: -1 };
    store.pins.forEach((p, i) => {
      const { btn, label } = buttons[i];
      const on = p.s != null;
      const text = on ? fmtRef(p.s, true) : '';
      btn.classList.toggle('is-on', on);
      btn.classList.toggle('is-here', on && overlaps(s, e, p.s, p.e));
      label.textContent = text;
      btn.setAttribute('aria-label', `${PIN_NAMES[i]} pin${on ? `: ${text} (hold to clear)` : ' (off)'}`);
    });
    const r = store.ribbon.id;
    ribbonLabel.textContent = r != null ? fmtRef(r, true) : 'Ribbon';
    ribbon.classList.toggle('is-on', r != null);
    ribbon.classList.toggle('is-here', r != null && r >= s && r <= e);
    ribbon.setAttribute('aria-label', r != null ? `Reading ribbon: ${fmtRef(r)} (hold to move it here)` : 'Reading ribbon (tap to place it here)');
  }

  reader.addEventListener('page', render);
  store.addEventListener('change', e => { if (e.detail === 'pins' || e.detail === 'ribbon') render(); });
  render();

  return {
    render,
    setMode(mode) {
      el.dataset.mode = mode || '';
    },
  };
}
