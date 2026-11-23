import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Agent, WebSocket, fetch } from 'undici';

/*
 * Sign-in for direct access (BeechHut's own port rather than the HA sidebar).
 * It uses Home Assistant's login: the browser is sent to HA's sign-in page, HA sends it back
 * with a one-time code, and BeechHut swaps that for tokens (server side, so they never reach
 * the browser). Only Home Assistant administrators are let in. The browser just gets a session
 * cookie; tokens are kept in the add-on's private storage so restarts don't sign people out.
 */

const COOKIE = 'beechhut_session';
const SESSION_DAYS = 30;
const RECHECK_MS = 5 * 60_000; // how often to confirm the user is still an administrator
const insecure = new Agent({ connect: { rejectUnauthorized: false } });

export function createDirectAuth({ dataDir, haInternalUrl, haBrowserUrl, log }) {
  const file = path.join(dataDir, 'sessions.json');
  const sessions = new Map();
  const states = new Map(); // login attempts in progress: state → { clientId, created }
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    try { for (const [k, v] of Object.entries(JSON.parse(await fs.readFile(file, 'utf8')))) sessions.set(k, v); } catch { /* none yet */ }
  }
  async function save() {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  /** The address the browser used, e.g. http://192.168.10.88:8098 or http://beechhut.home.internal. */
  const origin = (req) => `${String(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;

  async function haPost(pathname, form) {
    const base = await haInternalUrl();
    const res = await fetch(`${base}${pathname}`, {
      method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(10_000),
      dispatcher: base.startsWith('https') ? insecure : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, data };
  }

  /** Ask Home Assistant who the token belongs to: { name, isAdmin }. */
  async function currentUser(accessToken) {
    const base = await haInternalUrl();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/websocket`, base.startsWith('https') ? { dispatcher: insecure } : undefined);
      const timer = setTimeout(() => { ws.close(); reject(new Error('Home Assistant didn’t answer')); }, 10_000);
      const done = (fn) => { clearTimeout(timer); try { ws.close(); } catch { /* */ } fn(); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
        else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'auth/current_user' }));
        else if (msg.type === 'auth_invalid') done(() => reject(new Error('Home Assistant rejected the sign-in')));
        else if (msg.type === 'result' && msg.id === 1) {
          done(() => (msg.success ? resolve({ name: msg.result.name, isAdmin: Boolean(msg.result.is_admin) }) : reject(new Error('Couldn’t look up the user'))));
        }
      };
      ws.onerror = () => done(() => reject(new Error('Couldn’t reach Home Assistant')));
    });
  }

  const cookieOpts = (req) => ({
    path: '/', httpOnly: true, sameSite: 'lax', secure: origin(req).startsWith('https'), maxAge: SESSION_DAYS * 86400,
  });

  /** Keep the session's access token fresh and the user still an admin; returns false if it's no longer valid. */
  async function refresh(s) {
    if (Date.now() < s.expires - 60_000 && Date.now() - s.checked < RECHECK_MS) return true;
    if (!s.refreshing) {
      s.refreshing = (async () => {
        if (Date.now() >= s.expires - 60_000) {
          const r = await haPost('/auth/token', { grant_type: 'refresh_token', refresh_token: s.refresh, client_id: s.clientId });
          if (!r.ok || !r.data?.access_token) return false; // revoked or expired: sign in again
          s.access = r.data.access_token;
          s.expires = Date.now() + (r.data.expires_in || 1800) * 1000;
        }
        const user = await currentUser(s.access);
        if (!user.isAdmin) return false;
        s.name = user.name;
        s.checked = Date.now();
        return true;
      })().finally(() => { delete s.refreshing; });
    }
    try { return await s.refreshing; } catch (e) {
      log(`couldn’t check a direct-access sign-in (${e.message}); allowing it for now`);
      return true; // Home Assistant briefly unreachable: don't throw everyone out
    }
  }

  const page = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · BeechHut</title><link rel="icon" href="/icon.svg"><style>
:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#f6f5f1;color:#1d201c}
@media(prefers-color-scheme:dark){body{background:#141613;color:#e8eae4}}main{max-width:380px;padding:24px;text-align:center}
img{width:56px;height:56px}h1{font-size:22px;margin:12px 0 6px}p{margin:0 0 18px;opacity:.75}a{display:inline-block;padding:10px 18px;border-radius:10px;background:#2f5d3a;color:#fff;text-decoration:none;font-weight:600}
</style></head><body><main><img src="/hut.svg" alt=""><h1>${title}</h1>${body}</main></body></html>`;

  return {
    COOKIE,

    /** The signed-in user for this request, or null. */
    async check(req) {
      await load();
      const sid = req.cookies?.[COOKIE];
      const s = sid && sessions.get(sid);
      if (!s) return null;
      if (!(await refresh(s))) { sessions.delete(sid); await save(); return null; }
      if (s.dirty !== s.access) { s.dirty = s.access; await save(); }
      return { name: s.name };
    },

    /** Send the browser to Home Assistant's sign-in page. */
    async login(req, reply) {
      const state = crypto.randomBytes(16).toString('hex');
      const clientId = `${origin(req)}/`;
      states.set(state, { clientId, created: Date.now() });
      for (const [k, v] of states) if (Date.now() - v.created > 10 * 60_000) states.delete(k);
      const ha = await haBrowserUrl(req);
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: `${origin(req)}/auth/callback`, state });
      return reply.redirect(`${ha}/auth/authorize?${q}`);
    },

    /** Home Assistant sends the browser back here with a one-time code. */
    async callback(req, reply) {
      await load();
      const { code, state } = req.query || {};
      const pending = state && states.get(state);
      states.delete(state);
      if (!code || !pending) return reply.type('text/html').send(page('Sign-in didn’t finish', '<p>It took too long, or came from somewhere unexpected. Try again.</p><a href="/auth/login">Sign in</a>'));
      const r = await haPost('/auth/token', { grant_type: 'authorization_code', code, client_id: pending.clientId });
      if (!r.ok || !r.data?.access_token) {
        log(`direct-access sign-in failed: Home Assistant returned HTTP ${r.status}`);
        return reply.type('text/html').send(page('Sign-in failed', '<p>Home Assistant didn’t accept the sign-in. Try again.</p><a href="/auth/login">Sign in</a>'));
      }
      const user = await currentUser(r.data.access_token);
      if (!user.isAdmin) {
        haPost('/auth/revoke', { token: r.data.refresh_token }).catch(() => {});
        log(`direct-access sign-in refused for ${user.name}: not an administrator`);
        return reply.type('text/html').send(page('Administrators only', `<p>${user.name.replace(/[<>&"]/g, '')} isn’t a Home Assistant administrator, so can’t use BeechHut.</p><a href="/auth/login">Sign in as someone else</a>`));
      }
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, {
        refresh: r.data.refresh_token, access: r.data.access_token, clientId: pending.clientId,
        expires: Date.now() + (r.data.expires_in || 1800) * 1000, checked: Date.now(), name: user.name, created: Date.now(),
      });
      await save();
      log(`${user.name} signed in for direct access`);
      return reply.setCookie(COOKIE, sid, cookieOpts(req)).redirect('/');
    },

    /** Sign out: forget the session and revoke its tokens in Home Assistant. */
    async logout(req, reply) {
      await load();
      const sid = req.cookies?.[COOKIE];
      const s = sid && sessions.get(sid);
      if (s) {
        sessions.delete(sid);
        await save();
        haPost('/auth/revoke', { token: s.refresh }).catch(() => {});
      }
      return reply.clearCookie(COOKIE, { path: '/' }).type('text/html').send(page('Signed out', '<p>You’ve signed out of BeechHut.</p><a href="/auth/login">Sign in again</a>'));
    },
  };
}
