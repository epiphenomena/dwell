// Dwell's backend: a Cloudflare Worker in front of the static app.
//
//   /text/<id>        Bible text. Public versions for everyone; the others
//                     (licensed) only for an owner account, from KV.
//   /api/signin       POST {email}: email a sign-in token (new account or
//                     recovery; the reply is the same either way)
//   /api/me           GET: the account and the versions it may read
//   /api/signout      POST: forget this device's token
//   /api/sync         POST: push changed records + new log entries, pull
//                     everything newer than the client's cursors
//   /api/export       POST: everything in the account (backup)
//   anything else     the static app (dist/, built by tools/build-dist.mjs)
//
// An account is an email address and any number of tokens. The address is
// used only to deliver tokens: a sign-in email carries a link with the token
// (and the token itself, to paste into another browser). The app keeps its
// token in localStorage and sends it as a Bearer token. Owner accounts
// (OWNER_EMAILS, a secret) can read every version.
//
// Records are last-write-wins per record by the client's `updated` time;
// deletions are tombstones; a history reset only moves forward. The log is
// append-only and deduplicated by entry id. Every query is scoped to the
// signed-in account.
import '../js/versions.js';
import { sendMail, mailConfigured } from './mail.js';

const VERSIONS = globalThis.DWELL_VERSIONS;
const PUBLIC = new Set(VERSIONS.filter(v => v.public).map(v => v.id));

const DAY = 86400000;
const RECORD_PAGE = 1000;
const LOG_PAGE = 2000;
const MAX_PUSH_RECORDS = 500;
const MAX_PUSH_LOG = 2000;
const KINDS = new Set(['pin', 'group', 'note', 'state', 'star']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, ctx, url);
      if (url.pathname.startsWith('/text/')) return await text(request, env, ctx, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  },
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function body(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

// ---- accounts ----

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const owners = env => new Set(String(env.OWNER_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
const versionsFor = user => VERSIONS.filter(v => v.public || user?.owner).map(v => v.id);

function normEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// The signed-in account, from the Bearer token, or null.
async function auth(request, env, ctx) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const hash = await sha256(m[1]);
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, t.used FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?',
  ).bind(hash).first();
  if (!row) return null;
  // Note use about once a day (unused tokens are cleared after a week).
  const now = Date.now();
  if (now - row.used > DAY) ctx.waitUntil(env.DB.prepare('UPDATE tokens SET used = ? WHERE hash = ?').bind(now, hash).run());
  return { id: row.id, email: row.email, hash, owner: owners(env).has(row.email) };
}

// At most `max` uses of `key` per `seconds`.
async function allow(env, key, max, seconds) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT n, start FROM throttle WHERE key = ?').bind(key).first();
  if (row && now - row.start < seconds * 1000) {
    if (row.n >= max) return false;
    await env.DB.prepare('UPDATE throttle SET n = n + 1 WHERE key = ?').bind(key).run();
    return true;
  }
  await env.DB.prepare('INSERT INTO throttle (key, n, start) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET n = 1, start = excluded.start')
    .bind(key, now).run();
  return true;
}

async function signin(request, env, url) {
  const email = normEmail((await body(request)).email);
  if (!email) return json({ error: 'Enter an email address' }, 400);
  if (!mailConfigured(env)) return json({ error: 'Sign-in email isn’t set up on this server yet' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!await allow(env, `mail:${email}`, 1, 60) || !await allow(env, `ip:${ip}`, 10, 3600)) {
    return json({ error: 'Too many sign-in emails. Try again in a few minutes.' }, 429);
  }
  const now = Date.now();
  const token = newToken();
  const hash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (email, created) VALUES (?, ?) ON CONFLICT (email) DO NOTHING').bind(email, now),
    env.DB.prepare('INSERT INTO tokens (hash, user_id, created) SELECT ?, id, ? FROM users WHERE email = ?').bind(hash, now, email),
    // Tokens sent but never used expire after a week.
    env.DB.prepare('DELETE FROM tokens WHERE used = 0 AND created < ?').bind(now - 7 * DAY),
  ]);
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const link = `${local ? url.origin : `https://${url.host}`}/#token=${token}`;
  try {
    await sendMail(env, {
      to: email,
      subject: 'Sign in to Dwell',
      text: `Open this link to sign in to Dwell on this device:\n\n${link}\n\nOr paste this token into Dwell (Menu › Sync › Have a token?):\n\n${token}\n\nThe token stays signed in until you sign out. If you didn’t ask for this, ignore this email.\n`,
      html: `<p>Open this link to sign in to Dwell on this device:</p><p><a href="${link}">Sign in to Dwell</a></p>`
        + `<p>Or paste this token into Dwell (Menu › Sync › Have a token?):</p><p><code style="font-size:15px">${token}</code></p>`
        + '<p>The token stays signed in until you sign out. If you didn’t ask for this, ignore this email.</p>',
    });
  } catch (err) {
    console.error('sign-in email failed', err);
    await env.DB.prepare('DELETE FROM tokens WHERE hash = ?').bind(hash).run();
    return json({ error: 'Couldn’t send the email. Try again in a little while.' }, 502);
  }
  return json({ ok: true });
}

// ---- text ----

async function text(request, env, ctx, url) {
  const id = url.pathname.slice('/text/'.length);
  if (!VERSIONS.some(v => v.id === id)) return new Response('Not found', { status: 404 });
  if (PUBLIC.has(id)) {
    const res = await env.ASSETS.fetch(new Request(new URL(`/text/${id}.json`, url), request));
    const out = new Response(res.body, res);
    out.headers.set('Content-Type', 'application/json; charset=utf-8');
    return out;
  }
  const user = await auth(request, env, ctx);
  if (!user) return json({ error: 'Sign in to read this version' }, 401);
  if (!user.owner) return json({ error: 'This version isn’t available to this account' }, 403);
  const body = await env.TEXT.get(`text:${id}`, { type: 'stream' });
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

// ---- api ----

async function api(request, env, ctx, url) {
  const path = url.pathname.slice('/api/'.length);
  if (path === 'signin' && request.method === 'POST') return signin(request, env, url);

  const user = await auth(request, env, ctx);
  if (!user) return json({ error: 'Not signed in' }, 401);

  if (path === 'me' && request.method === 'GET') {
    return json({ email: user.email, owner: user.owner, versions: versionsFor(user) });
  }
  if (path === 'signout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM tokens WHERE hash = ?').bind(user.hash).run();
    return json({ ok: true });
  }
  if (path === 'sync' && request.method === 'POST') return sync(request, env, user);
  if (path === 'export' && request.method === 'POST') {
    const [records, log] = await env.DB.batch([
      env.DB.prepare('SELECT kind, id, data, updated FROM records WHERE user_id = ? AND deleted = 0 ORDER BY kind, id').bind(user.id),
      env.DB.prepare('SELECT id, t, d, s, e, k FROM log WHERE user_id = ? ORDER BY t').bind(user.id),
    ]);
    return json({
      app: 'dwell-server', exported: new Date().toISOString(), account: user.email,
      records: records.results.map(r => ({ ...r, data: JSON.parse(r.data) })),
      log: log.results,
    });
  }
  return json({ error: 'Not found' }, 404);
}

const int = v => (Number.isFinite(+v) ? Math.trunc(+v) : NaN);

async function sync(request, env, user) {
  const b = await body(request);
  if (!Array.isArray(b.records ?? []) || !Array.isArray(b.log ?? [])) return json({ error: 'records and log must be arrays' }, 400);
  if ((b.records?.length ?? 0) > MAX_PUSH_RECORDS || (b.log?.length ?? 0) > MAX_PUSH_LOG) return json({ error: 'Too much in one sync' }, 413);

  const records = [];
  for (const r of b.records ?? []) {
    const id = String(r?.id ?? '');
    const updated = int(r?.updated);
    if (!KINDS.has(r?.kind) || !id || id.length > 64 || !(updated > 0)) continue;
    const deleted = r.deleted ? 1 : 0;
    const data = deleted ? null : JSON.stringify(r.data ?? null);
    if (data && data.length > 500000) continue;
    records.push({ kind: r.kind, id, data, updated, deleted });
  }
  const log = [];
  for (const e of b.log ?? []) {
    const id = String(e?.id ?? '');
    const [t, d, s, en] = [int(e?.t), int(e?.d ?? 0), int(e?.s), int(e?.e)];
    if (!id || id.length > 64 || [t, d, s, en].some(Number.isNaN)) continue;
    log.push({ id, t, d, s, e: en, k: e.k ? 1 : 0 });
  }

  const cursor = Math.max(0, int(b.cursor) || 0);
  const logCursor = Math.max(0, int(b.logCursor) || 0);
  const db = env.DB;
  const stmts = [];
  if (records.length) {
    const recs = JSON.stringify(records);
    // Upsert all records in one statement; a write only lands if it is at
    // least as new as what's stored, and a reset never moves back.
    stmts.push(db.prepare(`
      INSERT INTO records (user_id, kind, id, data, updated, deleted, seq)
      SELECT ?1, j.value ->> 'kind', j.value ->> 'id', j.value ->> 'data', j.value ->> 'updated', j.value ->> 'deleted',
             (SELECT COALESCE(MAX(seq), 0) FROM records) + j.key + 1
      FROM json_each(?2) AS j WHERE 1
      ON CONFLICT (user_id, kind, id) DO UPDATE SET
        data = excluded.data, updated = excluded.updated, deleted = excluded.deleted, seq = excluded.seq
      WHERE excluded.updated >= records.updated
        AND NOT (records.kind = 'state' AND records.id LIKE 'reset-%'
                 AND (excluded.deleted = 1 OR COALESCE(excluded.data ->> 't', 0) < COALESCE(records.data ->> 't', 0)))
    `).bind(user.id, recs));
    // A refused reset is sent back to this client in this reply.
    stmts.push(db.prepare(`
      UPDATE records SET seq = (SELECT MAX(seq) FROM records) + 1 + (id = 'reset-other')
      WHERE user_id = ?1 AND kind = 'state' AND id LIKE 'reset-%'
        AND EXISTS (SELECT 1 FROM json_each(?2) AS j
                    WHERE j.value ->> 'kind' = 'state' AND j.value ->> 'id' = records.id
                      AND (j.value ->> 'data') IS NOT records.data)
    `).bind(user.id, recs));
  }
  if (log.length) {
    stmts.push(db.prepare(`
      INSERT INTO log (user_id, id, t, d, s, e, k)
      SELECT ?1, j.value ->> 'id', j.value ->> 't', j.value ->> 'd', j.value ->> 's', j.value ->> 'e', j.value ->> 'k'
      FROM json_each(?2) AS j WHERE 1
      ON CONFLICT (user_id, id) DO NOTHING
    `).bind(user.id, JSON.stringify(log)));
  }
  stmts.push(db.prepare('SELECT kind, id, data, updated, deleted, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(user.id, cursor, RECORD_PAGE + 1));
  stmts.push(db.prepare('SELECT seq, id, t, d, s, e, k FROM log WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(user.id, logCursor, LOG_PAGE + 1));

  const results = await db.batch(stmts);
  const rows = results.at(-2).results;
  const entries = results.at(-1).results;
  const more = rows.length > RECORD_PAGE || entries.length > LOG_PAGE;
  const outRecords = rows.slice(0, RECORD_PAGE);
  const outLog = entries.slice(0, LOG_PAGE);
  return json({
    accepted: records.length,
    cursor: outRecords.length ? outRecords.at(-1).seq : cursor,
    logCursor: outLog.length ? outLog.at(-1).seq : logCursor,
    records: outRecords.map(r => ({
      kind: r.kind, id: r.id, updated: r.updated, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data),
    })),
    log: outLog.map(({ id, t, d, s, e, k }) => ({ id, t, d, s, e, k })),
    more,
  });
}
