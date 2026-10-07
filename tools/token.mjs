// Mint a sign-in token for an account without email (creating the account
// if needed): for the first sign-in before email is set up, or if it fails.
// Run it yourself; the token is printed only to your terminal.
//
//   node tools/token.mjs you@example.com            (live database)
//   node tools/token.mjs you@example.com --local    (wrangler dev's database)
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const email = (process.argv[2] || '').trim().toLowerCase();
const where = process.argv.includes('--local') ? '--local' : '--remote';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('usage: node tools/token.mjs <email> [--local]');
  process.exit(1);
}

const token = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(token).digest('hex');
const now = Date.now();
const q = s => `'${s.replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (email, created) VALUES (${q(email)}, ${now}) ON CONFLICT (email) DO NOTHING;
INSERT INTO tokens (hash, user_id, created) SELECT ${q(hash)}, id, ${now} FROM users WHERE email = ${q(email)};`;

execFileSync('npx', ['wrangler', 'd1', 'execute', 'dwell', where, '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] });
const site = where === '--local' ? 'http://127.0.0.1:8787' : 'https://dwell.literal.work';
console.log(`Signed-in token for ${email} (keep it private):\n\n  ${token}\n\nOpen ${site}/#token=${token}\nor paste the token into Dwell: Menu › Sync › Have a token?`);
