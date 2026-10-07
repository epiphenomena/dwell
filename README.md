# Dwell

A Bible reader PWA: pages that flip, pins, stars, cross references, tags, notes and a
reading history. Vanilla JS (ES modules), componentized CSS, no runtime dependencies.
Live at https://dwell.literal.work/.

Anyone can read the **Berean Standard Bible** (public domain), offline, without an
account. An account (an email address and a sign-in token) syncs pins, stars, notes and
history across devices.

## How it's put together

- **The app** is static files: `index.html`, `css/`, `js/`, `icons/`, `sw.js` and the
  public text. `tools/build-dist.mjs` copies exactly those (an allowlist) into `dist/`.
- **The backend** is a Cloudflare Worker (`worker/index.js`) in front of those files:
  - `/text/<id>`: the Bible text, one file per version.
  - `/api/signin`, `/api/me`, `/api/signout`, `/api/sync`, `/api/export`.
  - D1 (`worker/migrations/`) holds accounts, sign-in tokens (hashed), each account's
    records and reading log, and rate limits.
- **Accounts.** Signing in = entering an email address; the Worker emails a link with a
  token (and the token itself, to paste into another browser). The app keeps the token in
  localStorage, so a device signs in once. Several tokens per account are fine (one per
  device); signing out deletes that device's token.
- **Sync.** Each pin, tag/cross-reference group, note, star and reset is its own record and
  the most recent change wins per record; deletions sync; a history reset only moves
  forward. The reading log only grows and is merged by entry id. Display settings stay per
  device.

Everything keys on global verse ids, so positions survive font and layout changes.

## Bible text

No text files are committed. `tools/build-versions.mjs` converts the public-domain BSB,
published as USFM by eBible.org, into `data/text/bsb.json` (verse strings plus paragraph,
poetry and heading layout) and writes `js/versions.js`:

    curl -fsSLO https://ebible.org/Scriptures/engbsb_usfm.zip
    node tools/build-versions.mjs bsb=engbsb_usfm.zip

## Running it locally

With the text built:

    npm install
    npx wrangler d1 migrations apply dwell --local
    printf 'DEV_MAIL=log\n' > .dev.vars      # sign-in emails go to the console
    npm run dev                               # build dist/ + wrangler dev

## Using it

- **Flip** — swipe, or tap the outer edges of the page. Arrow keys / space on desktop.
- **Go to** — tap the passage title at the top: book → chapter grid, or type `jn 3:16`, `ps 23`, `rom 8:28-39`.
- **Scrub** — drag along the hairlines at the bottom to move through the book.
- **Select** — tap a verse; tap another to extend. The top bar shows: the reference (tap
  for everything attached), **star**, **link** (then a pin: cross reference), **tag**,
  **note**, **copy**. Tap a pin in the dock to place it on the selection.
- **Stars** — an underline in the star color, easy to spot while flipping. Menu › Starred.
- **Pins** — seven colors. Tap to go to the passage; hold to clear.
- **Ribbon** — marks the page you're reading through and moves along as you read on. Tap
  to return; hold to move it here. Reading at the ribbon has its own history and streak.
- **References** — a cross reference links two passages; a tag groups any number. The
  info sheet shows second-level references too (A–B and B–C: C, via B).
- **Notes** — swipe up on the text for the latest note. Notes can carry tags (suggested
  as you type) and attached passages.
- **History** — swipe down on the text, or Menu › History: heatmap and timeline, for
  reading at the ribbon and elsewhere; each can be reset.
- **Search** — Bible text, notes, tags, pins. Words match from their start; `"quotes"`
  match a phrase.
- Settings has a **How to use** section with all of this.

## Layout

    index.html, manifest.webmanifest, sw.js
    css/tokens.css, css/base.css, css/components/*.css   one file per component
    js/app.js            wiring
    js/account.js        sign-in token, the account and its versions
    js/reader.js         column pagination, gestures, selection
    js/canon.js          verse ids (0..31101), ref parsing/formatting
    js/store.js, db.js   state + IndexedDB
    js/history.js        reading log, nav stack, sessions
    js/sync.js           offline-first sync with the Worker
    js/heat.js           recency and streak computations
    js/components/*.js   dock, locator, action bar, panels
    js/text.js           loads the current version; js/versions.js lists them (generated)
    worker/              the Worker (index.js), SMTP mail (mail.js), D1 migrations
    data/text/<id>.json  one file per version: verse strings plus layout
    tools/               dist builder, text converter, token and SMTP tools

## License

MIT, see `LICENSE`. The Berean Standard Bible text is in the public domain.
