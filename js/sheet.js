// Full-screen sheets that stack. Each open sheet pushes a browser history
// state so the system back gesture closes it instead of leaving the app.
//
// The close button is a check where closing keeps what you did (everything
// is saved as you go) and an X where it only dismisses (lookups, pickers).
// A sheet that closesAll returns straight to the text, closing those under it.
import { h, svg, ICONS } from './dom.js';

const stack = [];
const listeners = new Set();
// Notified with the number of open sheets whenever it changes.
export const onSheets = fn => listeners.add(fn);
const notify = () => listeners.forEach(fn => fn(stack.length));
let popping = 0; // popstates we caused ourselves and should ignore

const CLOSE = { check: ['check', 'Done'], x: ['close', 'Close'] };

export function openSheet({ title, body, actions = [], cls = '', onClose, close: closeIcon = 'check', closesAll = false } = {}) {
  const titleEl = h('h2', { class: 'sheet__title' }, title);
  const closeBtn = h('button', { class: 'sheet__close', onclick: () => sheet.close() });
  const setCloseIcon = name => {
    closeBtn.replaceChildren(svg(ICONS[CLOSE[name][0]]));
    closeBtn.setAttribute('aria-label', CLOSE[name][1]);
  };
  setCloseIcon(closeIcon);
  const el = h('section', { class: `sheet ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'sheet__head' },
      closeBtn,
      titleEl,
      h('div', { class: 'sheet__actions' }, actions),
    ),
    h('div', { class: 'sheet__body' }, h('div', { class: 'sheet__inner' }, body)),
  );
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-open'));

  const sheet = {
    el, body: el.querySelector('.sheet__inner'), closesAll,
    setTitle: t => { titleEl.textContent = t; },
    setCloseIcon,
    close: () => (closesAll ? closeAllSheets() : close()),
  };
  stack.push(sheet);
  notify();
  history.pushState({ sheet: stack.length }, '');

  function close(fromPop = false) {
    const i = stack.indexOf(sheet);
    if (i < 0) return;
    stack.splice(i, 1);
    notify();
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    setTimeout(() => el.remove(), 220);
    onClose?.();
    if (!fromPop) { popping++; history.back(); }
  }
  sheet._close = close;
  return sheet;
}

addEventListener('popstate', () => {
  if (popping) { popping--; return; }
  const top = stack[stack.length - 1];
  if (top?.closesAll) closeAllSheets(1);
  else top?._close(true);
});

export const topSheet = () => stack[stack.length - 1];
// Close every sheet with one history step. `popped` is how many of their
// history entries the browser has already gone back over (a back gesture).
export function closeAllSheets(popped = 0) {
  const n = stack.length;
  if (!n) return;
  while (stack.length) stack[stack.length - 1]._close(true);
  if (n - popped > 0) { popping++; history.go(-(n - popped)); }
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-shown'), ms);
}
