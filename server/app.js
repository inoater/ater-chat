'use strict';
/*
 * The HTTP side: the website from public/, plus the Ater chat API.
 *
 *   GET  /healthz                         { ok, db } for Render / uptime checks
 *   GET  /api/me                          who am I?
 *   GET  /api/stream                      live chat (Server-Sent Events)
 *   GET  /api/emote/:name                 emote image
 *   GET  /api/user/:name                  public profile
 *
 *   POST /api/auth/register               { name, password }        -> { me, codes }
 *   POST /api/auth/login                  { name, password }
 *   POST /api/auth/recover                { name, code, password }  reset with a recovery code
 *   POST /api/auth/logout
 *
 *   GET  /api/account                     your account
 *   POST /api/account/password            { current, next }
 *   POST /api/account/codes               { password }              -> fresh recovery codes
 *   GET  /api/account/sessions            your signed-in devices
 *   POST /api/account/sessions/revoke     { id }
 *   POST /api/account/sessions/revoke-others
 *   POST /api/account/delete              { password }
 *
 *   POST /api/send                        { text, rp? }   messages and /commands
 *   POST /api/vote                        { i }
 *   POST /api/report                      { id, reason? }
 *
 *   moderators:
 *   POST /api/del  /api/pin  /api/unpin   { id }
 *   POST /api/feature                     { p, u, note? } the Ater pick, or { clear: true }
 *   POST /api/poll                        { q, opts[], secs }
 *   POST /api/emote                       { name, data } (a data: URL) or { name, link } (a 7TV emote link)
 *   GET  /api/mod/reports                 open reports
 *   POST /api/mod/reports/resolve         { id, action: dismiss | delete | mute | ban }
 *   GET  /api/mod/log                     recent moderator actions
 *
 * Writes need the header  X-Ater: 1  and, from browsers, an Origin of this
 * site. Together these stop other websites posting with a visitor's cookie.
 */
const http = require('http');
const path = require('path');
const { openStore } = require('./store');
const { createAccounts, pub, isMod } = require('./accounts');
const { createChat } = require('./chat');
const { BUILTIN, SEVEN, checkUpload, check7tv, cdn } = require('./emotes');
const { createStatic } = require('./static');
const { setHeaders, sameSite, limiter } = require('./security');

const BODY_LIMIT = 500_000;
const STREAMS_PER_IP = 20;

async function createApp({
  dataFile = path.join(__dirname, '..', 'data', 'ater-data.json'),
  mongoUri = '', mongoDb = 'ater', mongoPrefix = '',
  publicDir = path.join(__dirname, '..', 'public'),
  owner = '', trustProxy = false, publicUrl = '', saveDelay,
  limits = {},
} = {}) {
  const store = await openStore({ mongoUri, mongoDb, mongoPrefix, dataFile, saveDelay });
  const state = await store.load();
  const accounts = createAccounts(store, state, { owner });
  const chat = createChat(store, state, accounts);
  const serveStatic = createStatic(publicDir);

  const authLimit = limiter(limits.auth ?? 30, 10 * 60_000);       // sign-in / recovery tries per IP
  const signupLimit = limiter(limits.signups ?? 5, 60 * 60_000);   // new accounts per IP per hour
  const reportLimit = limiter(20, 60 * 60_000);
  const streams = new Map();

  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const reply = (res, r) => (r.status ? json(res, r.status, { error: r.error }) : json(res, r.error ? 400 : 200, r));
  const readBody = (req) => new Promise((ok, no) => {
    let s = '', n = 0;
    req.on('data', (c) => { n += c.length; if (n > BODY_LIMIT) { no(new Error('too big')); req.destroy(); } else s += c; });
    req.on('end', () => { try { const v = s ? JSON.parse(s) : {}; ok(v && typeof v === 'object' ? v : {}); } catch (e) { no(e); } });
    req.on('error', no);
  });

  async function handle(req, res) {
    setHeaders(req, res);
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/healthz') return json(res, 200, { ok: true, db: store.kind, dbOk: await store.ping() });
      if (p === '/api/me') { const s = await accounts.sessionOf(req); return json(res, 200, { me: pub(s && s.user), server: 'ater', version: 3 }); }
      if (p === '/api/stream') {
        const ip = ipOf(req), n = streams.get(ip) || 0;
        if (n >= STREAMS_PER_IP) return json(res, 429, { error: 'Too many open chat windows.' });
        streams.set(ip, n + 1);
        req.on('close', () => { const m = (streams.get(ip) || 1) - 1; if (m > 0) streams.set(ip, m); else streams.delete(ip); });
        const s = await accounts.sessionOf(req);
        return chat.attach(req, res, s && s.user);
      }
      if (p.startsWith('/api/emote/')) {
        const name = decodeURIComponent(p.slice('/api/emote/'.length));
        const h = { 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" };
        if (BUILTIN[name]) { res.writeHead(200, { ...h, 'Content-Type': 'image/svg+xml' }); return res.end(BUILTIN[name]); }
        const e = state.emotes[name] || (SEVEN.has(name) && { type: '7tv', id: SEVEN.get(name).id });
        if (!e) { res.writeHead(404); return res.end(); }
        if (e.type === '7tv') { res.writeHead(302, { Location: cdn(e.id), 'Cache-Control': 'public, max-age=86400' }); return res.end(); }
        res.writeHead(200, { ...h, 'Content-Type': e.type });
        return res.end(Buffer.from(e.data, 'base64'));
      }
      if (p.startsWith('/api/user/')) {
        const prof = accounts.profile(decodeURIComponent(p.slice('/api/user/'.length)));
        return prof ? json(res, 200, prof) : json(res, 404, { error: 'No such account.' });
      }
      if (p === '/api/account' || p === '/api/account/sessions' || p.startsWith('/api/mod/')) {
        const s = await accounts.sessionOf(req);
        if (!s) return json(res, 401, { error: 'Sign in first.' });
        if (p === '/api/account') return json(res, 200, accounts.account(s.user));
        if (p === '/api/account/sessions') return json(res, 200, { sessions: await accounts.listSessions(s.user, s.sid) });
        if (!isMod(s.user)) return json(res, 403, { error: 'Moderators only.' });
        if (p === '/api/mod/reports') return json(res, 200, { reports: await store.listReports(true) });
        if (p === '/api/mod/log') return json(res, 200, { log: await store.listAudit(150) });
      }
      if (!p.startsWith('/api/') && serveStatic(req, res, p)) return;
      if (!p.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      return json(res, 404, { error: 'Not found' });
    }

    if (req.method !== 'POST' || !p.startsWith('/api/')) return json(res, 405, { error: 'Method not allowed' });
    if (req.headers['x-ater'] !== '1' || !sameSite(req, publicUrl)) return json(res, 403, { error: 'Missing header' });
    const b = await readBody(req);
    const ip = ipOf(req);

    /* ---- signing in ---- */
    if (p === '/api/auth/register') {
      if (b.website) return json(res, 400, { error: 'Something went wrong. Try again.' }); // honeypot: only bots fill it in
      if (signupLimit(ip)) return json(res, 429, { error: 'Too many new accounts from here. Try again later.' });
      const r = await accounts.register(b.name, b.password);
      if (r.error) return reply(res, r);
      await accounts.startSession(req, res, r.user);
      return json(res, 200, { me: pub(r.user), codes: r.codes });
    }
    if (p === '/api/auth/login' || p === '/api/auth/recover') {
      if (authLimit(ip)) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const r = p.endsWith('login') ? await accounts.login(b.name, b.password) : await accounts.recover(b.name, b.code, b.password);
      if (r.error) return reply(res, r);
      if (p.endsWith('recover')) chat.kick(r.user.name);
      await accounts.startSession(req, res, r.user);
      return json(res, 200, { me: pub(r.user), left: r.left });
    }
    if (p === '/api/auth/logout') { await accounts.endSession(req, res); return json(res, 200, { ok: true }); }

    const s = await accounts.sessionOf(req);
    if (!s) return json(res, 401, { error: 'Sign in to chat.' });
    const u = s.user;

    /* ---- your account ---- */
    if (p === '/api/account/password') return reply(res, await accounts.changePassword(u, b.current, b.next, s.sid));
    if (p === '/api/account/codes') return reply(res, await accounts.newCodes(u, b.password));
    if (p === '/api/account/sessions/revoke') return reply(res, await accounts.revokeSession(u, b.id, s.sid));
    if (p === '/api/account/sessions/revoke-others') { await accounts.revokeOthers(u, s.sid); return json(res, 200, { ok: true }); }
    if (p === '/api/account/delete') {
      const r = await accounts.deleteAccount(u, b.password);
      if (r.error) return reply(res, r);
      chat.purge(u.name);
      chat.kick(u.name);
      await accounts.endSession(req, res);
      return json(res, 200, { ok: true });
    }

    /* ---- chatting ---- */
    if (p === '/api/send') return reply(res, chat.say(u, b.text, b.rp));
    if (p === '/api/vote') return reply(res, chat.vote(u, b.i));
    if (p === '/api/report') {
      if (reportLimit(u.name.toLowerCase())) return json(res, 429, { error: 'That’s a lot of reports. The mods have them.' });
      return reply(res, await chat.report(u, String(b.id || ''), b.reason));
    }

    /* ---- moderators ---- */
    if (!isMod(u)) return json(res, 403, { error: 'Moderators only.' });
    if (p === '/api/del') return json(res, 200, { ok: chat.del(String(b.id || ''), u.name) });
    if (p === '/api/pin') return chat.pin(String(b.id || ''), u.name) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'That message is gone.' });
    if (p === '/api/unpin') { chat.unpin(String(b.id || ''), u.name); return json(res, 200, { ok: true }); }
    if (p === '/api/feature') return reply(res, b.clear ? chat.unfeature(u.name) : chat.feature(u.name, b.p, b.u, b.note));
    if (p === '/api/mod/reports/resolve') {
      if (!['dismiss', 'delete', 'mute', 'ban'].includes(b.action)) return json(res, 400, { error: 'Unknown action.' });
      return reply(res, await chat.resolveReport(u, String(b.id || ''), b.action));
    }
    if (p === '/api/poll') {
      const q = String(b.q || '').trim();
      const opts = (Array.isArray(b.opts) ? b.opts : []).map((x) => String(x).trim()).filter(Boolean);
      if (!q || opts.length < 2) return json(res, 400, { error: 'A question and at least two options.' });
      chat.startPoll(u.name, { q: q.slice(0, 200), opts: opts.slice(0, 8).map((o) => o.slice(0, 80)), secs: Math.max(10, Math.min(1800, Number(b.secs) || 60)) });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/emote') {
      const name = String(b.name || '');
      const r = b.link ? check7tv(state, name, b.link) : checkUpload(state, name, b.data);
      if (r.error) return json(res, 400, r);
      chat.addEmote(u.name, name, { ...r, by: u.name, ts: Date.now() });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!(e instanceof SyntaxError) && e.message !== 'too big') console.error(e);
      if (!res.headersSent) json(res, 400, { error: 'Bad request' });
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  return {
    server,
    store,
    async close() {
      chat.stop();
      await new Promise((ok) => server.close(() => ok()));
      await store.close();
    },
  };
}

module.exports = { createApp };
