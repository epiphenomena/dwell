// Build dist/, the static files the Worker serves: an allowlist, so nothing
// else in the repo (licensed sources, backups, tools) can be published.
// Only public versions' text goes in; licensed text lives in KV.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
globalThis.self = globalThis;
await import(path.join(root, 'js/versions.js'));

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['css', 'js', 'icons'];

// Emptied in place rather than replaced, so a running `wrangler dev` keeps
// watching the same directory.
fs.mkdirSync(dist, { recursive: true });
for (const e of fs.readdirSync(dist)) fs.rmSync(path.join(dist, e), { recursive: true, force: true });
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(dist, f));
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(dist, d), { recursive: true });
fs.mkdirSync(path.join(dist, 'text'));
const pub = self.DWELL_VERSIONS.filter(v => v.public);
for (const v of pub) fs.copyFileSync(path.join(root, 'data/text', `${v.id}.json`), path.join(dist, 'text', `${v.id}.json`));

let n = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : n++; };
walk(dist);
console.log(`dist/: ${n} files; text: ${pub.map(v => v.id).join(', ')}`);
