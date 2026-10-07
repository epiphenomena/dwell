// App state with IndexedDB persistence. Small collections (pins, reference
// groups, notes, stars) are kept whole under one key each; the reading log is
// append-only and also folded into per-verse "last read" tables.
//
// Reading comes in two kinds, tracked apart: at the reading ribbon (reading
// through, which carries the ribbon along) and everywhere else. Each kind's
// history can be reset; a reset is a cutoff time, and entries before it are
// ignored (the log itself stays append-only, which sync relies on).
import * as db from './db.js';
import { TOTAL, overlaps } from './canon.js';

// Seven passage pins; the eighth dock slot is the reading ribbon.
export const PIN_COUNT = 7;
export const PIN_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple'];

// Minimum time a page must stay on screen to count as read, and the cap on
// one entry's duration so an idle screen doesn't count as hours of reading.
export const MIN_DWELL = 1500;
export const MAX_DWELL = 10 * 60 * 1000;

const DEFAULTS = {
  settings: {
    theme: 'dark', textSize: 20, leading: 1.6, lines: false, chapterBreak: false,
    numbers: true, headings: true, version: 'bsb', heatWindow: 90, autoFullscreen: true,
    historyKind: 'other', font: 'serif', keepAwake: false,
  },
  // A pin is on when it points at a passage (s..e) and off when s is null.
  // `label` is unused but kept empty, so pins read the same to devices still
  // on a version that had labels (otherwise they'd keep re-sending them).
  pins: Array.from({ length: PIN_COUNT }, () => ({ label: '', s: null, e: null, t: 0 })),
  groups: [],
  notes: [],
  // Starred passages: marks to find again while flipping, nothing more.
  stars: [],
  // History before these times is ignored, per kind of reading.
  resets: { ribbon: 0, other: 0 },
  position: 0,
  // The reading ribbon marks a page (by its first verse), like the ribbon in
  // a printed Bible; it travels along as you read on from it.
  ribbon: { id: null, t: 0 },
  nav: { back: [], fwd: [] },
};
const KEYS = Object.keys(DEFAULTS);

// Tag names: trimmed, without a leading #. Shared by passage and note tags.
export const cleanName = name => name.trim().replace(/^#/, '').trim();

// Version 1 kept cross references (links) and tags separately.
function migrateGroups(kv) {
  const groups = [];
  for (const l of kv.links || []) groups.push({ id: l.id, name: '', refs: [l.a, l.b], t: l.t });
  for (const t of kv.tags || []) {
    let g = groups.find(x => x.name === t.name);
    if (!g) groups.push(g = { id: t.id, name: t.name, refs: [], t: t.t });
    g.refs.push({ s: t.s, e: t.e });
  }
  return groups;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Stable id for a log entry, used to deduplicate across devices.
export const logId = e => e.id ?? `${e.t.toString(36)}-${e.s.toString(36)}`;

export const KINDS = ['ribbon', 'other'];
export const kindOf = entry => (entry.k ? 'ribbon' : 'other');

class Store extends EventTarget {
  log = [];
  // Per verse, when it was last read: at the ribbon, elsewhere, and either.
  lastRead = { ribbon: new Float64Array(TOTAL), other: new Float64Array(TOTAL), all: new Float64Array(TOTAL) };

  async load() {
    const kv = await db.kvAll().catch(() => ({}));
    if (!kv.groups && (kv.links || kv.tags)) kv.groups = migrateGroups(kv);
    for (const k of KEYS) this[k] = structuredClone(kv[k] ?? DEFAULTS[k]);
    this.settings = { ...DEFAULTS.settings, ...this.settings };
    this.resets = { ...DEFAULTS.resets, ...this.resets };
    this.pins = this.pins.slice(0, PIN_COUNT);
    while (this.pins.length < PIN_COUNT) this.pins.push(structuredClone(DEFAULTS.pins[0]));
    for (const n of this.notes) n.tags ??= [];
    // Older data had a separate on/off flag (a pin that was off points
    // nowhere) and labels (the color and reference are the label now).
    for (const p of this.pins) {
      if (p.on === false) Object.assign(p, { s: null, e: null });
      delete p.on;
      p.label = '';
    }
    this.log = await db.logAll().catch(() => []);
    this.#fold();
  }

  // Whether an entry counts: not from before its kind's last reset.
  counts(entry) { return entry.t >= this.resets[kindOf(entry)]; }

  // The log entries that count, optionally of one kind.
  entries(kind) { return this.log.filter(e => this.counts(e) && (!kind || kindOf(e) === kind)); }

  #fold() {
    for (const a of Object.values(this.lastRead)) a.fill(0);
    for (const entry of this.log) this.#apply(entry);
  }

  #apply(entry) {
    if (!this.counts(entry)) return;
    const { t, s, e } = entry;
    const mine = this.lastRead[kindOf(entry)], all = this.lastRead.all;
    for (let id = s; id <= e; id++) {
      if (t > mine[id]) mine[id] = t;
      if (t > all[id]) all[id] = t;
    }
  }

  // Forget one kind of reading history (on every device, through sync).
  resetHistory(kind) {
    this.resets[kind] = Date.now();
    this.#fold();
    this.save('resets');
    this.dispatchEvent(new CustomEvent('log', { detail: null }));
  }

  // A reset arrived from another device.
  setResets(resets) {
    this.resets = { ...this.resets, ...resets };
    this.#fold();
    this.save('resets');
    this.dispatchEvent(new CustomEvent('log', { detail: null }));
  }

  save(key) {
    db.kvSet(key, this[key]).catch(err => console.error('save failed', key, err));
    this.dispatchEvent(new CustomEvent('change', { detail: key }));
  }

  setting(name, value) {
    this.settings[name] = value;
    this.save('settings');
  }

  addLog(entry) {
    entry.id ??= logId(entry);
    this.log.push(entry);
    this.#apply(entry);
    db.logAdd(entry).catch(err => console.error('log failed', err));
    this.dispatchEvent(new CustomEvent('log', { detail: entry }));
  }

  // Entries that arrived from another device (marked r so they are never re-sent).
  addRemoteLog(entries) {
    if (!entries.length) return;
    for (const e of entries) { e.r = 1; this.log.push(e); this.#apply(e); }
    db.logAddMany(entries).catch(err => console.error('log failed', err));
    this.dispatchEvent(new CustomEvent('log', { detail: null }));
  }

  // ---- pins ----
  placePin(i, s, e) {
    Object.assign(this.pins[i], { s, e, t: Date.now() });
    this.save('pins');
  }

  turnOffPin(i) {
    Object.assign(this.pins[i], { s: null, e: null, t: 0 });
    this.save('pins');
  }

  // ---- stars ----
  starsIn(s, e) { return this.stars.filter(x => overlaps(s, e, x.s, x.e)); }

  // Star a passage, or unstar it if any of it is starred already.
  toggleStar(s, e) {
    const hit = this.starsIn(s, e);
    if (hit.length) this.stars = this.stars.filter(x => !hit.includes(x));
    else this.stars.push({ id: uid(), s, e, t: Date.now() });
    this.save('stars');
    return !hit.length;
  }

  // ---- reference groups ----
  // A group is a set of passages that refer to each other. A cross reference
  // is an unnamed group of two; a tag is a named group of any size.
  addLink(a, b) {
    const group = { id: uid(), name: '', refs: [{ s: a.s, e: a.e }, { s: b.s, e: b.e }], t: Date.now() };
    this.groups.push(group);
    this.save('groups');
    return group;
  }

  tag(name) { return this.groups.find(g => g.name === name); }

  addTag(name, s, e) {
    name = cleanName(name);
    if (!name) return;
    let group = this.tag(name);
    if (!group) this.groups.push(group = { id: uid(), name, refs: [], t: Date.now() });
    if (!group.refs.some(r => r.s === s && r.e === e)) group.refs.push({ s, e });
    this.save('groups');
  }

  // Name an unnamed group, turning it into a tag (merging if the tag exists).
  nameGroup(id, name) {
    name = cleanName(name);
    const group = this.groups.find(g => g.id === id);
    if (!group || !name) return;
    const existing = this.tag(name);
    if (existing && existing !== group) {
      for (const r of group.refs) if (!existing.refs.some(x => x.s === r.s && x.e === r.e)) existing.refs.push(r);
      this.groups = this.groups.filter(g => g !== group);
    } else group.name = name;
    this.save('groups');
  }

  removeRef(id, ref) {
    const group = this.groups.find(g => g.id === id);
    if (!group) return;
    group.refs = group.refs.filter(r => !(r.s === ref.s && r.e === ref.e));
    // A cross reference needs two ends; a tag lives while it has members.
    if (group.refs.length < (group.name ? 1 : 2)) this.groups = this.groups.filter(g => g !== group);
    this.save('groups');
  }

  removeGroup(id) {
    this.groups = this.groups.filter(g => g.id !== id);
    this.save('groups');
  }

  // Tag names with how many passages and notes carry each.
  tagNames() {
    const counts = new Map();
    for (const g of this.groups) if (g.name) counts.set(g.name, (counts.get(g.name) || 0) + g.refs.length);
    for (const n of this.notes) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }

  notesTagged(name) { return this.notes.filter(n => n.tags.includes(name)); }

  setRibbon(id) {
    this.ribbon = { id, t: Date.now() };
    this.save('ribbon');
  }

  // ---- notes ----
  addNote(links = []) {
    const now = Date.now();
    const note = { id: uid(), body: '', links, tags: [], created: now, updated: now };
    this.notes.unshift(note);
    this.save('notes');
    return note;
  }

  updateNote(note) {
    note.updated = Date.now();
    this.save('notes');
  }

  removeNote(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    this.save('notes');
  }

  // Everything attached to a verse range.
  annotations(s, e) {
    return {
      pins: this.pins.map((p, i) => ({ ...p, i })).filter(p => p.s != null && overlaps(s, e, p.s, p.e)),
      groups: this.groups.filter(g => g.refs.some(r => overlaps(s, e, r.s, r.e))),
      notes: this.notes.filter(n => n.links.some(r => overlaps(s, e, r.s, r.e))),
      stars: this.starsIn(s, e),
    };
  }

  // Forget everything that belongs to an account (before taking on another
  // account's data). Settings, position and back/forward stay.
  async clearAccountData() {
    for (const k of ['pins', 'groups', 'notes', 'stars', 'ribbon', 'resets']) this[k] = structuredClone(DEFAULTS[k]);
    this.log = [];
    await db.logClear().catch(err => console.error('log clear failed', err));
    this.#fold();
    for (const k of ['pins', 'groups', 'notes', 'stars', 'ribbon', 'resets']) this.save(k);
    this.dispatchEvent(new CustomEvent('log', { detail: null }));
  }

  // ---- backup ----
  async exportData() {
    const kv = Object.fromEntries(KEYS.map(k => [k, this[k]]));
    return { app: 'dwell', version: 2, exported: new Date().toISOString(), kv, log: this.log };
  }

  async importData(data) {
    if (data?.app !== 'dwell' || !data.kv) throw new Error('Not a Dwell backup file');
    await db.replaceAll({ kv: data.kv, log: data.log || [] });
    await this.load();
    this.dispatchEvent(new CustomEvent('import'));
    for (const k of KEYS) this.dispatchEvent(new CustomEvent('change', { detail: k }));
  }
}

export const store = new Store();
