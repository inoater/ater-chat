'use strict';
/*
 * The HTTP side: the website from public/, plus the Ater chat API.
 *
 *   GET  /healthz                         { ok, db } for Render / uptime checks
 *   GET  /api/me                          who am I? (+ sign-in providers)
 *   GET  /api/stream                      live chat (Server-Sent Events)
 *   GET  /api/emote/:name                 emote image
 *   GET  /api/media/:key                  profile pictures (av-name) and role badges (rb-id)
 *   GET  /api/user/:name                  public profile
 *
 *   POST /api/auth/register | login | recover | logout | oauth/finish
 *   GET  /api/auth/oauth/:p/start|callback          sign in with google | twitch | kick
 *
 *   GET  /api/account                     your account
 *   POST /api/account/profile             { color, accent, bio, pronouns, dmFrom }
 *   POST /api/account/avatar              { data } (a data: URL, already resized) or { clear: true }
 *   POST /api/account/block               { name, on }
 *   POST /api/account/password | codes | unlink | delete
 *   GET  /api/account/sessions; POST /api/account/sessions/revoke | revoke-others
 *
 *   GET  /api/dm/list                     your conversations
 *   GET  /api/dm/thread?with=name&before=ts
 *   POST /api/dm/send { to, text }; /api/dm/read { with }; /api/dm/hide { with }
 *
 *   POST /api/send { text, rp?, room? }; /api/vote { i }; /api/report { id, reason? }
 *
 *   Moderation and the dashboard (each checks the right power; see server/roles.js):
 *   GET  /api/mod/overview | users?q=&filter= | reports | log | bans | polls
 *   POST /api/del | pin | unpin { id }; /api/feature; /api/poll; /api/poll/end
 *   POST /api/emote { name, data | link }; /api/emote/remove { name }
 *   POST /api/mod/reports/resolve { id, action }
 *   POST /api/mod/timeout { name, minutes }; unmute { name }; ban { name, why }; unban { name }
 *   POST /api/mod/role { name, role, on }      give or take a role
 *   POST /api/mod/roles/save { id?, name, look, perms, timeoutMin }; roles/badge { id, data | clear };
 *        roles/delete { id }; roles/order { ids }
 *   POST /api/mod/rooms/save { id?, name, topic, post, view }; rooms/delete { id }
 *   POST /api/mod/settings { slow, linkWait }; /api/mod/filter { op, words }
 *
 * Writes need the header  X-Ater: 1  and, from browsers, an Origin of this
 * site. Together these stop other websites posting with a visitor's cookie.
 */
const http = require('http');
const path = require('path');
const { openStore } = require('./store');
const { createAccounts, pub, useRoles } = require('./accounts');
const { createRoles } = require('./roles');
const { createChat } = require('./chat');
const { BUILTIN, SEVEN, checkUpload, check7tv, cdn } = require('./emotes');
const { checkImage } = require('./media');
const { createStatic } = require('./static');
const { setHeaders, sameSite, limiter } = require('./security');
const { createOAuth, loadProviders } = require('./oauth');

const BODY_LIMIT = 600_000;
const STREAMS_PER_IP = 20;
const MEDIA_KEY = /^(av|rb)-[a-z0-9_]{1,24}$/;

async function createApp({
  dataFile = path.join(__dirname, '..', 'data', 'ater-data.json'),
  mongoUri = '', mongoDb = 'ater', mongoPrefix = '',
  publicDir = path.join(__dirname, '..', 'public'),
  owner = '', trustProxy = false, publicUrl = '', saveDelay,
  limits = {}, oauth: oauthOverrides = {}, env = process.env,
} = {}) {
  const store = await openStore({ mongoUri, mongoDb, mongoPrefix, dataFile, saveDelay });
  const state = await store.load();
  const roles = createRoles(store, state);
  useRoles(roles);
  const accounts = createAccounts(store, state, { owner });
  const chat = createChat(store, state, accounts, roles);
  const serveStatic = createStatic(publicDir);
  const oauth = createOAuth(loadProviders(env, oauthOverrides), accounts, { publicUrl });

  const authLimit = limiter(limits.auth ?? 30, 10 * 60_000);       // sign-in / recovery tries per IP
  const signupLimit = limiter(limits.signups ?? 5, 60 * 60_000);   // new accounts per IP per hour
  const reportLimit = limiter(20, 60 * 60_000);
  const uploadLimit = limiter(limits.uploads ?? 30, 60 * 60_000);  // pictures per account per hour
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
  const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return +d; };
  const userRow = (x) => {
    const k = x.name.toLowerCase(), b = state.kv.bans[k], m = state.kv.mutes[k];
    return { ...pub(x), msgs: x.msgs || 0, banned: b ? { by: b.by, ts: b.ts, why: b.why } : null, mutedUntil: m > Date.now() ? m : 0 };
  };

  async function handleGet(req, res, p, url) {
    if (p === '/healthz') return json(res, 200, { ok: true, db: store.kind, dbOk: await store.ping() });
    if (p === '/api/me') {
      const s = await accounts.sessionOf(req);
      return json(res, 200, { me: s ? { ...pub(s.user), perms: roles.permsOf(s.user) } : null, providers: oauth.list(), server: 'ater', version: 5 });
    }
    const om = p.match(/^\/api\/auth\/oauth\/(google|twitch|kick)\/(start|callback)$/);
    if (om) {
      if (om[2] === 'callback') return oauth.callback(req, res, om[1], url);
      const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
      const s = mode === 'link' ? await accounts.sessionOf(req) : null;
      return oauth.start(req, res, om[1], mode, s && s.user);
    }
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
    if (p.startsWith('/api/media/')) {
      const key = decodeURIComponent(p.slice('/api/media/'.length));
      const m = MEDIA_KEY.test(key) && (await store.getMedia(key));
      if (!m) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': m.type, 'Cache-Control': 'public, max-age=604800, immutable', 'Content-Security-Policy': "default-src 'none'" });
      return res.end(Buffer.from(m.data, 'base64'));
    }
    if (p.startsWith('/api/user/')) {
      const prof = accounts.profile(decodeURIComponent(p.slice('/api/user/'.length)));
      return prof ? json(res, 200, prof) : json(res, 404, { error: 'No such account.' });
    }
    if (!p.startsWith('/api/')) {
      if (serveStatic(req, res, p)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    const s = await accounts.sessionOf(req);
    if (!s) return json(res, 401, { error: 'Sign in first.' });
    const u = s.user;
    if (p === '/api/account') return json(res, 200, accounts.account(u));
    if (p === '/api/account/sessions') return json(res, 200, { sessions: await accounts.listSessions(u, s.sid) });
    if (p === '/api/dm/list') return json(res, 200, { convs: await chat.dmList(u) });
    if (p === '/api/dm/thread') return reply(res, await chat.dmThread(u, url.searchParams.get('with'), url.searchParams.get('before')));

    if (!p.startsWith('/api/mod/')) return json(res, 404, { error: 'Not found' });
    if (!roles.staff(u)) return json(res, 403, { error: 'This is for the mod team.' });
    if (p === '/api/mod/overview') {
      const [today, log, reports] = await Promise.all([store.countMessages(dayStart()), roles.isMod(u) ? store.listAudit(8) : [], roles.can(u, 'reports') ? store.listReports(true) : []]);
      return json(res, 200, { ...chat.stats(), today, log, reports: reports.slice(0, 5), openReports: reports.length, perms: roles.permsOf(u) });
    }
    if (p === '/api/mod/users') {
      const q = String(url.searchParams.get('q') || '').toLowerCase().slice(0, 20), f = url.searchParams.get('filter') || '';
      const t = Date.now();
      let list = [...accounts.all()];
      if (q) list = list.filter((x) => x.name.toLowerCase().includes(q));
      if (f === 'staff') list = list.filter((x) => (x.roles || []).length);
      if (f === 'banned') list = list.filter((x) => state.kv.bans[x.name.toLowerCase()]);
      if (f === 'timedout') list = list.filter((x) => state.kv.mutes[x.name.toLowerCase()] > t);
      list.sort((a, b) => (b.msgs || 0) - (a.msgs || 0));
      return json(res, 200, { users: list.slice(0, 60).map(userRow), total: list.length });
    }
    if (p === '/api/mod/reports') return roles.can(u, 'reports') ? json(res, 200, { reports: await store.listReports(true) }) : json(res, 403, { error: 'Your role can’t see reports.' });
    if (p === '/api/mod/log') return roles.isMod(u) ? json(res, 200, { log: await store.listAudit(300) }) : json(res, 403, { error: 'Moderators only.' });
    if (p === '/api/mod/bans') return json(res, 200, { bans: chat.bans(), timeouts: chat.mutes() });
    if (p === '/api/mod/polls') return json(res, 200, { polls: await store.listPolls(60) });
    return json(res, 404, { error: 'Not found' });
  }

  async function handlePost(req, res, p) {
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
    if (p === '/api/auth/oauth/finish') {
      if (signupLimit(ip)) return json(res, 429, { error: 'Too many new accounts from here. Try again later.' });
      const r = await oauth.finish(req, res, b.t, b.name);
      if (r.error) return reply(res, r);
      return json(res, 200, { me: pub(r.user), codes: r.codes });
    }

    const s = await accounts.sessionOf(req);
    if (!s) return json(res, 401, { error: 'Sign in to chat.' });
    const u = s.user;

    /* ---- your account ---- */
    if (p === '/api/account/password') return reply(res, await accounts.changePassword(u, b.current, b.next, s.sid));
    if (p === '/api/account/codes') return reply(res, await accounts.newCodes(u, b.password));
    if (p === '/api/account/sessions/revoke') return reply(res, await accounts.revokeSession(u, b.id, s.sid));
    if (p === '/api/account/sessions/revoke-others') { await accounts.revokeOthers(u, s.sid); return json(res, 200, { ok: true }); }
    if (p === '/api/account/unlink') return reply(res, await accounts.unlink(u, String(b.p || '')));
    if (p === '/api/account/profile') { const r = await accounts.updateProfile(u, b); if (!r.error) chat.refreshMe(u); return reply(res, r); }
    if (p === '/api/account/avatar') {
      if (!b.clear && uploadLimit(u.name.toLowerCase())) return json(res, 429, { error: 'That’s a lot of uploads. Try again later.' });
      const img = b.clear ? null : checkImage('avatar', b.data);
      if (img && img.error) return json(res, 400, img);
      const r = await accounts.setAvatar(u, img);
      chat.refreshMe(u);
      return reply(res, r);
    }
    if (p === '/api/account/block') return reply(res, await accounts.block(u, String(b.name || ''), Boolean(b.on)));
    if (p === '/api/account/delete') {
      const r = await accounts.deleteAccount(u, b.password, b.confirm);
      if (r.error) return reply(res, r);
      chat.purge(u.name);
      chat.kick(u.name);
      await accounts.endSession(req, res);
      return json(res, 200, { ok: true });
    }

    /* ---- direct messages ---- */
    if (p === '/api/dm/send') return reply(res, await chat.dm(u, String(b.to || ''), b.text));
    if (p === '/api/dm/read' || p === '/api/dm/hide') return reply(res, chat.dmMark(u, String(b.with || ''), p.endsWith('hide') ? 'hide' : 'read'));

    /* ---- chatting ---- */
    if (p === '/api/send') return reply(res, chat.say(u, b.text, b.rp, b.room || 'live'));
    if (p === '/api/vote') return reply(res, chat.vote(u, b.i));
    if (p === '/api/report') {
      if (reportLimit(u.name.toLowerCase())) return json(res, 429, { error: 'That’s a lot of reports. The mods have them.' });
      return reply(res, await chat.report(u, String(b.id || ''), b.reason));
    }

    /* ---- moderation: each action checks its own power ---- */
    const can = (perm) => roles.can(u, perm);
    const deny = (what) => json(res, 403, { error: 'Your role can’t ' + what + '.' });
    const target = () => accounts.find(String(b.name || ''));
    switch (p) {
      case '/api/del': return reply(res, chat.delAs(u, String(b.id || '')));
      case '/api/pin': return !can('pin') ? deny('pin messages') : chat.pin(String(b.id || ''), u.name) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'That message is gone.' });
      case '/api/unpin': if (!can('pin')) return deny('pin messages'); chat.unpin(String(b.id || ''), u.name); return json(res, 200, { ok: true });
      case '/api/feature': if (!can('feature')) return deny('set the Ater pick'); return reply(res, b.clear ? chat.unfeature(u.name) : chat.feature(u.name, b.p, b.u, b.note));
      case '/api/poll': {
        if (!can('polls')) return deny('run polls');
        const q = String(b.q || '').trim();
        const opts = (Array.isArray(b.opts) ? b.opts : []).map((x) => String(x).trim()).filter(Boolean);
        if (!q || opts.length < 2) return json(res, 400, { error: 'A question and at least two options.' });
        chat.startPoll(u.name, { q: q.slice(0, 200), opts: opts.slice(0, 8).map((o) => o.slice(0, 80)), secs: Math.max(10, Math.min(1800, Number(b.secs) || 60)) });
        return json(res, 200, { ok: true });
      }
      case '/api/poll/end': if (!can('polls')) return deny('run polls'); return chat.endPoll() ? json(res, 200, { ok: true }) : json(res, 400, { error: 'No poll running.' });
      case '/api/emote': {
        if (!can('emotes')) return deny('change emotes');
        const name = String(b.name || '');
        if (b.link) { const r = check7tv(state, name, b.link); if (r.error) return json(res, 400, r); chat.addEmote(u.name, name, { ...r, by: u.name, ts: Date.now() }); return json(res, 200, { ok: true }); }
        if (uploadLimit(u.name.toLowerCase())) return json(res, 429, { error: 'That’s a lot of uploads. Try again later.' });
        const img = checkImage('emote', b.data);
        if (img.error) return json(res, 400, img);
        const r = checkUpload(state, name, b.data);
        if (r.error) return json(res, 400, r);
        chat.addEmote(u.name, name, { type: img.type, data: img.data, w: img.w, h: img.h, by: u.name, ts: Date.now() });
        return json(res, 200, { ok: true });
      }
      case '/api/emote/remove': return reply(res, chat.removeEmote(u, String(b.name || '')));
      case '/api/mod/reports/resolve':
        if (!['dismiss', 'delete', 'mute', 'ban'].includes(b.action)) return json(res, 400, { error: 'Unknown action.' });
        return reply(res, await chat.resolveReport(u, String(b.id || ''), b.action));
      case '/api/mod/timeout': return reply(res, chat.timeout(u, target(), Math.max(1, Math.min(10080, Number(b.minutes) || 10)) * 60_000));
      case '/api/mod/unmute': return reply(res, chat.unmute(u, String(b.name || '')));
      case '/api/mod/ban': return reply(res, chat.ban(u, target(), b.why));
      case '/api/mod/unban': return reply(res, chat.unban(u, String(b.name || '')));
      case '/api/mod/role': return reply(res, chat.setRole(u, target(), String(b.role || ''), Boolean(b.on)));
      case '/api/mod/roles/save': {
        const r = roles.upsert(u, b);
        if (r.error) return reply(res, r);
        chat.audit(u.name, b.id ? 'role:edit' : 'role:new', '', r.role.name);
        chat.rolesChanged();
        return json(res, 200, { ok: true, role: r.role, roles: roles.publicList() });
      }
      case '/api/mod/roles/badge': {
        if (!b.clear && uploadLimit(u.name.toLowerCase())) return json(res, 429, { error: 'That’s a lot of uploads. Try again later.' });
        const img = b.clear ? null : checkImage('badge', b.data);
        if (img && img.error) return json(res, 400, img);
        const role = roles.get(String(b.id || ''));
        const key = 'rb-' + String(b.id || '');
        const r = roles.setBadge(u, String(b.id || ''), img ? { ts: Date.now() } : null);
        if (r.error) return reply(res, r);
        if (img) await store.saveMedia(key, { type: img.type, data: img.data, ts: r.role.badge.ts }); else await store.deleteMedia(key);
        chat.audit(u.name, 'role:badge', '', role ? role.name : '');
        chat.rolesChanged();
        return json(res, 200, { ok: true, roles: roles.publicList() });
      }
      case '/api/mod/roles/delete': {
        const r = roles.remove(u, String(b.id || ''));
        if (r.error) return reply(res, r);
        for (const x of accounts.all()) if ((x.roles || []).includes(r.role.id)) { x.roles = x.roles.filter((y) => y !== r.role.id); accounts.save(x); }
        if (r.role.badge) store.deleteMedia('rb-' + r.role.id);
        chat.audit(u.name, 'role:delete', '', r.role.name);
        chat.rolesChanged();
        return json(res, 200, { ok: true, roles: roles.publicList() });
      }
      case '/api/mod/roles/order': { const r = roles.reorder(u, b.ids); if (r.error) return reply(res, r); chat.rolesChanged(); return json(res, 200, { ok: true, roles: roles.publicList() }); }
      case '/api/mod/rooms/save': return reply(res, chat.saveRoom(u, b));
      case '/api/mod/rooms/delete': return reply(res, chat.removeRoom(u, String(b.id || '')));
      case '/api/mod/settings': return reply(res, chat.setSettings(u, b));
      case '/api/mod/filter': {
        const words = (Array.isArray(b.words) ? b.words : String(b.words || '').split(/\s+/)).join(' ');
        return reply(res, chat.command(u, `/filter ${b.op === 'remove' ? 'remove' : b.op === 'list' ? 'list' : 'add'} ${words}`));
      }
      default: return json(res, 404, { error: 'Not found' });
    }
  }

  async function handle(req, res) {
    setHeaders(req, res);
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' || req.method === 'HEAD') return handleGet(req, res, url.pathname, url);
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return json(res, 405, { error: 'Method not allowed' });
    return handlePost(req, res, url.pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!(e instanceof SyntaxError) && e.message !== 'too big') console.error(e);
      if (!res.headersSent) json(res, e.message === 'too big' ? 413 : 400, { error: e.message === 'too big' ? 'That’s too big.' : 'Bad request' });
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
