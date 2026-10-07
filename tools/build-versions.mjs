// Converts Bible sources into the app's text files, one per version:
//   data/text/<id>.json (+ .gz)  { text: books → chapters → verse strings,
//                                  layout: books → chapters → [entry] }
// and js/versions.js, the version list shared by the app and service worker.
//
// Verse strings are plain text (search, copy and previews use them as is).
// Layout entries place structure into that text: [v, offset, kind] starts a
// block at character `offset` of verse `v` (0-based), and [v, offset, kind,
// text] places a heading there. Block kinds: p (paragraph), m (paragraph
// continuing after poetry, no indent), q1/q2 (poetry lines), li1/li2 (list
// items), pc (centered), qr (right-aligned), b (blank line before the next
// block). Heading kinds: s (section), d (psalm title), ms (book division
// such as "Book II"), qa (acrostic letter).
//
// Every chapter must have exactly the canon's verse count (js/canon-data.js):
// pins, notes and the log store verse ids, so all versions share one grid.
//
// Sources without paragraphs (one plain file per verse) borrow the layout of
// a built version: breaks at verse starts carry over as is, breaks inside a
// verse land on the nearest matching word boundary.
//
// usage: node tools/build-versions.mjs bsb=<engbsb_usfm.zip> net=<NET.epub> csb=<dir> nkjv=<dir>
//   BSB USFM: https://ebible.org/Scriptures/engbsb_usfm.zip (public domain)
//   Build a layout donor (bsb) before the versions that borrow from it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { BOOKS } from '../js/canon-data.js';

const CODES = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH',
  'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO',
  '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN',
  '2JN', '3JN', 'JUD', 'REV'];

// Order here is the order in the version picker. Only a public version may
// be served to everyone; the others go only to the owner's account.
const VERSIONS = {
  bsb: { abbr: 'BSB', name: 'Berean Standard Bible', note: 'Public domain', public: true, parse: parseUsfm },
  net: {
    abbr: 'NET', name: 'New English Translation', note: '© 1996–2016 Biblical Studies Press', parse: parseNetEpub,
    // NET numbers 2 Cor 13 as the Greek does (13 verses); split back to 14.
    fix: books => splitVerse(books, '2CO', 13, 12, 'All the saints greet you.'),
  },
  csb: {
    abbr: 'CSB', name: 'Christian Standard Bible', note: '© 2017 Holman Bible Publishers',
    parse: src => parseVerseFiles(src, { smartQuotes: true }),
    // Like NET, 2 Cor 13 has 13 verses; Acts 24:6b–8a (a footnote in print) is run into 24:6.
    fix: books => {
      splitVerse(books, '2CO', 13, 12, 'All the saints send you greetings.');
      moveText(books, 'ACT', 24, 6, 8, 'By examining him yourself');
      // The source keeps the closing brackets of Mark 16:9–20 and John 7:53–8:11 but not the opening ones.
      for (const ch of books.flat()) ch.verses = ch.verses.map(t => t.includes('[') ? t : t.replace(/\]$/, ''));
    },
    layoutFrom: 'bsb', titles: false, // the source has no psalm titles
  },
  nkjv: {
    abbr: 'NKJV', name: 'New King James Version', note: '© 1982 Thomas Nelson',
    parse: src => parseVerseFiles(src),
    layoutFrom: 'bsb', titles: true, // psalm titles open verse 1; split them out
    capitalLines: true, // poetry lines start with a capital, a strong hint for line breaks
  },
};

// Verses absent from the critical text; every version leaves these empty.
const OMITTED = ['MAT 17:21', 'MAT 18:11', 'MAT 23:14', 'MRK 7:16', 'MRK 9:44', 'MRK 9:46', 'MRK 11:26', 'MRK 15:28',
  'LUK 17:36', 'LUK 23:17', 'JHN 5:4', 'ACT 8:37', 'ACT 15:34', 'ACT 24:7', 'ACT 28:29', 'ROM 16:24'];

// Move the text from `marker` on into the next verse, shifting the rest of
// the chapter down one; the chapter's last verse must be the empty one.
function splitVerse(books, code, c, v, marker) {
  const ch = books[CODES.indexOf(code)][c - 1];
  const at = ch.verses[v - 1].indexOf(marker);
  if (at <= 0 || ch.verses[ch.verses.length - 1]) throw new Error(`can't split ${code} ${c}:${v}`);
  ch.verses.splice(v, 0, ch.verses[v - 1].slice(at));
  ch.verses[v - 1] = ch.verses[v - 1].slice(0, at).trim();
  ch.verses.pop();
  for (const e of ch.layout) {
    if (e[0] === v - 1 && e[1] >= at) { e[0] = v; e[1] -= at; }
    else if (e[0] >= v) e[0]++;
  }
}

// Move the text from `marker` on out of verse `from` into the empty verse `to`.
function moveText(books, code, c, from, to, marker) {
  const vs = books[CODES.indexOf(code)][c - 1].verses;
  const at = vs[from - 1].indexOf(marker);
  if (at <= 0 || vs[to - 1]) throw new Error(`can't move ${code} ${c}:${from} → ${to}`);
  vs[to - 1] = vs[from - 1].slice(at);
  vs[from - 1] = vs[from - 1].slice(0, at).trim();
}

// ---- shared builder: events → verse strings + layout ----

function builder(b) {
  const chapters = BOOKS[b].verses.map(n => ({ verses: new Array(n).fill(''), layout: [] }));
  let c = -1, v = -1, pending = [];
  const where = () => `${BOOKS[b].name} ${c + 1}:${v + 1}`;
  return {
    chapter(n) { c = n - 1; v = -1; if (!chapters[c]) throw new Error(`${BOOKS[b].name}: no chapter ${n}`); },
    verse(n) {
      v = n - 1;
      if (v >= chapters[c].verses.length) throw new Error(`${where()}: beyond the canon's ${chapters[c].verses.length} verses`);
      if (chapters[c].verses[v]) throw new Error(`${where()}: verse appears twice`);
    },
    block(kind) {
      // A block with no text before the next one (NET has empty <div class='p'>) is dropped.
      if (kind !== 'b') pending = pending.filter(([k, text]) => text || k === 'b');
      pending.push([kind]);
    },
    heading(kind, text) { text = clean(text); if (text) pending.push([kind, text]); },
    text(t) {
      t = t.replace(/\s+/g, ' ').replace(/(\S) ([)\],.;:!?])/g, '$1$2');
      if (!t.trim()) { if (v >= 0 && !pending.length) this.space(); return; }
      if (v < 0) throw new Error(`${BOOKS[b].name} ${c + 1}: text before the first verse: ${t.slice(0, 40)}`);
      const ch = chapters[c];
      let cur = ch.verses[v];
      if (pending.length) {
        cur = cur.trimEnd();
        if (cur) cur += ' ';
        for (const [kind, text] of pending) ch.layout.push(text ? [v, cur.length, kind, text] : [v, cur.length, kind]);
        pending = [];
        t = t.trimStart();
      } else if (!cur || cur.endsWith(' ') || /^\s+[)\],.;:!?’”]/.test(t)) {
        // Removed note markers leave a space before punctuation: "(… happened )".
        t = t.trimStart();
        if (/^[)\],.;:!?’”]/.test(t)) cur = cur.trimEnd();
      }
      ch.verses[v] = cur + t;
    },
    space() { const ch = chapters[c]; if (ch && v >= 0 && ch.verses[v] && !ch.verses[v].endsWith(' ')) ch.verses[v] += ' '; },
    done() {
      return chapters.map(ch => {
        const verses = ch.verses.map(s => s.trim());
        // Offsets were measured before trimming; a verse only loses trailing space.
        ch.layout.forEach(e => { e[1] = Math.min(e[1], verses[e[0]].length); });
        return { verses, layout: dedupe(ch.layout) };
      });
    },
  };
}

// Blank-line markers only matter before a block; drop repeats and strays.
function dedupe(layout) {
  const out = [];
  for (const e of layout) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === e[0] && prev[1] === e[1] && prev.length === 3 && e.length === 3 && prev[2] === e[2]) continue;
    out.push(e);
  }
  return out;
}

const clean = s => decode(s).replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()]).replace(/ /g, ' ');

function unzip(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwell-'));
  execFileSync('unzip', ['-q', '-o', file, '-d', dir]);
  return dir;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

// ---- USFM (BSB from ebible.org) ----

function parseUsfm(src) {
  const files = walk(fs.statSync(src).isDirectory() ? src : unzip(src)).filter(f => f.endsWith('.usfm'));
  return CODES.map((code, b) => {
    const file = files.find(f => fs.readFileSync(f, 'utf8').startsWith(`\\id ${code}`));
    if (!file) throw new Error(`no USFM file for ${code}`);
    let s = fs.readFileSync(file, 'utf8');
    // Drop footnotes, cross references and word-level attributes.
    const note = m => new RegExp(`\\\\${m} (?:(?!\\\\${m}\\*)[\\s\\S])*\\\\${m}\\*`, 'g');
    s = s.replace(new RegExp(`\\s*${note('f').source}(?=[)\\],.;:!?’”—])`, 'g'), '').replace(note('f'), '').replace(note('x'), '')
      .replace(/\\\+?w ([^|\\]*)(\|[^\\]*)?\\\+?w\*/g, '$1')
      .replace(/\\\+?(it|bd|sc|em|nd|add|qs|wj)\*?/g, '');
    const B = builder(b);
    let afterBreak = true; // at chapter start, after \b or a heading
    let poetry = false;
    for (const line of s.split(/\r?\n/)) {
      const m = line.match(/^\\(\w+)\s?(.*)$/);
      if (!m) { B.text(` ${line}`); continue; }
      const [, tag, rest] = m;
      if (tag === 'c') { B.chapter(+rest.trim()); afterBreak = true; poetry = false; continue; }
      if (['id', 'h', 'toc1', 'toc2', 'toc3', 'mt', 'mt1', 'mt2', 'r', 'mr', 'ide'].includes(tag)) continue;
      if (tag === 'b') { B.block('b'); afterBreak = true; continue; }
      if (/^s\d?$/.test(tag)) { B.heading('s', rest); afterBreak = true; continue; }
      if (/^ms\d?$/.test(tag)) { B.heading('ms', rest); afterBreak = true; continue; }
      if (tag === 'd') { B.heading('d', rest); afterBreak = true; continue; }
      if (tag === 'qa') { B.heading('qa', rest); afterBreak = true; continue; }
      let kind;
      if (tag === 'm' || tag === 'pmo' || tag === 'p' || tag === 'pi' || tag === 'pi1' || tag === 'nb')
        kind = tag === 'm' && poetry && !afterBreak ? 'm' : 'p';
      else if (/^q[1-3]?$/.test(tag)) kind = tag === 'q' || tag === 'q1' ? 'q1' : 'q2';
      else if (/^li[12]?$/.test(tag)) kind = tag === 'li2' ? 'li2' : 'li1';
      else if (tag === 'pc' || tag === 'qr') kind = tag;
      else if (tag !== 'v') throw new Error(`${code}: unhandled USFM marker \\${tag}`);
      if (kind) { B.block(kind); poetry = /^(q|li)/.test(kind); afterBreak = false; }
      inline(B, tag === 'v' ? line.slice(1) : rest);
    }
    return B.done();
  });

  // Verse markers can also appear mid-line.
  function inline(B, s) {
    const parts = s.split(/\\v (\d+)\s?/);
    // A line that starts with "\v N" splits into ['', N, text…]; mid-line text comes first.
    if (s.startsWith('v ')) { const [, n, ...more] = s.match(/^v (\d+)\s?([\s\S]*)$/); B.verse(+n); return inline(B, more.join('')); }
    B.text(parts[0] ? ` ${parts[0]}` : '');
    for (let i = 1; i < parts.length; i += 2) { B.verse(+parts[i]); B.text(parts[i + 1]); }
    if (/\\\w/.test(s.replace(/\\v \d+/g, ''))) throw new Error(`leftover USFM in: ${s.slice(0, 80)}`);
  }
}

// ---- NET Bible EPUB (one XHTML file per book, USFM-style classes) ----

function parseNetEpub(src) {
  const files = walk(unzip(src));
  return CODES.map((code, b) => {
    const file = files.find(f => path.basename(f) === `${code}.xhtml`);
    if (!file) throw new Error(`no ${code}.xhtml in ${src}`);
    let html = fs.readFileSync(file, 'utf8');
    html = html.slice(html.indexOf("<div class='main'"));
    html = html.replace(/<div class="footnote">[\s\S]*?(?=<\/div>\s*<\/div>\s*<\/body>)/g, '');
    const B = builder(b);
    const stack = []; // open elements: { tag, cls }
    let skip = 0, capture = null, upper = 0;
    for (const tok of html.match(/<[^>]+>|[^<]+/g)) {
      if (tok[0] !== '<') {
        if (skip) continue;
        const t = upper ? tok.toUpperCase() : tok;
        if (capture) capture.text += t;
        else B.text(decode(t));
        continue;
      }
      const close = tok.match(/^<\/(\w+)/);
      if (close) {
        const el = stack.pop();
        if (!el) continue;
        if (el.skip) skip--;
        if (el.upper) upper--;
        if (el.capture) {
          const text = clean(capture.text);
          if (el.cls === 'psalmlabel') B.chapter(+text);
          else if (el.cls === 'verse') B.verse(+text);
          else B.heading(el.kind, text);
          capture = null;
        }
        continue;
      }
      const m = tok.match(/^<(\w+)([^>]*?)(\/?)>$/);
      if (!m) continue;
      const [, tag, attrs, selfClose] = m;
      if (tag === 'br') { if (!skip && !capture) B.space(); continue; }
      if (selfClose || tag === 'hr' || tag === 'img') continue;
      const cls = (attrs.match(/class=['"]([^'"]*)['"]/) || [])[1] || '';
      const el = { tag, cls };
      stack.push(el);
      if (skip) { el.skip = true; skip++; continue; }
      if (tag === 'a' || ['notemark', 'noteref', 'footnote', 'f', 'x', 'xo', 'fr', 'ft', 'fl', 'mt', 'tnav'].includes(cls)) {
        el.skip = true; skip++; continue;
      }
      if (tag === 'div') {
        if (cls === 'psalmlabel' || cls === 's' || cls === 'd' || cls === 'ms' || cls === 'ms2') {
          el.capture = true; el.kind = { s: 's', d: 'd', ms: 'ms', ms2: 'ms' }[cls]; capture = { text: '' };
        } else if (cls === 'p' || cls === 'pi') B.block('p');
        else if (cls === 'm') B.block('m');
        else if (cls === 'q' || cls === 'q1') B.block('q1');
        else if (cls === 'q2') B.block('q2');
        else if (cls !== 'main') throw new Error(`${code}: unhandled block class "${cls}"`);
      } else if (tag === 'span') {
        if (cls === 'verse') { el.capture = true; capture = { text: '' }; }
        else if (cls === 'nd') { el.upper = true; upper++; }
      }
    }
    return B.done();
  });
}

// ---- plain verse files (data/<global verse number>.txt, 1-based) ----

function parseVerseFiles(src, { smartQuotes = false } = {}) {
  const dir = fs.existsSync(path.join(src, 'data')) ? path.join(src, 'data') : src;
  let n = 0;
  return BOOKS.map(bk => bk.verses.map(len => {
    const verses = [];
    for (let v = 0; v < len; v++) {
      let t = fs.readFileSync(path.join(dir, `${++n}.txt`), 'utf8');
      t = clean(t.replace(/<[^>]*>|\[\/?i\]/g, '')).replace(/\u200b/g, '');
      if (smartQuotes) t = curl(t);
      verses.push(t.replace(/(\S) ([)\],.;:!?])/g, '$1$2'));
    }
    return { verses, layout: [] };
  }));
}

// Typewriter quotes and dashes → typographic.
function curl(t) {
  return t.replace(/--/g, '—')
    .replace(/(^|[\s(\[—“‘])"/g, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s(\[—“])'/g, '$1‘').replace(/'/g, '’');
}

// Fit a donor version's layout onto another version's verses.
function borrowLayout(books, donor, opts) {
  const { titles } = opts;
  books.forEach((chs, b) => chs.forEach((ch, c) => {
    const dv = donor.text[b][c], entries = donor.layout[b][c];
    const layout = [];
    // Psalm titles: the donor's title marks which verses open with one.
    const titleOf = new Map();
    for (const e of entries) {
      if (e[2] !== 'd' || !titles) continue;
      const split = splitTitle(ch.verses[e[0]], e[3], dv[e[0]]);
      if (!split) throw new Error(`no psalm title found in ${BOOKS[b].name} ${c + 1}:${e[0] + 1}`);
      ch.verses[e[0]] = split.rest;
      titleOf.set(e, split.title);
    }
    // Inside a verse, place all of the donor's breaks together.
    const placed = new Map(); // "v:off" → target offset, or null if dropped
    for (let v = 0; v < ch.verses.length; v++) {
      const offs = [...new Set(entries.filter(e => e[0] === v && e[1] > 0 && e[2] !== 'd').map(e => e[1]))].sort((x, y) => x - y);
      const at = placeBreaks(ch.verses[v], offs.map(o => o / dv[v].length), opts);
      offs.forEach((o, j) => placed.set(`${v}:${o}`, at[j]));
    }
    for (const e of entries) {
      if (e[2] === 'd') { if (titleOf.has(e)) layout.push([e[0], 0, 'd', titleOf.get(e)]); continue; }
      const [v, off] = e;
      if (!ch.verses[v] && off) continue;
      const at = off ? placed.get(`${v}:${off}`) : 0;
      if (at == null) continue;
      layout.push(e.length === 4 ? [v, at, e[2], e[3]] : [v, at, e[2]]);
    }
    layout.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // stable: keeps the donor's order at a spot
    ch.layout = dedupe(layout);
  }));
}

// Word starts in `t` for breaks at relative positions `rs` (ascending), as
// a best ordered assignment: close to the donor's position, and after
// punctuation, or before a word that opens a phrase (how poetry lines end and
// begin). A break with no good spot is dropped (null): better a long line
// than a split phrase.
const OPENS = /^(and|but|for|or|nor|so|yet|who|whom|whose|which|that|when|while|where|as|because|since|if|though|until|in|on|at|by|from|with|without|like|before|after|over|under|through|into|upon|against|among|O)\b/i;
const BINDS = /\b(the|a|an|of|to|my|your|his|her|our|their|its|thy|this|these|those)$/i;
function placeBreaks(t, rs, { capitalLines = false } = {}) {
  if (!rs.length) return [];
  const cand = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i - 1] !== ' ') continue;
    const next = t.slice(i), prev = t.slice(0, i - 1);
    let fit = /[,;:.!?—”’)]$/.test(prev) ? 0
      : capitalLines && /^[“‘]?[A-Z]/.test(next) ? 0.06
      : OPENS.test(next) ? 0.12 : 0.3;
    if (BINDS.test(prev)) fit += 0.5;
    cand.push({ i, r: i / t.length, fit });
  }
  const DROP = 0.25;
  // best[j][k]: cost of placing breaks 0..j-1 using candidates before k.
  const n = cand.length, J = rs.length;
  const best = Array.from({ length: J + 1 }, () => new Array(n + 1).fill(Infinity));
  const how = Array.from({ length: J + 1 }, () => new Array(n + 1).fill(null));
  for (let k = 0; k <= n; k++) best[0][k] = 0;
  for (let j = 1; j <= J; j++) {
    for (let k = 0; k <= n; k++) {
      // drop break j-1
      if (best[j - 1][k] + DROP < best[j][k]) { best[j][k] = best[j - 1][k] + DROP; how[j][k] = ['drop']; }
      // or use candidate k-1 for it
      if (k > 0) {
        const c = cand[k - 1];
        const cost = best[j - 1][k - 1] + Math.abs(c.r - rs[j - 1]) + c.fit;
        if (cost < best[j][k]) { best[j][k] = cost; how[j][k] = ['use', k - 1]; }
      }
      // or skip candidate k-1
      if (k > 0 && best[j][k - 1] < best[j][k]) { best[j][k] = best[j][k - 1]; how[j][k] = ['skip']; }
    }
  }
  const out = new Array(J).fill(null);
  for (let j = J, k = n; j > 0;) {
    const [op, ci] = how[j][k];
    if (op === 'drop') j--;
    else if (op === 'use') { out[j - 1] = cand[ci].i; j--; k--; }
    else k--;
  }
  return out;
}

// Split a psalm title off the start of a verse: the sentence boundary whose
// share of the verse best matches the donor title's share of its verse.
function splitTitle(t, donorTitle, donorVerse) {
  const r = donorTitle.length / (donorTitle.length + donorVerse.length + 1);
  let best = null;
  for (const m of t.matchAll(/[.:?!]["”’]? (?=[“‘"']?[A-Z])/g)) {
    const at = m.index + m[0].length;
    const d = Math.abs(at / t.length - r);
    if (!best || d < best.d) best = { at, d };
  }
  if (!best || best.d > 0.25) return null;
  // Take in short title phrases that follow ("A Psalm of David. A Contemplation.").
  for (let m; (m = t.slice(best.at).match(/^(?:A|To|For|Of|Set to|With|On) [^.:?!]{0,30}[.] (?=[“‘"']?[A-Z])/));) best.at += m[0].length;
  return { title: t.slice(0, best.at).trim(), rest: t.slice(best.at).trim() };
}

// ---- main ----

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
if (!Object.keys(args).length) { console.error('usage: build-versions.mjs bsb=<usfm.zip> net=<NET.epub> …'); process.exit(1); }
fs.mkdirSync(path.resolve('data', 'text'), { recursive: true });
for (const [id, src] of Object.entries(args)) {
  const ver = VERSIONS[id];
  if (!ver) throw new Error(`unknown version "${id}"; known: ${Object.keys(VERSIONS).join(', ')}`);
  const books = ver.parse(src);
  ver.fix?.(books);
  if (ver.layoutFrom) {
    const donor = path.resolve('data', 'text', `${ver.layoutFrom}.json`);
    if (!fs.existsSync(donor)) throw new Error(`${id} borrows layout from ${ver.layoutFrom}; build that first`);
    borrowLayout(books, JSON.parse(fs.readFileSync(donor, 'utf8')), ver);
  }
  books.forEach((chs, b) => chs.forEach((ch, c) => {
    if (ch.verses.length !== BOOKS[b].verses[c]) throw new Error(`${id} ${BOOKS[b].name} ${c + 1}: verse count`);
    ch.verses.forEach((t, v) => {
      // An unexpected gap usually means the source numbers verses differently.
      if (!t && !OMITTED.includes(`${CODES[b]} ${c + 1}:${v + 1}`)) throw new Error(`${id} ${BOOKS[b].name} ${c + 1}:${v + 1} is empty`);
    });
  }));
  const empty = books.flat().flatMap(ch => ch.verses).filter(v => !v).length;
  const out = path.resolve('data', 'text', `${id}.json`);
  const json = JSON.stringify({ text: books.map(chs => chs.map(ch => ch.verses)), layout: books.map(chs => chs.map(ch => ch.layout)) });
  fs.writeFileSync(out, json);
  fs.writeFileSync(`${out}.gz`, zlib.gzipSync(json, { level: 9 }));
  console.log(`${id}: ${(json.length / 1e6).toFixed(1)} MB, ${empty} empty verses → ${path.relative('.', out)}`);
}

// The list covers every version with a built file, so building one at a time works.
const built = Object.keys(VERSIONS).filter(id => fs.existsSync(path.resolve('data', 'text', `${id}.json`)));
const list = built.map(id => ({ id, abbr: VERSIONS[id].abbr, name: VERSIONS[id].name, note: VERSIONS[id].note, public: !!VERSIONS[id].public }));
fs.writeFileSync(path.resolve('js', 'versions.js'), `// Generated by tools/build-versions.mjs — do not edit.
// A classic script too, so the service worker can importScripts() it.
self.DWELL_VERSIONS = ${JSON.stringify(list, null, 2)};
`);
console.log(`js/versions.js: ${built.join(', ')}`);
