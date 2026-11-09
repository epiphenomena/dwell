---
project: dwell
status: active
priority: 2
goal: A mobile-first Bible reader PWA with flipping pages, pins, cross references, tags, notes and reading history; static app behind a Cloudflare Worker with accounts and sync.
home: wally
zmx: w.bible
waiting_on: [Phone check of the tap fixes and the BLB link]
blocked: []
next: [Check the tap fixes, the BLB link and the chapter hairline on the phone]
---
## Upkeep
- **Public repo:** anyone can read this file. Nothing private -- no names, emails, secrets or personal details.
- **Never commit Bible text:** `data/text/` and `versions/` hold licensed translations and stay gitignored.
- **Never name the licensed versions** in a tracked file: they live in `versions/private.mjs` and the generated `js/versions.local.js`, both gitignored.
- README.md: when building, running, deploying or the Bible-text pipeline changes.

## Tracks
### Reader
- [x] Flipping pages, pins, ribbon, stars, cross references, tags, notes, search, history
- [x] Three pins and the ribbon in one row; selecting starts in Link; Open in Blue Letter Bible
- [x] Fullscreen as one setting; page height kept as system bars come and go; page centered
- [x] Fourth locator hairline: the current chapter's pages
- [x] Chapter pages hairline: a shared first or last page sized by the chapter's share of it
- [x] Tapping a cross reference sometimes jumps to the other passage; it should always open the links page <!-- cap:h11 -->
- [ ] Blue Letter Bible links open in a child browser window instead of in the app; now an Android intent for the BLB app, to confirm on the phone <!-- cap:h12 -->
- [x] Tap to select a verse is detected inconsistently <!-- cap:h13 -->
### Backend
- [x] Cloudflare Worker + D1 (accounts, records, log) + KV (licensed text, owner accounts only)
- [x] Email sign-in links over SMTP; per-account sync
### Repo
- [x] Bring the fossil checkout's newer work into git (branch merge-py)
- [x] Review and merge merge-py into main
- [x] Retire the old fossil checkout

## Open questions

## Decisions
- 2026-10-04 Backend is a Cloudflare Worker with D1 and KV; accounts are an email address plus tokens. Only the public-domain BSB is served to everyone.
- 2026-10-04 Sync state belongs to one sign-in: another account's data is replaced, not merged.
- 2026-10-04 Small visual tweaks may be committed and deployed without asking; API, auth, database or large batches are asked first.
- 2026-10-19 Pins cut from seven to three; pins 4-7 retired.
- 2026-10-31 A page belongs to the chapter it ends in, for the chapter and book hairlines.
- 2026-11-08 The chapter pages hairline also shows the shared page at each end, sized by the chapter's share in lines; headings between chapters count with the second. Which chapter is current still follows the 2026-10-31 rule.
- 2026-11-01 This git repo is the working repo from now on. It carries the Rakefile, the live D1/KV ids and the public version list. The Bible texts, sources, backups and `.dev.vars` stay gitignored. The one-off legacy-import tasks and the public-export script were not brought over.
- 2026-11-01 The live D1/KV ids stay in the public repo; the licensed versions' names do not. They are defined in gitignored `versions/private.mjs`; `rake text` writes them to gitignored `js/versions.local.js`, and `rake build` merges it into `dist/js/versions.js`, which the app and the Worker load. Commits already on origin/main still name them (`tools/build-versions.mjs`, the Blue Letter Bible list in `js/components/actionbar.js`). By choice the names stay in pushed history -- no rewrite, no force-push -- and only the current tree is kept clean. A licensed version's Blue Letter Bible code is its `blb` field in `versions/private.mjs`.

## Notes for later
### at every app change
- Bump `VERSION` in `sw.js` when the app's files change.
### at deploy
- `rake deploy` = check + build + wrangler deploy + verify. `rake check` needs every version's text present under `data/text/`.
- `rake cf:texts` after `rake text` changes a licensed version.
### on the phone (deployed 2026-11-08, v28)
- the chapter hairline's end segments look right on shared pages; a marked verse number opens its references; taps between lines select; the BLB button opens the BLB app.

## Ideas

## Inbox

## Done
- 2026-11-08 Old fossil checkout retired: removed from the py repo with its globs, the directory moved to the trash.
- 2026-11-08 Reader taps: the click after a tap no longer lands on the references sheet; taps between lines select their verse; the BLB link is an intent for the Android app. Deployed.
- 2026-11-08 Chapter pages hairline sizes shared end pages by share; deployed (v28).
- 2026-11-08 merge-py fast-forwarded into main, deployed (v27, verify OK) and pushed.
- 2026-11-01 Licensed versions' names moved out of the tracked files, the Blue Letter Bible list included; merge-py's own commits add none of them.
- 2026-11-01 Merged the fossil checkout's 2026-10-31 locator work into branch merge-py.
- 2026-10-19 Pin and selection changes, deployed and pushed.
- 2026-10-04 Moved to Cloudflare at dwell.literal.work.
- 2026-10-02 Started.
