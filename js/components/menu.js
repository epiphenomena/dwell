// Menu: history, notes, stars, tags, cross references; display settings; how
// to use; sync and backup.
import { h, fill, svg, ICONS, fmtAgo } from '../dom.js';
import { openSheet, toast } from '../sheet.js';
import { store } from '../store.js';
import { available } from '../text.js';
import * as acct from '../account.js';
import { openNotes } from './notes.js';
import { openTags, openCrossRefs, openStars } from './tags.js';
import { openHistory } from './history-view.js';
import sync, { status, syncNow, exportServer } from '../sync.js';

export function openMenu({ go, toggleFullscreen }) {
  const body = h('div', { class: 'menu' });
  const syncBox = h('div', { class: 'sync' });
  const onStatus = () => renderSync(syncBox);
  // Signing in or out here changes which versions there are.
  const onAccount = () => {
    onStatus();
    const el = versionPicker();
    versionEl.replaceWith(el);
    versionEl = el;
    fill(aboutEl, available().map(v => h('p', {}, `${v.abbr}: ${v.name}. ${v.note}.`)));
  };
  sync.addEventListener('status', onStatus);
  acct.account.addEventListener('change', onAccount);
  // An X until a setting changes, then a check: closing keeps the change.
  const sheet = openSheet({ title: 'Dwell', body, close: 'x', onClose: () => { sync.removeEventListener('status', onStatus); acct.account.removeEventListener('change', onAccount); } });
  const s = store.settings;
  const changed = () => sheet.setCloseIcon('check');

  const segment = (name, options) => h('div', { class: 'seg' }, options.map(([value, label]) => h('button', {
    class: `seg__btn${s[name] === value ? ' is-active' : ''}`,
    onclick: e => {
      store.setting(name, value);
      changed();
      e.target.parentNode.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('is-active', b === e.target));
    },
  }, label)));

  const toggle = (name, label) => h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: !!s[name], onchange: e => { store.setting(name, e.target.checked); changed(); } }),
    h('span', { class: 'switch__track' }), h('span', {}, label));

  const versionPicker = () => (available().length > 1 ? segment('version', available().map(v => [v.id, v.abbr])) : closedVersions());
  let versionEl = versionPicker();
  const aboutEl = h('div', { class: 'menu__about' }, available().map(v => h('p', {}, `${v.abbr}: ${v.name}. ${v.note}.`)));

  const sizeLabel = h('span', { class: 'stepper__value' }, `${s.textSize}px`);
  const size = d => {
    const v = Math.max(14, Math.min(32, store.settings.textSize + d));
    store.setting('textSize', v);
    changed();
    sizeLabel.textContent = `${v}px`;
  };

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await store.importData(data);
      toast('Backup restored');
      sheet.close();
    } catch (err) { toast(err.message || 'Import failed'); }
  } });
  // Replacing everything is destructive; require a second tap.
  let armed = 0;
  const importBtn = h('button', { class: 'btn btn--ghost', onclick: () => {
    if (Date.now() - armed < 4000) { fileInput.click(); armed = 0; importBtn.textContent = 'Import backup…'; return; }
    armed = Date.now();
    importBtn.textContent = 'Tap again: replaces all data';
  } }, 'Import backup…');

  body.append(
    h('nav', { class: 'menu__links' },
      h('button', { class: 'list__item', onclick: () => openHistory({ go }) }, svg(ICONS.grid), h('span', { class: 'list__main' }, 'History'), h('span', { class: 'list__meta' }, 'heatmap · timeline')),
      h('button', { class: 'list__item', onclick: () => openNotes({ go }) }, svg(ICONS.note), h('span', { class: 'list__main' }, 'Notes'), h('span', { class: 'list__meta' }, store.notes.length)),
      h('button', { class: 'list__item', onclick: () => openStars({ go }) }, svg(ICONS.star, 'icon icon--star'), h('span', { class: 'list__main' }, 'Starred'), h('span', { class: 'list__meta' }, store.stars.length)),
      h('button', { class: 'list__item', onclick: () => openTags({ go }) }, svg(ICONS.tag), h('span', { class: 'list__main' }, 'Tags'), h('span', { class: 'list__meta' }, store.tagNames().length)),
      h('button', { class: 'list__item', onclick: () => openCrossRefs({ go }) }, svg(ICONS.link), h('span', { class: 'list__main' }, 'Cross references'), h('span', { class: 'list__meta' }, store.groups.filter(g => !g.name).length)),
    ),
    h('h3', { class: 'list__group' }, 'Display'),
    h('div', { class: 'form' },
      versionEl,
      segment('theme', [['dark', 'Dark'], ['sepia', 'Sepia'], ['light', 'Light']]),
      segment('font', [['serif', 'Serif'], ['sans', 'Sans serif']]),
      h('div', { class: 'stepper' },
        h('span', {}, 'Text size'),
        h('button', { class: 'stepper__btn', 'aria-label': 'Smaller text', onclick: () => size(-1) }, 'A−'),
        sizeLabel,
        h('button', { class: 'stepper__btn', 'aria-label': 'Larger text', onclick: () => size(1) }, 'A+'),
      ),
      segment('lines', [[false, 'Flowing text'], [true, 'Verse per line']]),
      toggle('numbers', 'Verse numbers'),
      toggle('headings', 'Section headings'),
      toggle('chapterBreak', 'Start chapters on a new page'),
      document.fullscreenEnabled ? h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked: !!document.fullscreenElement, onchange: () => { toggleFullscreen(); changed(); } }),
        h('span', { class: 'switch__track' }), h('span', {}, 'Fullscreen')) : null,
      toggle('autoFullscreen', 'Go fullscreen on first tap'),
      'wakeLock' in navigator ? toggle('keepAwake', 'Keep the screen on') : null,
    ),
    howTo(),
    h('h3', { class: 'list__group' }, 'Sync'),
    syncBox,
    h('h3', { class: 'list__group' }, 'Backup file'),
    h('p', { class: 'menu__note' }, 'A JSON file of everything on this device.'),
    h('div', { class: 'form__row' },
      h('button', { class: 'btn', onclick: exportBackup }, 'Export backup'),
      importBtn, fileInput,
    ),
    aboutEl,
    credits(),
  );
  renderSync(syncBox);
  return sheet;
}

// Where Dwell comes from: its maker and its source.
function credits() {
  const link = (href, label) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
  return h('p', { class: 'menu__credits' },
    'Dwell · ', link('https://github.com/epiphenomena/dwell', 'Source'),
    ' · ', link('https://epiphenomena.github.io/', 'epiphenomena'));
}

// How to use, folded away until wanted.
const HOW_TO = [
  ['Turning pages', 'Swipe left or right, or tap the left or right edge of the page. Drag along the line above the pins to skim through the book; tap it to go to a book and chapter.'],
  ['Selecting verses', 'Tap a verse to select it; tap another to extend the selection. Tap a selected verse to clear it.'],
  ['Pins', 'With verses selected, tap a pin to place it there. Tap a pin to go to its passage. Hold a pin to clear it.'],
  ['The ribbon', 'Tap the ribbon to place it on the page you are reading; it moves along as you read on. Tap it later to return; hold it to move it to this page. Reading at the ribbon has its own history and streak.'],
  ['Stars', 'Select verses and tap the asterisk to star them; they get an underline in the star color, easy to spot while flipping. Tap the asterisk again on a starred passage to unstar it.'],
  ['References and tags', 'With verses selected, tap the link button and then a pin to cross-reference the two. Tag verses to group them with other passages. Marked verse numbers open what is attached to them.'],
  ['Notes', 'Select verses and tap the note button, or start one from Notes. Attach passages with the pin buttons at the foot of a note. Swipe up on the text to open your latest note.'],
  ['Search', 'Words match at their start, so “love” also finds loved and loves. Put a phrase in quotes to match it exactly. Notes have their own filter too.'],
  ['History', 'Swipe down on the text to open the timeline. Hold the back arrow for history. Back and forward step between places you jumped to.'],
];

function howTo() {
  return h('details', { class: 'howto' },
    h('summary', { class: 'list__group howto__head' }, 'How to use'),
    HOW_TO.map(([title, text]) => h('div', { class: 'howto__item' }, h('h4', {}, title), h('p', {}, text))),
  );
}

// Where the version picker would be, for everyone who can only have the
// one open translation.
function closedVersions() {
  return h('div', { class: 'closed' },
    h('p', {}, 'Dwell offers the Berean Standard Bible, which its translators gave to the public domain so that anyone may read, copy and share it.'),
    h('p', {}, 'Most modern translations are not like that. They are copyrighted, and their publishers charge licensing fees and restrict where the text may appear, so a free reader like this one can’t include them.'),
    h('p', {}, '“Freely you have received; freely give” (Matthew 10:8). The word of God should not be paywalled.'),
  );
}

// Signed out: ask for an email address (a token is sent there), or take a
// token pasted from such an email.
function renderSignIn(box) {
  const msg = h('p', { class: 'menu__note', role: 'status' });
  const email = h('input', { class: 'field', type: 'email', placeholder: 'Email address', autocomplete: 'email', enterkeyhint: 'send', autocapitalize: 'off', spellcheck: 'false' });
  const send = h('button', { class: 'btn', onclick: async () => {
    send.disabled = true;
    msg.textContent = 'Sending…';
    try {
      await acct.requestSignIn(email.value);
      msg.textContent = `Sent. Open the link in the email to ${email.value.trim()}, or paste its token below.`;
    } catch (err) { msg.textContent = err.message; }
    send.disabled = false;
  } }, 'Email me a sign-in link');
  email.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });
  const tokenIn = h('input', { class: 'field', type: 'text', placeholder: 'Paste a sign-in token', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const use = h('button', { class: 'btn btn--ghost', onclick: async () => {
    try { await acct.useToken(tokenIn.value); } catch (err) { msg.textContent = err.message; }
  } }, 'Sign in');
  tokenIn.addEventListener('keydown', e => { if (e.key === 'Enter') use.click(); });
  fill(box,
    h('p', { class: 'menu__note' }, 'Sign in to keep pins, stars, notes and reading history in step across your devices. Everything works on this device without an account. Your email address is used only to send you sign-in links.'),
    email, h('div', { class: 'form__row' }, send),
    h('details', { class: 'tokenin' }, h('summary', { class: 'menu__note' }, 'Have a token?'), tokenIn, h('div', { class: 'form__row' }, use)),
    msg,
  );
}

// Sync status for the signed-in account.
function renderSync(box) {
  const s = status();
  if (!s.signedIn) return renderSignIn(box);
  if (!s.available) {
    fill(box, h('p', { class: 'menu__note' }, 'Sync is off: this copy is served without its backend, so everything stays on this device.'));
    return;
  }
  const line = s.running ? 'Syncing…'
    : s.error ? `Sync problem: ${s.error}`
    : s.last ? `Synced ${fmtAgo(s.last)}` : 'Not synced yet';
  fill(box,
    h('p', { class: `sync__status${s.error ? ' is-error' : ''}` }, h('i', { class: 'sync__dot' }), line),
    h('p', { class: 'menu__note' }, 'Pins, stars, references, notes and reading history are saved to your account.'),
    h('div', { class: 'form__row' },
      h('button', { class: 'btn', disabled: s.running, onclick: () => syncNow() }, 'Sync now'),
      h('button', { class: 'btn btn--ghost', onclick: async () => {
        try { download(await exportServer(), 'dwell-server'); } catch (err) { toast(err.message); }
      } }, 'Download server backup'),
    ),
    h('p', { class: 'menu__note' }, `Signed in as ${acct.current()?.email ?? 'your account'}. This device stays signed in until you sign out.`),
    h('div', { class: 'form__row' }, signOutButton()),
  );
}

// Sign this device out (asks for a second tap). What's on the device stays.
function signOutButton() {
  let armed = 0;
  const btn = h('button', { class: 'btn btn--ghost btn--danger', onclick: async () => {
    if (Date.now() - armed > 4000) { armed = Date.now(); btn.textContent = 'Tap again to sign out'; return; }
    btn.disabled = true;
    await syncNow(); // nothing unsynced is left behind
    await acct.signOut();
  } }, 'Sign out of this device');
  return btn;
}

function download(data, name) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${name}-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function exportBackup() {
  download(await store.exportData(), 'dwell-backup');
}
