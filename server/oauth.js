'use strict';
/*
 * Sign in with Google, Twitch or Kick (OAuth 2 authorization code flow).
 *
 * A provider is switched on by setting both of its env vars:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET
 *   KICK_CLIENT_ID   / KICK_CLIENT_SECRET
 * and registering this redirect URL with the provider:
 *   https://YOUR-SITE/api/auth/oauth/<google|twitch|kick>/callback
 *
 * Safety: every flow has a random `state` that must come back in the same
 * browser (it's also in a short-lived HttpOnly cookie), PKCE where the
 * provider supports it, and pending sign-ups expire after 15 minutes.
 * Provider tokens are used once to read who you are, then thrown away.
 */
const crypto = require('crypto');

const b64url = (buf) => buf.toString('base64url');
const sha256b = (s) => crypto.createHash('sha256').update(s).digest();

const DEFAULTS = {
  google: {
    name: 'Google', scope: 'openid profile', pkce: true,
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    user: 'https://openidconnect.googleapis.com/v1/userinfo',
    parse: (j) => ({ id: j.sub, name: j.given_name || j.name || '', handle: '' }),
  },
  twitch: {
    name: 'Twitch', scope: '', pkce: false,
    auth: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',
    user: 'https://api.twitch.tv/helix/users',
    clientIdHeader: true,
    parse: (j) => { const d = (j.data || [])[0] || {}; return { id: d.id, name: d.login || d.display_name || '', handle: d.login || '' }; },
  },
  kick: {
    name: 'Kick', scope: 'user:read', pkce: true,
    auth: 'https://id.kick.com/oauth/authorize',
    token: 'https://id.kick.com/oauth/token',
    user: 'https://api.kick.com/public/v1/users',
    parse: (j) => { const d = (j.data || [])[0] || {}; return { id: d.user_id != null ? String(d.user_id) : '', name: d.name || '', handle: d.name || '' }; },
  },
};

/** Which providers are configured. `overrides` lets tests point a provider at a fake server. */
function loadProviders(env = process.env, overrides = {}) {
  const out = {};
  for (const [id, d] of Object.entries(DEFAULTS)) {
    const o = overrides[id] || {};
    const clientId = o.clientId || env[id.toUpperCase() + '_CLIENT_ID'];
    const clientSecret = o.clientSecret || env[id.toUpperCase() + '_CLIENT_SECRET'];
    if (clientId && clientSecret) out[id] = { ...d, ...o, id, clientId, clientSecret };
  }
  return out;
}

const COOKIE = 'ater_o';
const FLOW_MS = 10 * 60_000, PENDING_MS = 15 * 60_000;

function createOAuth(providers, accounts, { publicUrl = '' } = {}) {
  const flows = new Map();   // state -> { prov, verifier, mode, link, exp }
  const pending = new Map(); // token -> { prov, ident, exp }
  const sweep = setInterval(() => { const t = Date.now(); for (const m of [flows, pending]) for (const [k, v] of m) if (v.exp < t) m.delete(k); }, 60_000);
  sweep.unref();

  const base = (req) => publicUrl.replace(/\/+$/, '') || `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}`;
  const redirectUri = (req, id) => `${base(req)}/api/auth/oauth/${id}/callback`;
  const go = (res, url, cookie) => { const h = { Location: url, 'Cache-Control': 'no-store' }; if (cookie) h['Set-Cookie'] = cookie; res.writeHead(302, h); res.end(); };
  const back = (req, res, q) => go(res, '/?' + new URLSearchParams(q) + '#/bigscreen', `${COOKIE}=; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=0`);
  const cookieOf = (req) => { const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)')); return m ? m[1] : ''; };

  function list() { return Object.values(providers).map((p) => ({ id: p.id, name: p.name })); }

  /** GET /api/auth/oauth/:id/start?mode=login|link */
  function start(req, res, id, mode, linkUser) {
    const p = providers[id];
    if (!p) return back(req, res, { oauth: 'off', p: id });
    if (mode === 'link' && !linkUser) return back(req, res, { oauth: 'error', p: id, m: 'Sign in first.' });
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    flows.set(state, { prov: id, verifier, mode: mode === 'link' ? 'link' : 'login', link: linkUser ? linkUser.name.toLowerCase() : '', exp: Date.now() + FLOW_MS });
    const q = new URLSearchParams({ client_id: p.clientId, redirect_uri: redirectUri(req, id), response_type: 'code', state });
    if (p.scope) q.set('scope', p.scope);
    if (p.pkce) { q.set('code_challenge', b64url(sha256b(verifier))); q.set('code_challenge_method', 'S256'); }
    if (id === 'google') q.set('prompt', 'select_account');
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    go(res, p.auth + '?' + q, `${COOKIE}=${state}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  }

  async function identify(req, p, code, verifier) {
    const body = new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri(req, p.id) });
    if (p.pkce) body.set('code_verifier', verifier);
    const t = await fetch(p.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
    const tj = await t.json().catch(() => ({}));
    if (!t.ok || !tj.access_token) throw new Error('token exchange failed (' + t.status + ')');
    const h = { Authorization: 'Bearer ' + tj.access_token, accept: 'application/json' };
    if (p.clientIdHeader) h['Client-Id'] = p.clientId;
    const u = await fetch(p.user, { headers: h, signal: AbortSignal.timeout(10_000) });
    const uj = await u.json().catch(() => ({}));
    if (!u.ok) throw new Error('user lookup failed (' + u.status + ')');
    const ident = p.parse(uj);
    if (!ident.id) throw new Error('no user id');
    return { ...ident, id: String(ident.id) };
  }

  /** GET /api/auth/oauth/:id/callback?code&state */
  async function callback(req, res, id, url) {
    const p = providers[id];
    const state = url.searchParams.get('state') || '';
    const flow = flows.get(state);
    flows.delete(state);
    if (!p || !flow || flow.prov !== id || flow.exp < Date.now() || cookieOf(req) !== state) return back(req, res, { oauth: 'error', p: id, m: 'That sign-in expired or came from somewhere else. Try again.' });
    if (url.searchParams.get('error')) return back(req, res, { oauth: 'cancel', p: id });
    let ident;
    try { ident = await identify(req, p, url.searchParams.get('code') || '', flow.verifier); }
    catch (e) { console.error('OAuth', id, e.message); return back(req, res, { oauth: 'error', p: id, m: p.name + ' didn’t let us in. Try again.' }); }

    const owner = accounts.findByIdentity(id, ident.id);
    if (flow.mode === 'link') {
      const u = accounts.find(flow.link);
      if (!u) return back(req, res, { oauth: 'error', p: id, m: 'Sign in first.' });
      if (owner && owner !== u) return back(req, res, { oauth: 'taken', p: id });
      await accounts.link(u, id, ident);
      return back(req, res, { oauth: 'linked', p: id });
    }
    if (owner) {
      await accounts.ownerCheck(owner);
      await accounts.startSession(req, res, owner);
      const session = res.getHeader('Set-Cookie');
      res.writeHead(302, {
        Location: '/?' + new URLSearchParams({ oauth: 'in', p: id }) + '#/bigscreen',
        'Set-Cookie': [session, `${COOKIE}=; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=0`],
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    const token = b64url(crypto.randomBytes(24));
    pending.set(token, { prov: id, ident, exp: Date.now() + PENDING_MS });
    return back(req, res, { oauth: 'new', p: id, t: token, n: accounts.suggestName(ident.handle || ident.name) });
  }

  /** POST /api/auth/oauth/finish { t, name }: create the account for a new identity */
  async function finish(req, res, t, name) {
    const pend = pending.get(String(t || ''));
    if (!pend || pend.exp < Date.now()) return { error: 'That sign-up expired. Start again.', status: 400 };
    if (accounts.findByIdentity(pend.prov, pend.ident.id)) { pending.delete(t); return { error: 'That ' + providers[pend.prov].name + ' account already has an Ater account. Sign in instead.', status: 409 }; }
    const r = await accounts.registerLinked(name, pend.prov, pend.ident);
    if (r.error) return r;
    pending.delete(t);
    await accounts.startSession(req, res, r.user);
    return r;
  }

  return { list, start, callback, finish, enabled: (id) => Boolean(providers[id]) };
}

module.exports = { createOAuth, loadProviders, DEFAULTS };
