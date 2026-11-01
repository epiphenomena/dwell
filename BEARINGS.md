---
project: dwell
status: active  # idea | active | paused | done
priority: 2  # 1 high .. 3 low
goal: A mobile-first Bible reader PWA with flipping pages, pins, cross references, tags, notes and reading history; static app behind a Cloudflare Worker with accounts and sync.
home: wally  # the host whose checkout bb sync writes captures into
zmx: w.bible  # the project's zmx session: <host letter>.<short name>
waiting_on: [Review of the merge-py branch]
blocked: []
next: [Review and merge merge-py into main, Retire the old fossil checkout]
---
## Upkeep
Claude keeps this file current during every session here, without being asked:
- Tick tasks as they change; add tasks you discover, nested under their track.
- Record decisions as they are made, with an ISO date, under Decisions.
- Add open questions when you are waiting on the user; remove them once answered.
- Keep the front matter's `next`, `waiting_on` and `blocked` true. `status` too.
- Notes that only matter later go under `## Notes for later` -> `### at <when>`.
- Move finished items to `## Done` with an ISO date.
- Keep this file under ~1,500 tokens (about 120 lines): every session here loads it.
  `bb check` measures it. Overflow goes in `bearings/` beside this file -- `done.md`,
  `decisions.md`, `<topic>.md` -- linked with plain Markdown links, never `@`, so it is
  read only when needed. `bb compact dwell` moves old done items there; moving a
  grown track or the decisions' reasons is yours to do.
- File anything under `## Inbox` into the right section; ideas mentioned in passing go under `## Ideas`.
- **Public repo:** anyone can read this file. Nothing private -- no names, emails, secrets or personal details.
- **Never commit Bible text:** `data/text/` and `versions/` hold licensed translations and stay gitignored.
- **Never name the licensed versions** in a tracked file: they live in `versions/private.mjs` and the generated `js/versions.local.js`, both gitignored.
- Other docs to keep current (list them, with when to update each):
  - README.md: when building, running, deploying or the Bible-text pipeline changes.

## Tracks
### Reader
- [x] Flipping pages, pins, ribbon, stars, cross references, tags, notes, search, history
- [x] Three pins and the ribbon in one row; selecting starts in Link; Open in Blue Letter Bible
- [x] Fullscreen as one setting; page height kept as system bars come and go; page centered
- [x] Fourth locator hairline: the current chapter's pages
### Backend
- [x] Cloudflare Worker + D1 (accounts, records, log) + KV (licensed text, owner accounts only)
- [x] Email sign-in links over SMTP; per-account sync
### Repo
- [x] Bring the fossil checkout's newer work into git (branch merge-py)
- [ ] Review and merge merge-py into main
- [ ] Retire the old fossil checkout

## Open questions

## Decisions
- 2026-10-04 Backend is a Cloudflare Worker with D1 and KV; accounts are an email address plus tokens. Only the public-domain BSB is served to everyone.
- 2026-10-04 Sync state belongs to one sign-in: another account's data is replaced, not merged.
- 2026-10-04 Small visual tweaks may be committed and deployed without asking; API, auth, database or large batches are asked first.
- 2026-10-19 Pins cut from seven to three; pins 4-7 retired.
- 2026-10-31 A page belongs to the chapter it ends in, for the chapter and book hairlines.
- 2026-11-01 This git repo is the working repo from now on. It carries the Rakefile, the live D1/KV ids and the public version list. The Bible texts, sources, backups and `.dev.vars` stay gitignored. The one-off legacy-import tasks and the public-export script were not brought over.
- 2026-11-01 The live D1/KV ids stay in the public repo; the licensed versions' names do not. They are defined in gitignored `versions/private.mjs`; `rake text` writes them to gitignored `js/versions.local.js`, and `rake build` merges it into `dist/js/versions.js`, which the app and the Worker load. Commits already on origin/main still name them (`tools/build-versions.mjs`, the Blue Letter Bible list in `js/components/actionbar.js`). By choice the names stay in pushed history -- no rewrite, no force-push -- and only the current tree is kept clean. A licensed version's Blue Letter Bible code is its `blb` field in `versions/private.mjs`.

## Notes for later
### at every app change
- Bump `VERSION` in `sw.js` when the app's files change.
### at deploy
- `rake deploy` = check + build + wrangler deploy + verify. `rake check` needs every version's text present under `data/text/`.
- `rake cf:texts` after `rake text` changes a licensed version.
### once merge-py is merged
- Retire the old fossil checkout (it was the working copy until 2026-10-31) and its ignore-glob lines.
- Claude's project memory for this directory still says to work in the fossil checkout; update it.

## Ideas

## Inbox

## Done
- 2026-11-01 Licensed versions' names moved out of the tracked files, the Blue Letter Bible list included; merge-py's own commits add none of them.
- 2026-11-01 Merged the fossil checkout's 2026-10-31 locator work into branch merge-py.
- 2026-10-19 Pin and selection changes, deployed and pushed.
- 2026-10-04 Moved to Cloudflare at dwell.literal.work.
- 2026-10-02 Started.
