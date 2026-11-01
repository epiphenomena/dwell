# Dwell

A Bible reader PWA: pages that flip, pins, stars, cross references, tags, notes and a
reading history. Vanilla JS (ES modules), componentized CSS, no runtime dependencies.
Lives at https://dwell.literal.work/.

Anyone can read the **Berean Standard Bible** (public domain), offline, without an
account. An account (an email address and a token) syncs pins, stars, notes and history
across devices; **owner accounts** also get the licensed versions, which are never served
to anyone else and are not named in this repository.

## How it's put together

- **The app** is static files: `index.html`, `css/`, `js/`, `icons/`, `sw.js` and the
  public text. `tools/build-dist.mjs` copies exactly those (an allowlist) into `dist/`.
- **The backend** is a Cloudflare Worker (`worker/index.js`) in front of those files:
  - `/text/<id>`: public versions for everyone; licensed ones only for owner accounts,
    read from KV (`text:<id>`).
  - `/api/signin`, `/api/me`, `/api/signout`, `/api/sync`, `/api/export`.
  - D1 (`worker/migrations/`) holds accounts, sign-in tokens (hashed), each account's
    records and reading log, and rate limits.
- **Accounts.** Signing in = entering an email address; the Worker emails a link with a
  token (and the token itself, to paste into another browser). The app keeps the token in
  localStorage, so a device signs in once. The address is used for nothing but sending
  tokens, so it doubles as recovery: ask again for a new one. Several tokens per account
  are fine (one per device); signing out deletes that device's token.
- **Owners** are the addresses in the `OWNER_EMAILS` secret.
- **Mail** goes out over SMTP with TLS (port 465) through DreamHost's server
  (`worker/mail.js`), from the `SMTP_USER` mailbox.

How sync resolves things: each pin, tag/cross-reference group, note, star and reset is its
own record and the most recent change wins per record; deletions sync; a history reset only
moves forward. The reading log only grows and is merged by entry id. Display settings stay
per device. Signing in pulls the account first (as on a fresh device), then sends what this
device has.

## First deploy (once)

    npm install                       # wrangler, Cloudflare's CLI (local to this folder)
    npx wrangler login                # opens a browser to authorize; or set CLOUDFLARE_API_TOKEN
    npx wrangler whoami
    rake cf:setup                     # creates D1 "dwell" and KV "TEXT", writes their ids
                                      # into wrangler.toml, applies the migrations
    rake cf:secrets                   # prints the three `wrangler secret put` commands to run
    rake cf:texts                     # uploads the licensed texts to KV
    rake deploy                       # build + deploy + verify

`wrangler.toml` routes the custom domain `dwell.literal.work` (Cloudflare creates the DNS
record; there must not be another `dwell` record already). The sending mailbox's domain
needs DreamHost's SPF/DKIM records in Cloudflare DNS for mail to arrive reliably.

If email isn't working yet, `rake token EMAIL=you@example.com` prints a token for that
account straight from the database (run it yourself; it's shown only in your terminal).

## Day to day

    rake deploy                       # check + build + wrangler deploy + verify
    rake verify TOKEN=…               # also checks a signed-in account (owner: licensed text)
    rake cf:texts                     # after `rake text` changes a licensed version
    rake cf:migrate                   # after adding a migration

Bump `VERSION` in `sw.js` when the app's files change.

## Local development

    rake dev:setup                    # local D1 + KV (once)
    cat > .dev.vars <<'EOF'
    OWNER_EMAILS=owner@dwell.test
    DEV_MAIL=log
    EOF
    rake dev                          # http://127.0.0.1:8787

With `DEV_MAIL=log`, sign-in emails are printed in the `rake dev` output instead of sent.
`rake token EMAIL=… LOCAL=1` works locally too.

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
    js/text.js           loads the current version; js/versions.js lists the public ones (generated)
    worker/              the Worker (index.js), SMTP mail (mail.js), D1 migrations
    data/text/<id>.json  one file per version: verse strings plus layout
    tools/               dist builder, text converter, token and SMTP tools
    versions/            source texts (gitignored, never deployed)

Everything keys on global verse ids, so positions survive font and layout changes.

## Bible versions

`tools/build-versions.mjs` converts sources into `data/text/<id>.json` and regenerates
the version lists (`rake text`). Each version is marked `public` or not; only public
ones go into `dist/` as text.

- **BSB** — USFM from https://ebible.org/Scriptures/engbsb_usfm.zip (public domain).
- **Licensed versions** — defined in `versions/private.mjs` (gitignored): name, source
  and per-version fixes. The converter reads EPUBs (one XHTML file per book, USFM-style
  classes) and folders of plain verse files. Sources with no paragraphs borrow the BSB's
  layout: breaks at verse starts carry over, and breaks inside a verse go to the nearest
  fitting word boundary; psalm titles can be split out of verse 1.

The build fails unless every chapter fits the verse grid in `js/canon-data.js`.

This repository carries no Bible text and does not name the licensed versions:
`data/text/`, `versions/` and `js/versions.local.js` are gitignored. The committed
`js/versions.js` lists only the public versions; `rake text` writes the licensed ones to
`js/versions.local.js`, and `rake build` merges both into `dist/js/versions.js`, which
the app and the Worker both load. `rake text:public` downloads the BSB and builds
`data/text/bsb.json`, which is all a fresh clone needs for `rake check`/`rake build`/`rake dev`.

## License

MIT, see `LICENSE`. The Berean Standard Bible text is in the public domain.
