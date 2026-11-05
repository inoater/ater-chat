'use strict';
/*
 * The HTTP side: the website from public/, plus the Ater chat API.
 *
 *   GET  /api/me                who am I?
 *   GET  /api/stream            live chat (Server-Sent Events)
 *   GET  /api/emote/:name       emote image
 *   GET  /healthz               "ok" (for uptime checks and Docker)
 *   POST /api/auth/register     { name, password }
 *   POST /api/auth/login        { name, password }
 *   POST /api/auth/logout
 *   POST /api/send              { text, rp? }   messages and /commands
 *   POST /api/vote              { i }
 *   POST /api/del  /api/pin  /api/unpin   { id }      moderators
 *   POST /api/poll              { q, opts[], secs }   moderators
 *   POST /api/emote             { name, data }        moderators, data is a data: URL
 *
 * Every POST must carry the header  X-Ater: 1. Other websites can't add a
 * custom header without the browser asking this server first (and it never
 * agrees), so this blocks cross-site form posts riding on the login cookie.
 */
const http = require('http');
const path = require('path');
const { createStore } = require('./store');
const { createAccounts, pub, isMod } = require('./accounts');
const { createChat } = require('./chat');
const { BUILTIN, emoteList, checkUpload } = require('./emotes');
const { createStatic } = require('./static');

const BODY_LIMIT = 500_000;
const AUTH_TRIES = 25;            // per IP …
const AUTH_WINDOW = 10 * 60_000;  // … per 10 minutes
const STREAMS_PER_IP = 20;

function createApp({
  dataFile = path.join(__dirname, '..', 'data', 'ater-data.json'),
  publicDir = path.join(__dirname, '..', 'public'),
  owner = '',
  trustProxy = false,
  saveDelay,
} = {}) {
  const store = createStore(dataFile, { delay: saveDelay });
  const accounts = createAccounts(store, { owner });
  const chat = createChat(store, accounts);
  const serveStatic = createStatic(publicDir);
  const tries = new Map();
  const streams = new Map();

  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  function limited(ip) {
    const t = Date.now(), r = tries.get(ip) || { n: 0, t };
    if (t - r.t > AUTH_WINDOW) { r.n = 0; r.t = t; }
    r.n++; tries.set(ip, r);
    return r.n > AUTH_TRIES;
  }
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const reply = (res, r) => json(res, r.status || (r.error ? 400 : 200), r.status ? { error: r.error } : r);
  const readBody = (req) => new Promise((ok, no) => {
    let s = '', n = 0;
    req.on('data', (c) => { n += c.length; if (n > BODY_LIMIT) { no(new Error('too big')); req.destroy(); } else s += c; });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } });
    req.on('error', no);
  });

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const db = store.db;

    if (req.method === 'GET') {
      if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
      if (p === '/api/me') return json(res, 200, { me: pub(accounts.userOf(req)), server: 'ater', version: 2 });
      if (p === '/api/stream') {
        const ip = ipOf(req), n = streams.get(ip) || 0;
        if (n >= STREAMS_PER_IP) return json(res, 429, { error: 'Too many open chat windows.' });
        streams.set(ip, n + 1);
        req.on('close', () => { const m = (streams.get(ip) || 1) - 1; if (m > 0) streams.set(ip, m); else streams.delete(ip); });
        return chat.attach(req, res, accounts.userOf(req));
      }
      if (p.startsWith('/api/emote/')) {
        const name = decodeURIComponent(p.slice('/api/emote/'.length));
        const h = { 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" };
        if (BUILTIN[name]) { res.writeHead(200, { ...h, 'Content-Type': 'image/svg+xml' }); return res.end(BUILTIN[name]); }
        const e = db.emotes[name];
        if (!e) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { ...h, 'Content-Type': e.type });
        return res.end(Buffer.from(e.data, 'base64'));
      }
    }
    if (!p.startsWith('/api/')) {
      if (serveStatic(req, res, p)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
    if (req.headers['x-ater'] !== '1') return json(res, 403, { error: 'Missing header' });

    const b = await readBody(req);

    if (p === '/api/auth/register' || p === '/api/auth/login') {
      if (limited(ipOf(req))) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const r = p.endsWith('register') ? accounts.register(b.name, b.password) : accounts.login(b.name, b.password);
      if (r.error) return reply(res, r);
      accounts.startSession(req, res, r.user);
      return json(res, 200, { me: pub(r.user) });
    }
    if (p === '/api/auth/logout') { accounts.endSession(req, res); return json(res, 200, { ok: true }); }

    const u = accounts.userOf(req);
    if (!u) return json(res, 401, { error: 'Sign in to chat.' });
    if (p === '/api/send') return reply(res, chat.say(u, b.text, b.rp));
    if (p === '/api/vote') return reply(res, chat.vote(u, b.i));

    if (!isMod(u)) return json(res, 403, { error: 'Moderators only.' });
    if (p === '/api/del') return json(res, 200, { ok: chat.del(String(b.id || '')) });
    if (p === '/api/pin') return chat.pin(String(b.id || ''), u.name) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'That message is gone.' });
    if (p === '/api/unpin') { chat.unpin(String(b.id || '')); return json(res, 200, { ok: true }); }
    if (p === '/api/poll') {
      const q = String(b.q || '').trim();
      const opts = (Array.isArray(b.opts) ? b.opts : []).map((s) => String(s).trim()).filter(Boolean);
      if (!q || opts.length < 2) return json(res, 400, { error: 'A question and at least two options.' });
      chat.startPoll(u.name, { q: q.slice(0, 200), opts: opts.slice(0, 8).map((o) => o.slice(0, 80)), secs: Math.max(10, Math.min(1800, Number(b.secs) || 60)) });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/emote') {
      const name = String(b.name || '');
      const r = checkUpload(db, name, b.data);
      if (r.error) return json(res, 400, r);
      db.emotes[name] = { type: r.type, data: r.data, by: u.name, ts: Date.now() };
      store.save();
      chat.broadcast('emotes', emoteList(db));
      chat.notice(`${u.name} added the emote ${name}.`);
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

  return {
    server,
    store,
    /** Stop live streams and timers, save to disk. */
    close() {
      chat.stop();
      accounts.stop();
      store.flush();
      return new Promise((ok) => server.close(() => ok()));
    },
  };
}

module.exports = { createApp };
