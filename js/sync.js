// Sync with the Worker backend (worker/index.js) for a signed-in account:
// requests carry the account's token (see account.js). The app stays
// offline-first: everything lives in IndexedDB and works without a
// connection or an account; this module reconciles with the server whenever
// it can. Signing in or out starts the sync state afresh.
//
// Records — each pin, reference group, note and star, plus the reading
// position, the ribbon and the two history resets —
// are compared against the last version both sides agreed on ("base"). Any
// that differ are pushed with the current time; the server keeps the newest
// write per record. The reading log is append-only: local entries are pushed
// once, and entries from other devices are merged in by id.
import { store, logId } from './store.js';
import * as db from './db.js';
import { account, signedIn, authHeaders, forget, token, current } from './account.js';

const KEY = 'sync';
const PIN_DEFAULT = { label: '', s: null, e: null, t: 0 };
// Sent with every sync. The server keeps version-1 clients (which treated
// records they didn't know as deleted) away from stars and newer state.
const CLIENT = 2;
const STATE_IDS = ['position', 'ribbon', 'reset-ribbon', 'reset-other'];
// Only records this client models may be marked deleted or tracked: a newer
// client's records must pass through untouched.
const modelled = key => {
  const [kind, ...rest] = key.split(':');
  return ['pin', 'group', 'note', 'star'].includes(kind) || (kind === 'state' && STATE_IDS.includes(rest.join(':')));
};
const LOG_CHUNK = 1000;
const RECORD_CHUNK = 200;
const HOLDER = 'dataAccount'; // whose data this device holds (an email), once synced

const sync = new EventTarget();
export default sync;

let st = null;        // persisted state, see load()
let running = null;   // in-flight sync promise
let timer = 0;
let available = true; // false when served without the Worker backend

export const status = () => ({
  available,
  signedIn: signedIn(),
  last: st?.last ?? 0,
  error: st?.error ?? '',
  running: !!running,
});

// The sync state belongs to one sign-in (`who`: its token); any other — a
// different account, or none — starts afresh, since cursors and what was
// last agreed mean nothing for another account.
const who = () => token() || '';
const fresh = () => ({ cursor: 0, logCursor: 0, logPushed: 0, initialized: false, base: {}, last: 0, error: '', client: CLIENT, who: who() });

async function load() {
  st = { ...fresh(), ...(await db.kvGet(KEY).catch(() => null)) };
  // Upgraded from version 1: it recorded records it couldn't use (stars,
  // resets) as seen. Forget those and pull everything again, so they're
  // applied here rather than pushed back as deleted or out of date.
  if ((st.client ?? 1) < CLIENT) {
    const v1 = key => /^(pin|group|note):/.test(key) || key === 'state:position' || key === 'state:ribbon';
    for (const key of Object.keys(st.base)) if (!v1(key)) delete st.base[key];
    st.cursor = 0;
    st.client = CLIENT;
    await persist();
  }
}

const persist = () => db.kvSet(KEY, st).catch(err => console.error('sync state save failed', err));
const emit = () => sync.dispatchEvent(new CustomEvent('status', { detail: status() }));

// ---- record views of the store ----
function currentRecords() {
  const out = new Map();
  store.pins.forEach((p, i) => out.set(`pin:${i}`, { kind: 'pin', id: String(i), data: p }));
  for (const g of store.groups) out.set(`group:${g.id}`, { kind: 'group', id: g.id, data: g });
  for (const n of store.notes) out.set(`note:${n.id}`, { kind: 'note', id: n.id, data: n });
  for (const x of store.stars) out.set(`star:${x.id}`, { kind: 'star', id: x.id, data: x });
  out.set('state:position', { kind: 'state', id: 'position', data: { id: store.position } });
  out.set('state:ribbon', { kind: 'state', id: 'ribbon', data: store.ribbon });
  // One record per kind, so resets on two devices don't overwrite each other.
  for (const k of ['ribbon', 'other']) out.set(`state:reset-${k}`, { kind: 'state', id: `reset-${k}`, data: { t: store.resets[k] } });
  return out;
}

function dirtyRecords() {
  const now = Date.now();
  const cur = currentRecords();
  const out = [];
  for (const [key, r] of cur) {
    const json = JSON.stringify(r.data);
    if (st.base[key] !== json) out.push({ key, json, kind: r.kind, id: r.id, data: r.data, updated: now, deleted: false });
  }
  for (const key of Object.keys(st.base)) {
    if (!cur.has(key) && modelled(key)) {
      const [kind, ...rest] = key.split(':');
      out.push({ key, json: null, kind, id: rest.join(':'), data: null, updated: now, deleted: true });
    }
  }
  return out;
}

function unpushedLog() {
  return store.log.filter(e => !e.r).slice(st.logPushed);
}

// Apply records from the server. On the very first sync the server wins
// (except over a locally placed pin when the server's slot is off);
// afterwards a record edited locally since it was sent is left alone (it
// will be pushed next round and the newer write wins).
function applyRecords(records, first) {
  const changed = new Set();
  const resets = {};
  const cur = currentRecords();
  for (const r of records) {
    const key = `${r.kind}:${r.id}`;
    if (!modelled(key)) continue; // from a newer client
    const local = cur.get(key);
    const localJson = local ? JSON.stringify(local.data) : undefined;
    const dirty = localJson !== st.base[key];
    if (r.deleted) delete st.base[key]; else st.base[key] = JSON.stringify(r.data);
    if (dirty && !first) continue;
    // First sync: don't let an empty server slot switch off a pin placed here.
    if (first && r.kind === 'pin' && local?.data.s != null && (r.deleted || r.data?.s == null)) continue;

    if (r.kind === 'pin') {
      const i = +r.id;
      if (i >= 0 && i < store.pins.length) {
        store.pins[i] = { ...PIN_DEFAULT, ...(r.deleted ? {} : r.data) };
        store.pins[i].label = ''; // labels are gone; kept empty for older versions
        changed.add('pins');
      }
    } else if (r.kind === 'group' || r.kind === 'note' || r.kind === 'star') {
      const name = { group: 'groups', note: 'notes', star: 'stars' }[r.kind];
      const existing = store[name].find(x => x.id === r.id);
      if (r.deleted) store[name] = store[name].filter(x => x !== existing);
      else if (existing) {
        // Update in place: an open editor may be holding this object.
        for (const k of Object.keys(existing)) delete existing[k];
        Object.assign(existing, r.data);
      } else store[name].push(r.data);
      changed.add(name);
    } else if (r.kind === 'state' && r.id === 'ribbon' && !r.deleted) {
      store.ribbon = r.data;
      changed.add('ribbon');
    } else if (r.kind === 'state' && r.id.startsWith('reset-') && !r.deleted) {
      const k = r.id.slice(6);
      // A reset only ever moves forward.
      if ((r.data?.t ?? 0) > store.resets[k]) resets[k] = r.data.t;
    } else if (r.kind === 'state' && r.id === 'position' && !r.deleted) {
      sync.dispatchEvent(new CustomEvent('position', { detail: r.data.id }));
    }
  }
  for (const name of changed) store.save(name);
  if (Object.keys(resets).length) store.setResets(resets);
}

function applyLog(entries) {
  if (!entries.length) return;
  const have = new Set(store.log.map(logId));
  store.addRemoteLog(entries.filter(e => !have.has(e.id)));
}

class Unavailable extends Error {}
class SignedOut extends Error {}

async function post(action, body, { keepalive = false } = {}) {
  if (!signedIn()) throw new SignedOut();
  const res = await fetch(`api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    keepalive,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* fall through */ }
  // The server no longer knows this token (signed out elsewhere).
  if (res.status === 401) { forget(); throw new SignedOut(); }
  // A plain static server (no Worker) answers 404/405/501 or HTML.
  if (!data && [404, 405, 501].includes(res.status)) throw new Unavailable();
  if (!res.ok || !data) throw new Error(data?.error || `Server error ${res.status}`);
  return data;
}

async function run({ keepalive = false } = {}) {
  // Pull first on a device's very first sync so a fresh install doesn't push
  // its empty pins over the real ones.
  const first = !st.initialized;
  const pending = first ? [] : dirtyRecords();
  let records = pending.splice(0, RECORD_CHUNK);
  let log = first ? [] : unpushedLog().slice(0, LOG_CHUNK);
  for (;;) {
    const res = await post('sync', {
      client: CLIENT, cursor: st.cursor, logCursor: st.logCursor,
      records: records.map(({ kind, id, data, updated, deleted }) => ({ kind, id, data, updated, deleted })),
      log: log.map(({ id, t, d, s, e, k }) => ({ id: id ?? logId({ t, s }), t, d, s, e, k: k ? 1 : 0 })),
    }, { keepalive: keepalive && records.length + log.length < 200 });
    for (const r of records) { if (r.deleted) delete st.base[r.key]; else st.base[r.key] = r.json; }
    st.logPushed += log.length;
    applyRecords(res.records, first);
    applyLog(res.log);
    st.cursor = res.cursor;
    st.logCursor = res.logCursor;
    await persist();
    records = pending.splice(0, RECORD_CHUNK);
    log = first ? [] : unpushedLog().slice(0, LOG_CHUNK);
    if (!res.more && !log.length && !records.length) break;
  }
  if (first) {
    st.initialized = true;
    await persist();
    // This device's data now belongs to this account.
    if (current()?.email) await db.kvSet(HOLDER, current().email).catch(() => {});
    await run(); // now push what this device has
  }
}

export function syncNow(opts) {
  if (!st || !available || !signedIn() || !navigator.onLine) return Promise.resolve();
  if (running) return running;
  clearTimeout(timer);
  emit();
  running = run(opts).then(() => {
    st.last = Date.now();
    st.error = '';
  }, err => {
    if (err instanceof Unavailable) { available = false; return; }
    if (err instanceof SignedOut) return;
    st.error = err.message || String(err);
    console.warn('sync failed', err);
  }).finally(() => {
    running = null;
    persist();
    emit();
  });
  emit();
  return running;
}

function schedule(ms = 4000) {
  if (!available || !signedIn()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

export const exportServer = () => post('export', {});

// A new sign-in (or none) takes over the sync state. Data on this device
// from another account is replaced, not merged in; data from no account
// (used before signing in) joins this one.
async function adopt() {
  st = fresh();
  await persist();
  if (!signedIn()) return;
  const holder = await db.kvGet(HOLDER).catch(() => null);
  const email = current()?.email;
  if (holder && email && holder !== email) await store.clearAccountData();
}

export async function initSync() {
  await load();
  if ((st.who ?? '') !== who()) await adopt();
  store.addEventListener('change', e => {
    if (['pins', 'groups', 'notes', 'stars', 'ribbon', 'resets'].includes(e.detail)) schedule(3000);
    else if (e.detail === 'position') schedule(20000);
  });
  store.addEventListener('log', () => schedule(20000));
  // A different sign-in (or none): nothing synced before applies. Signing in
  // pulls the account first (as on a fresh device), then pushes what's here.
  account.addEventListener('change', async () => {
    if (st.who === who()) return;
    await adopt();
    emit();
    if (signedIn()) syncNow();
  });
  // After a backup restore, everything restored should reach the server.
  store.addEventListener('import', () => { st.base = {}; st.logPushed = 0; persist(); schedule(500); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncNow({ keepalive: true });
    else syncNow();
  });
  addEventListener('online', () => syncNow());
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 5 * 60 * 1000);
  emit();
}
