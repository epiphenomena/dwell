// History sheet: heatmap of every chapter by reading recency, and a
// timeline of reading sessions from the log. Reading at the ribbon and
// reading elsewhere are shown apart; the ribbon side also shows the streak.
import { h, fill, fmtDate, fmtTime } from '../dom.js';
import { BOOKS, CHAPTERS, fmtRange } from '../canon.js';
import { openSheet } from '../sheet.js';
import { store } from '../store.js';
import { sessions } from '../history.js';
import { WINDOWS, chapterHeat, coverage, level, ribbonStreak } from '../heat.js';
import { pinIcon } from './dock.js';

const KIND_LABELS = { ribbon: 'Ribbon', other: 'Elsewhere' };

export function openHistory({ go, tab = 'heatmap' }) {
  const kinds = h('div', { class: 'seg history__kinds' });
  const tabs = h('div', { class: 'seg' });
  const streak = h('div', { class: 'streak' });
  const content = h('div', { class: 'history' });
  const reset = h('div', { class: 'history__reset' });
  const sheet = openSheet({ title: 'History', close: 'x', body: [kinds, streak, tabs, content, reset] });
  const kind = () => store.settings.historyKind;

  const TABS = { heatmap, timeline };
  function show(name) {
    tab = name;
    kinds.replaceChildren(...Object.entries(KIND_LABELS).map(([k, label]) => h('button', {
      class: `seg__btn${k === kind() ? ' is-active' : ''}`, onclick: () => { store.setting('historyKind', k); show(tab); },
    }, k === 'ribbon' ? pinIcon('ribbon') : null, label)));
    tabs.replaceChildren(...Object.keys(TABS).map(k => h('button', {
      class: `seg__btn${k === name ? ' is-active' : ''}`, onclick: () => show(k),
    }, k === 'heatmap' ? 'Heatmap' : 'Timeline')));
    renderStreak();
    TABS[name]();
    renderReset();
  }

  function renderStreak() {
    streak.hidden = kind() !== 'ribbon';
    if (streak.hidden) return;
    const { current, longest, today } = ribbonStreak();
    const days = n => `${n} day${n === 1 ? '' : 's'}`;
    streak.replaceChildren(
      h('div', { class: 'streak__now' }, h('strong', {}, current), h('span', {}, 'day streak')),
      h('div', { class: 'streak__meta' },
        current ? (today ? 'Read at the ribbon today' : 'Read today to keep it going') : 'Read at the ribbon to start one',
        h('br'), `Longest: ${days(longest)}`),
    );
  }

  // Resetting needs a second tap; it applies on every synced device.
  function renderReset() {
    const k = kind();
    let armed = 0;
    const label = `Reset ${k === 'ribbon' ? 'ribbon' : 'other reading'} history`;
    const btn = h('button', { class: 'btn btn--ghost btn--danger', onclick: () => {
      if (Date.now() - armed > 4000) { armed = Date.now(); btn.textContent = 'Tap again to reset'; return; }
      store.resetHistory(k);
      show(tab);
    } }, label);
    const since = store.resets[k];
    fill(reset, btn, since ? h('p', { class: 'menu__note' }, `Counting since ${fmtDate(since, { month: 'short', day: 'numeric', year: 'numeric' })}.`) : null);
  }

  function heatmap() {
    const days = store.settings.heatWindow;
    const heat = chapterHeat(days, kind());
    const win = WINDOWS.find(w => w.days === days) ?? WINDOWS[2];
    const pct = (coverage(days, kind()) * 100).toFixed(1);
    const touched = heat.filter(v => v > 0).length;

    const windows = h('div', { class: 'chips' }, WINDOWS.map(w => h('button', {
      class: `chip${w.days === days ? ' is-active' : ''}`,
      onclick: () => { store.setting('heatWindow', w.days); heatmap(); },
    }, w.label)));

    const books = BOOKS.map((bk, b) => h('div', { class: 'heat__book' },
      h('span', { class: 'heat__label' }, bk.abbr),
      h('div', { class: 'heat__cells' }),
    ));
    CHAPTERS.forEach((ch, i) => {
      books[ch.b].lastChild.append(h('button', {
        class: 'heat__cell', 'data-heat': level(heat[i]),
        'aria-label': `${BOOKS[ch.b].name} ${ch.c + 1}`,
        onclick: () => go(ch.s, { flash: false }),
      }));
    });

    content.replaceChildren(
      windows,
      h('p', { class: 'heat__stats' },
        h('strong', {}, `${pct}%`), ` of verses read ${days ? `in the last ${win.label.toLowerCase()}` : 'ever'} · `,
        h('strong', {}, touched), ` of ${CHAPTERS.length} chapters touched`),
      h('div', { class: 'heat__legend' }, 'older', [1, 2, 3, 4].map(l => h('i', { class: 'heat__cell', 'data-heat': l })), 'recent',
        h('i', { class: 'heat__cell', 'data-heat': 0, style: { marginLeft: '12px' } }), 'unread'),
      h('div', { class: 'heat' }, books),
    );
  }

  function timeline() {
    const all = sessions(kind()).reverse();
    let shown = 0;
    const list = h('div', { class: 'list' });
    const more = h('button', { class: 'btn btn--ghost', onclick: page }, 'Show more');
    let lastDay = '';
    function page() {
      for (const s of all.slice(shown, shown + 150)) {
        const day = fmtDate(s.t, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
        if (day !== lastDay) { list.append(h('h3', { class: 'list__group' }, day)); lastDay = day; }
        const mins = Math.max(1, Math.round(s.d / 60000));
        list.append(h('button', { class: 'list__item', onclick: () => go(s.last, { flash: false }) },
          h('span', { class: 'list__meta' }, fmtTime(s.t)),
          h('span', { class: 'list__main' }, fmtRange(s.s, s.e)),
          h('span', { class: 'list__meta' }, `${mins} min · ${s.pages} pg`),
        ));
      }
      shown += 150;
      more.hidden = shown >= all.length;
    }
    page();
    content.replaceChildren(all.length ? list : h('p', { class: 'empty' }, kind() === 'ribbon' ? 'Nothing read at the ribbon yet.' : 'Nothing read yet.'), more);
  }

  show(tab);
  return sheet;
}
