// Bible text, one file per version (fetched as text/<id>): plain verse
// strings (books → chapters → verses) plus layout — paragraphs, poetry lines
// and headings placed by character offset (see tools/build-versions.mjs).
// Only the current version is kept in memory; the service worker keeps the
// versions this device may read available offline.
//
// Public versions are for everyone. The others are licensed and only an
// owner account may read them: they're fetched with the account's token,
// and dropped from the offline cache when the device signs out.
import { locate } from './canon.js';
import { current, authHeaders } from './account.js';
import './versions.js';

export const VERSIONS = self.DWELL_VERSIONS;

// The versions this device may read now.
export function available() {
  const allowed = new Set(current()?.versions ?? []);
  return VERSIONS.filter(v => v.public || allowed.has(v.id));
}

let shown = VERSIONS[0];
let bible = null;

export const version = () => shown;

// Unknown or unavailable ids fall back to the first available version.
export function setVersion(id) {
  const list = available();
  const v = list.find(x => x.id === id) ?? list[0];
  if (v !== shown) { shown = v; bible = null; }
  return v;
}

const fetchText = v => fetch(`text/${v.id}`, { headers: v.public ? {} : authHeaders() });

function loadBible() {
  if (!bible) {
    const v = shown;
    const p = bible = fetchText(v).then(r => {
      if (!r.ok) throw new Error(`failed to load text/${v.id}`);
      return r.json();
    });
    p.catch(() => { if (bible === p) bible = null; });
  }
  return bible;
}

export const loadBook = b => loadBible().then(d => d.text[b]);
export const loadLayout = b => loadBible().then(d => d.layout[b]);

// Fetch each licensed version this account may read that isn't cached yet,
// so the service worker has it for offline use (it caches what passes through).
export async function prefetchVersions() {
  for (const v of available()) {
    if (v.public) continue;
    if (await self.caches?.match(new URL(`text/${v.id}`, location.href).href, { ignoreSearch: true })) continue;
    try { await (await fetchText(v)).arrayBuffer(); } catch { /* offline: next time */ }
  }
}

// Signed out: licensed text must not stay readable from the offline cache.
export async function purgeLicensed() {
  if (self.caches) {
    const licensed = VERSIONS.filter(v => !v.public);
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const v of licensed) await cache.delete(new URL(`text/${v.id}`, location.href).href, { ignoreSearch: true });
    }
  }
  if (!shown.public) bible = null;
}

// Plain text of a passage with verse numbers, e.g. for previews and copying.
export async function passageText(s, e, { numbers = true, max = Infinity } = {}) {
  const out = [];
  for (let id = s; id <= e && out.length < max; id++) {
    const { b, c, v } = locate(id);
    const book = await loadBook(b);
    const t = book[c][v];
    if (t) out.push(numbers ? `${v + 1} ${t}` : t);
  }
  return out.join(' ');
}
