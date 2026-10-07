// The reader lays out one whole book in CSS columns, exactly one column per
// screen, and flips by translating the column strip. After every layout it
// measures which verses landed on which page; that verse range — never the
// page index — is the source of truth for position, history and the log.
// Text is set in paragraphs and poetry lines from the version's layout, so a
// verse may be split across blocks: each verse has one or more fragments
// (.v elements sharing a data-id), and the first carries the verse number.
import { BOOKS, bookStart, locate } from './canon.js';
import { loadBook, loadLayout } from './text.js';

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Reader extends EventTarget {
  #token = 0;

  constructor(root) {
    super();
    this.root = root;
    this.viewport = root.querySelector('.reader__viewport');
    this.flow = root.querySelector('.reader__flow');
    this.book = -1;
    this.page = 0;
    this.pages = 1;
    this.step = 1;
    this.verseEls = []; // per verse in the book: its fragments
    this.data = null; // { chapters, layout } of the rendered book
    this.vStart = [];
    this.pageFirst = [];
    this.pageLast = [];
    this.selection = null;
    this.selAnchor = null;
    this.decorator = null;
    this.options = { lines: false, chapterBreak: false, numbers: true, headings: false };
    this.#bindGestures();
    let t;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => this.relayout(), 120);
    }).observe(root);
  }

  setOptions(opts) {
    const structural = ['lines', 'headings'].some(k => k in opts && !!opts[k] !== !!this.options[k]);
    Object.assign(this.options, opts);
    this.flow.classList.toggle('is-lines', !!this.options.lines);
    this.flow.classList.toggle('is-chapter-break', !!this.options.chapterBreak);
    this.flow.classList.toggle('no-numbers', !this.options.numbers);
    if (structural && this.book >= 0) {
      const anchor = this.anchor;
      this.#render(this.book, this.data);
      this.#setPage(this.vStart[anchor - bookStart[this.book]]);
    } else this.relayout();
  }

  // Re-read the current book (after the version changed), keeping the place.
  async reload() {
    if (this.book < 0) return;
    const anchor = this.anchor;
    this.book = -1;
    await this.goTo(anchor);
  }

  get range() {
    return {
      s: bookStart[this.book] + this.pageFirst[this.page],
      e: bookStart[this.book] + this.pageLast[this.page],
    };
  }

  // First verse that begins on the current page; the stable anchor for relayout.
  get anchor() {
    const first = this.pageFirst[this.page];
    for (let i = first; i <= this.pageLast[this.page]; i++) {
      if (this.vStart[i] === this.page) return bookStart[this.book] + i;
    }
    return bookStart[this.book] + first;
  }

  async goTo(id, { at = 'verse', flash = 0 } = {}) {
    const { b } = locate(id);
    const token = ++this.#token;
    const changed = b !== this.book;
    if (changed) {
      const [chapters, layout] = await Promise.all([loadBook(b), loadLayout(b)]);
      if (token !== this.#token) return; // superseded by a later goTo
      this.#render(b, { chapters, layout });
    }
    const p = at === 'last' ? this.pages - 1 : this.vStart[id - bookStart[b]];
    this.#setPage(p, { fade: changed });
    if (flash) this.flash(id, flash === true ? id : flash);
  }

  next() {
    if (this.page < this.pages - 1) this.#setPage(this.page + 1, { animate: true });
    else if (this.book < BOOKS.length - 1) this.goTo(bookStart[this.book + 1]);
    else this.#setPage(this.page, { animate: true });
  }

  prev() {
    if (this.page > 0) this.#setPage(this.page - 1, { animate: true });
    else if (this.book > 0) this.goTo(bookStart[this.book] - 1, { at: 'last' });
    else this.#setPage(0, { animate: true });
  }

  showPage(p, fade = true) { this.#setPage(Math.max(0, Math.min(this.pages - 1, p)), { fade }); }

  // Page that contains the start of a verse in the current book, or -1.
  pageOf(id) {
    const i = id - bookStart[this.book];
    return i >= 0 && i < this.vStart.length ? this.vStart[i] : -1;
  }

  flash(s, e = s) {
    const els = this.#els(s, e);
    els.forEach(el => el.classList.add('is-flash'));
    setTimeout(() => els.forEach(el => el.classList.remove('is-flash')), 1400);
  }

  setSelection(sel) {
    this.selection = sel;
    if (!sel) this.selAnchor = null;
    this.#paintSelection();
    this.dispatchEvent(new CustomEvent('select', { detail: sel }));
  }

  clearSelection() { if (this.selection) this.setSelection(null); }

  // Re-apply star and pin underlines and annotation markers from the decorator.
  decorate() {
    if (this.book < 0 || !this.decorator) return;
    const base = bookStart[this.book];
    const { pins, xref, note, star } = this.decorator(base, base + this.verseEls.length - 1);
    // Markers only change color/background or use absolutely positioned
    // pseudo-elements, so they never alter the measured page layout.
    const c = n => `color-mix(in srgb, var(--pin-${n}) var(--mark-strength), transparent)`;
    // Underlines stack up from the baseline: the star's (full strength, to be
    // found while flipping), then each pin's.
    const STAR = { color: 'var(--star)', h: 2 };
    this.verseEls.forEach((frags, i) => {
      const id = base + i;
      const lines = [...(star.has(id) ? [STAR] : []), ...(pins.get(id) ?? []).map(n => ({ color: c(n), h: 2 }))];
      for (const el of frags) {
        el.classList.toggle('has-xref', xref.has(id));
        el.classList.toggle('has-note', note.has(id));
        el.classList.toggle('is-starred', star.has(id));
        if (lines.length) {
          let y = 0;
          el.style.backgroundImage = lines.map(l => `linear-gradient(${l.color}, ${l.color})`).join(',');
          el.style.backgroundSize = lines.map(l => `100% ${l.h}px`).join(',');
          el.style.backgroundPosition = lines.map(l => { const p = `0 calc(100% - ${y}px)`; y += l.h + 1; return p; }).join(',');
        } else if (el.style.backgroundImage) {
          el.style.backgroundImage = el.style.backgroundSize = el.style.backgroundPosition = '';
        }
      }
    });
  }

  relayout() {
    if (this.book < 0) return;
    const anchor = this.anchor;
    this.#paginate();
    this.#setPage(this.vStart[anchor - bookStart[this.book]]);
  }

  // ---- internals ----

  #render(b, data) {
    const base = bookStart[b];
    const head = `<h1 class="reader__book"><small>${b < 39 ? 'Old Testament' : 'New Testament'}</small>${esc(BOOKS[b].name)}</h1>`;
    this.flow.innerHTML = head + (this.options.lines ? flat(data, base) : structured(data, base, this.options));
    this.verseEls = data.chapters.flat().map(() => []);
    for (const el of this.flow.querySelectorAll('.v')) this.verseEls[el.dataset.id - base].push(el);
    this.data = data;
    this.book = b;
    this.#paginate();
    this.decorate();
    this.#paintSelection();
  }

  #paginate() {
    const h = this.root.clientHeight;
    const gutter = parseFloat(getComputedStyle(this.root).getPropertyValue('--gutter')) || 22;
    // Keep lines a readable length on wide screens: the page is centered.
    const maxLine = parseFloat(getComputedStyle(this.flow).fontSize) * 34;
    const w = Math.floor(Math.min(this.root.clientWidth, maxLine + 2 * gutter));
    const colW = w - 2 * gutter;
    const top = 4, bottom = 0;
    // Snap the column height to whole lines so no line is clipped at the foot.
    const fs = parseFloat(getComputedStyle(this.flow).fontSize);
    const lh = fs * (parseFloat(getComputedStyle(this.flow).lineHeight) / fs || 1.6);
    const colH = Math.max(lh, Math.floor((h - top - bottom) / lh) * lh);

    this.viewport.style.width = `${w}px`;
    Object.assign(this.flow.style, {
      width: `${colW}px`,
      height: `${colH}px`,
      columnWidth: `${colW}px`,
      columnGap: `${2 * gutter}px`,
    });
    this.#slideTo(0);
    this.step = w;

    const left = this.flow.getBoundingClientRect().left;
    const n = this.verseEls.length;
    const vStart = new Array(n);
    const pageFirst = [], pageLast = [];
    for (let i = 0; i < n; i++) {
      let lo = Infinity, hi = -1;
      for (const el of this.verseEls[i]) {
        for (const r of el.getClientRects()) {
          if (r.width < 1) continue;
          const p = Math.floor((r.left - left + 1) / w);
          if (p < lo) lo = p;
          if (p > hi) hi = p;
        }
      }
      if (hi < 0) lo = hi = i ? vStart[i - 1] : 0;
      vStart[i] = lo;
      for (let p = lo; p <= hi; p++) {
        if (pageFirst[p] === undefined) pageFirst[p] = i;
        pageLast[p] = i;
      }
    }
    // Pages with no verse of their own (rare) inherit their neighbour's.
    const pages = pageLast.length || 1;
    for (let p = 0; p < pages; p++) {
      if (pageFirst[p] === undefined) {
        pageFirst[p] = p ? pageLast[p - 1] : 0;
        pageLast[p] = pageFirst[p];
      }
    }
    Object.assign(this, { vStart, pageFirst, pageLast, pages });
  }

  #setPage(p, { animate = false, fade = false, silent = false } = {}) {
    this.page = p;
    this.#slideTo(-p * this.step, animate);
    if (fade) {
      this.flow.classList.remove('is-fading');
      void this.flow.offsetWidth;
      this.flow.classList.add('is-fading');
    }
    if (!silent) this.dispatchEvent(new CustomEvent('page', { detail: this.state() }));
  }

  // Move the column strip, optionally easing there. Animated frame by frame
  // rather than with a CSS transition: starting a transition makes the
  // browser re-layer the whole book (hundreds of pages of text), a pause of a
  // second or more on a phone before the page moves. Setting the transform
  // directly takes the fast path.
  #x = 0;
  #anim = 0;
  #slideTo(x, animate = false) {
    cancelAnimationFrame(this.#anim);
    const dur = animate ? parseFloat(getComputedStyle(this.flow).getPropertyValue('--dur')) || 0 : 0;
    const from = this.#x;
    const set = v => { this.#x = v; this.flow.style.transform = `translateX(${v}px)`; };
    if (!dur || from === x) return set(x);
    const t0 = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - t0) / dur);
      set(t < 1 ? from + (x - from) * (1 - (1 - t) ** 3) : x); // ease-out
      if (t < 1) this.#anim = requestAnimationFrame(frame);
    };
    this.#anim = requestAnimationFrame(frame);
  }

  state() {
    return { book: this.book, page: this.page, pages: this.pages, ...this.range };
  }

  #els(s, e) {
    const base = bookStart[this.book];
    return this.verseEls.slice(Math.max(0, s - base), Math.max(0, e - base + 1)).flat();
  }

  #paintSelection() {
    this.flow.querySelectorAll('.v.is-sel').forEach(el => el.classList.remove('is-sel'));
    if (this.selection && this.book >= 0) {
      this.#els(this.selection.s, this.selection.e).forEach(el => el.classList.add('is-sel'));
    }
  }

  #tapVerse(id) {
    const sel = this.selection;
    if (!sel) {
      this.selAnchor = id;
      this.setSelection({ s: id, e: id });
    } else if (id >= sel.s && id <= sel.e) {
      this.setSelection(null);
    } else {
      const a = this.selAnchor ?? sel.s;
      this.setSelection({ s: Math.min(a, id), e: Math.max(a, id) });
    }
  }

  #bindGestures() {
    const root = this.root;
    let d = null;
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0 || d) return;
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, drag: false, vert: false };
    });
    root.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.drag && !d.vert && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        d.drag = true;
        root.setPointerCapture(e.pointerId);
      } else if (!d.drag && !d.vert && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        d.vert = true; // a vertical swipe: reported when it ends
        root.setPointerCapture(e.pointerId);
      }
      if (d.drag) {
        const atEdge = (this.page === 0 && dx > 0 && this.book === 0) ||
          (this.page === this.pages - 1 && dx < 0 && this.book === BOOKS.length - 1);
        d.dx = atEdge ? dx * 0.3 : dx;
        this.#slideTo(-this.page * this.step + d.dx);
      }
    });
    const end = e => {
      if (!d || e.pointerId !== d.id) return;
      const dt = performance.now() - d.t;
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (d.drag) {
        const v = d.dx / dt; // px per ms
        const threshold = Math.min(80, this.step * 0.18);
        if (d.dx < -threshold || v < -0.45) this.next();
        else if (d.dx > threshold || v > 0.45) this.prev();
        else this.#setPage(this.page, { animate: true, silent: true });
      } else if (d.vert) {
        const dy = e.clientY - d.y;
        if (e.type === 'pointerup' && Math.abs(dy) > 60 && Math.abs(dy) > 1.5 * Math.abs(e.clientX - d.x)) {
          this.dispatchEvent(new CustomEvent('swipe', { detail: dy < 0 ? 'up' : 'down' }));
        }
      } else if (e.type === 'pointerup' && dist < 10 && dt < 600) {
        this.#tap(e);
      }
      d = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }

  #tap(e) {
    // Tapping a marked verse number (or the chapter numeral, for verse 1)
    // opens that verse's references and notes — even at the page edge, where
    // poetry puts many numbers.
    const num = e.target.closest?.('.v__n, .chapter__num');
    const marked = num && (num.closest('.v') ?? this.verseEls[num.dataset.id - bookStart[this.book]]?.[0]);
    if (marked && /has-(xref|note)/.test(marked.className)) {
      return this.dispatchEvent(new CustomEvent('marker', { detail: +marked.dataset.id }));
    }
    const rect = this.root.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    // Outer edges flip; the text column selects verses.
    if (x < 0.14) return this.prev();
    if (x > 0.86) return this.next();
    const v = e.target.closest?.('.v');
    if (v) this.#tapVerse(+v.dataset.id);
    else this.dispatchEvent(new CustomEvent('tapblank'));
  }
}

// One verse per line: no paragraphs or poetry, but psalm titles (part of the
// text, not stored in the verses) still head their verse.
function flat({ chapters, layout }, base) {
  const parts = [];
  let id = base;
  chapters.forEach((verses, c) => {
    const titles = layout[c].filter(e => e[2] === 'd');
    parts.push(`<p class="chapter" data-c="${c}"><span class="chapter__num" data-id="${id}">${c + 1}</span>`);
    verses.forEach((t, v) => {
      for (const e of titles) if (e[0] === v) parts.push(`<span class="hd hd--d">${esc(e[3])}</span>`);
      parts.push(verseOpen(id, v, t, true), t ? `${esc(t)} </span>` : '— </span>');
      id++;
    });
    parts.push('</p>');
  });
  return parts.join('');
}

function verseOpen(id, v, t, first) {
  const cls = `v${first ? '' : ' v--cont'}${t ? '' : ' v--omitted'}`;
  return `<span class="${cls}" data-id="${id}">${first ? `<span class="v__n">${v + 1}</span>` : ''}`;
}

const TEXT_BLOCKS = new Set(['p', 'm', 'q1', 'q2', 'li1', 'li2', 'pc', 'qr']);
const EDITORIAL = new Set(['s', 'ms', 'qa']); // shown only with headings on

// Paragraphs, poetry lines and headings from the layout. Blocks open at
// layout entries; a verse crossing a block boundary is closed and reopened
// as a continuation fragment.
function structured({ chapters, layout }, base, { headings }) {
  const out = [];
  let id = base;
  chapters.forEach((verses, c) => {
    const entries = layout[c], first1 = id;
    let k = 0, block = null, kind = 'p', gap = false, chapterStart = true, numeral = true, afterHeading = true;
    let verse = null; // open fragment: { id }
    const closeVerse = () => { if (verse) { out.push('</span>'); verse = null; } };
    const closeBlock = () => { closeVerse(); if (block) { out.push('</div>'); block = null; } };
    const startMark = () => { const m = chapterStart && c > 0 ? ' ch-start' : ''; chapterStart = false; return m; };
    const openBlock = k2 => {
      closeBlock();
      kind = k2;
      const poetic = /^(q|li)/.test(kind);
      const cls = ['blk', `blk--${kind}`];
      if (gap && poetic) cls.push('blk--gap');
      if (afterHeading || numeral) cls.push('blk--first');
      out.push(`<div class="${cls.join(' ')}${startMark()}">`);
      if (numeral) { out.push(`<span class="chapter__num" data-id="${first1}">${c + 1}</span>`); numeral = false; }
      block = kind; gap = false; afterHeading = false;
    };
    const heading = (hk, text) => {
      if (EDITORIAL.has(hk) && !headings) return;
      closeBlock();
      out.push(`<div class="hd hd--${hk}${startMark()}">${esc(text)}</div>`);
      afterHeading = true;
    };
    verses.forEach((t, v) => {
      let pos = 0, first = true;
      const emit = to => {
        if (to <= pos && !(first && !t)) return;
        if (!block) openBlock(kind === 'b' ? 'p' : kind);
        if (!verse) { out.push(verseOpen(id, v, t, first)); verse = { id }; first = false; }
        out.push(t ? esc(t.slice(pos, to)) : '—');
        pos = to;
      };
      while (k < entries.length && entries[k][0] === v) {
        const [, off, ek, text] = entries[k++];
        emit(off);
        if (text != null) heading(ek, text);
        else if (ek === 'b') gap = true;
        else if (TEXT_BLOCKS.has(ek)) openBlock(ek);
      }
      emit(t.length);
      out.push(' ');
      closeVerse();
      id++;
    });
    closeBlock();
  });
  return out.join('');
}
