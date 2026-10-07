// Tiny DOM helpers.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
      }
    }
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Like el.replaceChildren, but flattens nested arrays and skips null/false the way h() does.
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(markup, cls = 'icon') {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', cls);
  el.innerHTML = markup;
  return el;
}

export const ICONS = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  // An asterisk: six spokes, spanning the same box as the other icons.
  star: '<path d="M12 4v16M5.1 8l13.8 8M5.1 16l13.8-8"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
};

export function longPress(el, onLong, ms = 480) {
  let timer, fired = false, x = 0, y = 0;
  el.addEventListener('pointerdown', e => {
    fired = false; x = e.clientX; y = e.clientY;
    timer = setTimeout(() => { fired = true; onLong(e); }, ms);
  });
  el.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - x, e.clientY - y) > 10) clearTimeout(timer);
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, () => clearTimeout(timer));
  el.addEventListener('contextmenu', e => e.preventDefault());
  // Swallow the click that follows a long press.
  el.addEventListener('click', e => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}

export function fmtDate(t, opts = { month: 'short', day: 'numeric' }) {
  return new Date(t).toLocaleDateString(undefined, opts);
}

export function fmtTime(t) {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtAgo(t) {
  if (!t) return 'never';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  if (d < 86400 * 365) return `${Math.floor(d / 86400 / 30)}mo ago`;
  return `${(d / 86400 / 365).toFixed(1)}y ago`;
}
