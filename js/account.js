// The account on this device. Signing in is optional: reading and keeping
// pins, notes and history all work without one; an account syncs them and
// may unlock more Bible versions. A sign-in token arrives by email (a link
// with #token=…, or the token itself to paste); it is kept in localStorage,
// so a device signs in once and stays signed in until it signs out. The
// last known account is remembered too, for offline starts.
const TOKEN = 'dwell-token';
const ME = 'dwell-me';

const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
const set = (key, value) => {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage blocked */ }
};

export const account = new EventTarget();
const changed = () => account.dispatchEvent(new Event('change'));

let me = null;
try { me = JSON.parse(get(ME) || 'null'); } catch { me = null; }

export const token = () => get(TOKEN);
export const signedIn = () => !!token();
// { email, owner, versions } once the server has confirmed it, else null.
export const current = () => (signedIn() ? me : null);
export const authHeaders = () => (signedIn() ? { Authorization: `Bearer ${token()}` } : {});

// Forget the token here (signed out, or the server no longer knows it).
export function forget() {
  set(TOKEN, null);
  set(ME, null);
  me = null;
  changed();
}

// Ask the server who this token is. Offline, the remembered account stands.
export async function refresh() {
  if (!signedIn()) return null;
  let res;
  try {
    res = await fetch('api/me', { headers: authHeaders(), cache: 'no-store' });
  } catch {
    return me;
  }
  if (res.status === 401) { forget(); return null; }
  if (!res.ok) return me;
  me = await res.json();
  set(ME, JSON.stringify(me));
  changed();
  return me;
}

// Email a sign-in token. Resolves when sent; rejects with a message to show.
export async function requestSignIn(email) {
  let res, data = null;
  try {
    res = await fetch('api/signin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), cache: 'no-store',
    });
    data = await res.json();
  } catch {
    throw new Error(res ? `Server error ${res.status}` : 'Can’t reach the server');
  }
  if (!res.ok) throw new Error(data?.error || `Server error ${res.status}`);
}

// Sign in with a token (pasted, or from a sign-in link).
export async function useToken(raw) {
  const t = String(raw || '').trim().replace(/^.*#token=/, '');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(t)) throw new Error('That doesn’t look like a sign-in token');
  const before = token();
  set(TOKEN, t);
  let res;
  try {
    res = await fetch('api/me', { headers: authHeaders(), cache: 'no-store' });
  } catch {
    set(TOKEN, before);
    throw new Error('Can’t reach the server');
  }
  if (!res.ok) {
    set(TOKEN, before);
    throw new Error(res.status === 401 ? 'That token isn’t valid (it may have been used to sign out)' : `Server error ${res.status}`);
  }
  me = await res.json();
  set(ME, JSON.stringify(me));
  changed();
  return me;
}

export async function signOut() {
  if (!signedIn()) return;
  await fetch('api/signout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  forget();
}

// Opened from a sign-in link: take the token and tidy the address bar.
export async function takeLinkToken() {
  const m = /#token=([A-Za-z0-9_-]{20,128})/.exec(location.hash);
  if (!m) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  try { await useToken(m[1]); return true; } catch { return false; }
}
