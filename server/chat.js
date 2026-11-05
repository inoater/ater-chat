'use strict';
/*
 * Ater chat: live clients over Server-Sent Events, messages, presence,
 * pins, polls, whispers, reports, the moderator log and commands.
 *
 * Events sent to browsers:
 *   hello     { me, history, pins, poll, emotes, presence, settings }  on connect
 *   msg       a chat message
 *   del       { id }        a message was deleted
 *   clear     { by }        a moderator cleared chat
 *   pins      [ ... ]       the pinned messages changed
 *   poll      poll | null   a poll started, got votes, ended or went away
 *   presence  { n, users }  who is here
 *   emotes    [ ... ]       the emote list changed
 *   settings  { slow }      chat settings changed
 *   notice    { ts, text }  system line (mutes, bans, slow mode…)
 *   whisper   { ts, from, to, text }  only to the two people involved
 *   me        { me }        your own account changed (made a mod, etc.)
 *   modqueue  { reports }   moderators only: how many reports are open
 */
const crypto = require('crypto');
const { badges, pub, isMod, isOwner, lc, dayUTC } = require('./accounts');
const { emoteList, isEmote } = require('./emotes');

const HIST_MAX = 300;
const HELLO_HISTORY = 150;
const MAX_LEN = 500;
const MAX_PINS = 3;
const NEW_ACCOUNT_LINKS_MS = 10 * 60_000;
const LINK_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|gg|tv|io|ly|me|xyz|ru|co|link|app|site|live)\b/i;

const now = () => Date.now();
const newId = () => now().toString(36) + crypto.randomBytes(3).toString('hex');
const fmtDur = (ms) => { const m = Math.ceil(ms / 6e4); return m >= 1440 ? Math.round(m / 1440) + 'd' : m >= 60 ? Math.round(m / 60) + 'h' : m + 'm'; };
function parseDur(s, fallback) {
  const m = String(s || '').match(/^(\d+)\s*(s|m|h|d)?$/i);
  return m ? +m[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[(m[2] || 'm').toLowerCase()] : fallback;
}

/** "/poll [secs] Question? A | B | C"  ->  { secs, q, opts }  or  { error } */
function parsePoll(arg) {
  let secs = 60;
  let body = String(arg || '').trim();
  const t = body.match(/^(\d{1,4})\s+(.*)$/);
  if (t) { secs = Math.max(10, Math.min(1800, +t[1])); body = t[2]; }
  let q, opts;
  const qi = body.indexOf('?');
  const parts = body.split('|').map((s) => s.trim()).filter(Boolean);
  if (qi >= 0) { q = body.slice(0, qi + 1).trim(); opts = body.slice(qi + 1).split('|').map((s) => s.trim()).filter(Boolean); }
  else if (parts.length >= 3) { q = parts[0]; opts = parts.slice(1); }
  else return { error: 'Usage: /poll [seconds] Question? Option A | Option B' };
  if (!q) return { error: 'The poll needs a question.' };
  if (opts.length < 2) opts = ['Yes', 'No'];
  return { secs, q: q.slice(0, 200), opts: opts.slice(0, 8).map((o) => o.slice(0, 80)) };
}

/** A blocked word matches as a whole word, ignoring case. */
function filterHit(text, words) {
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
  return words.find((w) => w && t.includes(' ' + w + ' ')) || null;
}

function createChat(store, state, accounts) {
  const kv = state.kv;
  kv.pins ||= []; kv.bans ||= {}; kv.mutes ||= {}; kv.settings ||= { slow: 0 }; kv.filters ||= [];
  const history = state.history;
  const clients = new Map(); // id -> { res, u }
  const recent = new Map();
  let clientSeq = 0;

  const saveKV = (k) => store.saveKV(k, kv[k]);
  const userOf = (k) => k && state.users.get(k);

  /* ---------- sending ---------- */
  const send = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* gone */ } };
  const broadcast = (ev, data, only) => { for (const c of clients.values()) if (!only || only(c)) send(c.res, ev, data); };
  const toMods = (ev, data) => broadcast(ev, data, (c) => isMod(userOf(c.u)));
  const notice = (text) => broadcast('notice', { ts: now(), text });
  const toUser = (name, ev, data) => broadcast(ev, data, (c) => c.u === lc(name));

  /* ---------- moderator log + reports ---------- */
  function audit(by, act, target = '', detail = '') {
    const e = { ts: now(), by, act, target, detail: String(detail).slice(0, 300) };
    store.addAudit(e);
    toMods('modlog', e);
  }
  let openReports = 0;
  store.listReports(true).then((r) => { openReports = r.length; }).catch(() => {});
  const queue = () => toMods('modqueue', { reports: openReports });

  async function report(u, msgId, reason) {
    const m = history.find((x) => x.id === msgId);
    if (!m) return { error: 'That message is gone.' };
    if (lc(m.name) === lc(u.name)) return { error: 'You can’t report yourself.' };
    if (await store.findReport(msgId, u.name)) return { ok: true, info: 'You already reported that. Thanks.' };
    const r = { id: newId(), ts: now(), by: u.name, reason: String(reason || '').slice(0, 200), msg: { id: m.id, name: m.name, text: m.text, ts: m.ts }, done: false };
    await store.addReport(r);
    openReports++;
    queue();
    return { ok: true, info: 'Reported. The moderators will take a look.' };
  }
  async function resolveReport(mod, id, action) {
    const list = await store.listReports(true);
    const r = list.find((x) => x.id === id);
    if (!r) return { error: 'That report is already handled.' };
    let res = { ok: true };
    if (action === 'delete') del(r.msg.id); // logged once below as report:delete
    else if (action === 'mute') res = command(mod, `/mute ${r.msg.name} 10m`);
    else if (action === 'ban') res = command(mod, `/ban ${r.msg.name} reported: ${r.reason || 'no reason'}`);
    if (res.error) return res;
    // one decision closes every report about the same message
    await store.updateReports({ msgId: r.msg.id }, { done: true, by_mod: mod.name, action, doneAt: now() });
    const closed = list.filter((x) => x.msg.id === r.msg.id).length;
    openReports = Math.max(0, openReports - closed);
    // mute and ban already log themselves through the command; dismiss and delete are logged here
    if (action === 'dismiss' || action === 'delete') audit(mod.name, 'report:' + action, r.msg.name, r.msg.text);
    queue();
    return { ok: true };
  }

  /* ---------- presence ---------- */
  let presTimer = null;
  function presenceData() {
    const seen = new Map();
    for (const c of clients.values()) { const u = userOf(c.u); if (u && !seen.has(c.u)) seen.set(c.u, pub(u)); }
    const rank = (u) => (u.owner ? 0 : u.mod ? 1 : 2);
    return { n: clients.size, users: [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)) };
  }
  function presence() { if (presTimer) return; presTimer = setTimeout(() => { presTimer = null; broadcast('presence', presenceData()); }, 1200); }
  const keepAlive = setInterval(() => { for (const c of clients.values()) try { c.res.write(': ping\n\n'); } catch {} }, 25000);
  keepAlive.unref();

  /* ---------- polls (in memory: a restart ends them) ---------- */
  let poll = null, pollTimer = null, pollBatch = null;
  const pollPub = (who) => poll && {
    id: poll.id, q: poll.q, opts: poll.opts.map((o) => ({ t: o.t, n: o.n })), ends: poll.ends, by: poll.by, done: poll.done,
    total: poll.opts.reduce((a, o) => a + o.n, 0), mine: who && poll.voters[who] != null ? poll.voters[who] : null,
  };
  const pollCast = () => { for (const c of clients.values()) send(c.res, 'poll', pollPub(c.u)); };
  function pollStart(by, { q, opts, secs }) {
    clearTimeout(pollTimer);
    poll = { id: crypto.randomBytes(4).toString('hex'), q, opts: opts.map((t) => ({ t, n: 0 })), ends: now() + secs * 1000, by, done: false, voters: {} };
    pollCast();
    pollTimer = setTimeout(pollEnd, secs * 1000);
    audit(by, 'poll', '', q);
  }
  function pollEnd() {
    if (!poll || poll.done) return;
    poll.done = true; poll.ends = now(); pollCast();
    const id = poll.id;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { if (poll && poll.id === id) { poll = null; pollCast(); } }, 60000);
  }
  function vote(u, i) {
    if (!poll || poll.done) return { error: 'There is no poll running.' };
    i = Number(i);
    if (!(i >= 0 && i < poll.opts.length)) return { error: 'That option does not exist.' };
    const k = lc(u.name);
    if (poll.voters[k] != null) return { error: 'You already voted.' };
    poll.voters[k] = i; poll.opts[i].n++;
    if (!pollBatch) pollBatch = setTimeout(() => { pollBatch = null; pollCast(); }, 400);
    return { ok: true, mine: i };
  }

  /* ---------- messages, pins, moderation ---------- */
  function post(msg) {
    history.push(msg);
    if (history.length > HIST_MAX) history.splice(0, history.length - HIST_MAX);
    store.addMessage(msg);
    broadcast('msg', msg);
  }
  function pinAdd(p, by) {
    p.by = by;
    kv.pins = [p, ...kv.pins.filter((x) => x.id !== p.id)].slice(0, MAX_PINS);
    saveKV('pins'); broadcast('pins', kv.pins);
    audit(by, 'pin', p.name, p.text);
  }
  function unpin(id, by) {
    kv.pins = id ? kv.pins.filter((x) => x.id !== id) : [];
    saveKV('pins'); broadcast('pins', kv.pins);
    if (by) audit(by, 'unpin', '', id || 'all');
  }
  function del(id, by) {
    const i = history.findIndex((x) => x.id === id);
    const m = i >= 0 ? history.splice(i, 1)[0] : null;
    store.deleteMessage(id);
    broadcast('del', { id });
    if (kv.pins.some((x) => x.id === id)) unpin(id);
    if (by) audit(by, 'delete', m ? m.name : '', m ? m.text : id);
    return Boolean(m);
  }
  function purge(name) {
    const k = lc(name);
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) if (lc(history[i].name) === k) { broadcast('del', { id: history[i].id }); history.splice(i, 1); n++; }
    store.deleteMessagesBy(name);
    return n;
  }
  const isOnline = (k) => [...clients.values()].some((c) => c.u === k);

  function command(u, text) {
    const [c0, ...rest] = text.trim().split(/\s+/);
    const c = c0.toLowerCase(), arg = rest.join(' ');
    const modOnly = () => (isMod(u) ? null : { error: 'Only moderators can use ' + c + '.' });
    const target = () => accounts.find(rest[0]);
    const noUser = () => ({ error: 'No Ater account called ' + (rest[0] || 'that') + '.' });

    switch (c) {
      case '/w': case '/whisper': case '/msg': case '/tell': {
        const to = target(), body = rest.slice(1).join(' ').trim();
        if (!to) return noUser();
        if (!body) return { error: 'Usage: /w name message' };
        if (lc(to.name) === lc(u.name)) return { error: 'Whispering to yourself?' };
        if (!isOnline(lc(to.name))) return { error: to.name + ' is not online right now.' };
        const w = { ts: now(), from: u.name, to: to.name, text: body.slice(0, MAX_LEN) };
        broadcast('whisper', w, (cl) => cl.u === lc(to.name) || cl.u === lc(u.name));
        return { ok: true };
      }
      case '/color': case '/colour': {
        if (!arg || /^(reset|none|off)$/i.test(arg)) { u.color = ''; accounts.save(u); return { ok: true, info: 'Name colour reset.' }; }
        if (!/^#[0-9a-f]{6}$/i.test(arg)) return { error: 'Use a hex colour, like /color #a855f7' };
        u.color = arg.toLowerCase(); accounts.save(u);
        return { ok: true, info: 'Name colour set to ' + u.color + '.' };
      }
      case '/vote': return vote(u, (Number(arg) || 0) - 1);
      case '/poll': {
        const e = modOnly(); if (e) return e;
        const p = parsePoll(arg); if (p.error) return p;
        pollStart(u.name, p); return { ok: true };
      }
      case '/endpoll': {
        const e = modOnly(); if (e) return e;
        if (!poll || poll.done) return { error: 'No poll running.' };
        pollEnd(); return { ok: true };
      }
      case '/pin': {
        const e = modOnly(); if (e) return e;
        if (!arg) return { error: 'Usage: /pin text, or hover a message and press the pin.' };
        pinAdd({ id: newId(), ts: now(), name: u.name, color: u.color || '', b: badges(u), text: arg.slice(0, MAX_LEN) }, u.name);
        return { ok: true };
      }
      case '/unpin': { const e = modOnly(); if (e) return e; unpin('', u.name); return { ok: true }; }
      case '/mute': case '/timeout': {
        const e = modOnly(); if (e) return e;
        const t = target(); if (!t) return noUser();
        if (isMod(t) && !isOwner(u)) return { error: 'Moderators can not be muted.' };
        const d = parseDur(rest[1], 6e5);
        kv.mutes[lc(t.name)] = now() + d; saveKV('mutes');
        notice(`${t.name} was muted for ${fmtDur(d)} by ${u.name}.`);
        audit(u.name, 'mute', t.name, fmtDur(d));
        return { ok: true };
      }
      case '/unmute': {
        const e = modOnly(); if (e) return e;
        delete kv.mutes[lc(rest[0])]; saveKV('mutes');
        notice((rest[0] || '?') + ' was unmuted.');
        audit(u.name, 'unmute', rest[0] || '');
        return { ok: true };
      }
      case '/ban': {
        const e = modOnly(); if (e) return e;
        const t = target(); if (!t) return noUser();
        if (isOwner(t) || (isMod(t) && !isOwner(u))) return { error: 'You can not ban ' + t.name + '.' };
        const why = rest.slice(1).join(' ');
        kv.bans[lc(t.name)] = { name: t.name, by: u.name, ts: now(), why };
        saveKV('bans'); purge(t.name);
        notice(`${t.name} was banned by ${u.name}.`);
        audit(u.name, 'ban', t.name, why);
        return { ok: true };
      }
      case '/unban': {
        const e = modOnly(); if (e) return e;
        if (!kv.bans[lc(rest[0])]) return { error: (rest[0] || 'That name') + ' isn’t banned.' };
        delete kv.bans[lc(rest[0])]; saveKV('bans');
        audit(u.name, 'unban', rest[0]);
        return { ok: true, info: rest[0] + ' is unbanned.' };
      }
      case '/bans': {
        const e = modOnly(); if (e) return e;
        const list = Object.values(kv.bans);
        return { ok: true, info: list.length ? 'Banned: ' + list.map((b) => b.name || '?').join(', ') : 'Nobody is banned.' };
      }
      case '/purge': {
        const e = modOnly(); if (e) return e;
        const n = purge(rest[0] || '');
        audit(u.name, 'purge', rest[0] || '', n + ' messages');
        return { ok: true, info: `Removed ${n} messages from ${rest[0] || '?'}.` };
      }
      case '/clear': {
        const e = modOnly(); if (e) return e;
        history.length = 0; store.clearMessages();
        broadcast('clear', { by: u.name });
        audit(u.name, 'clear');
        return { ok: true };
      }
      case '/slow': {
        const e = modOnly(); if (e) return e;
        const s = /^(off|0)$/i.test(arg) ? 0 : Math.max(1, Math.min(300, parseInt(arg, 10) || 10));
        kv.settings.slow = s; saveKV('settings');
        broadcast('settings', kv.settings);
        notice(s ? `Slow mode is on: one message every ${s}s.` : 'Slow mode is off.');
        audit(u.name, 'slow', '', s ? s + 's' : 'off');
        return { ok: true };
      }
      case '/filter': {
        const e = modOnly(); if (e) return e;
        const op = (rest[0] || 'list').toLowerCase();
        const words = rest.slice(1).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
        if (op === 'list') return { ok: true, info: kv.filters.length ? 'Blocked words: ' + kv.filters.join(', ') : 'No blocked words.' };
        if (!words.length) return { error: 'Usage: /filter add word … | /filter remove word … | /filter list' };
        if (op === 'add') kv.filters = [...new Set([...kv.filters, ...words])].slice(0, 500);
        else if (op === 'remove') kv.filters = kv.filters.filter((w) => !words.includes(w));
        else return { error: 'Usage: /filter add word … | /filter remove word … | /filter list' };
        saveKV('filters');
        audit(u.name, 'filter:' + op, '', words.join(', '));
        return { ok: true, info: `${op === 'add' ? 'Blocked' : 'Unblocked'}: ${words.join(', ')}.` };
      }
      case '/mod': case '/unmod': {
        if (!isOwner(u)) return { error: 'Only the broadcaster can change moderators.' };
        const t = target(); if (!t) return noUser();
        t.roles = (t.roles || []).filter((r) => r !== 'mod');
        if (c === '/mod') t.roles.push('mod');
        accounts.save(t);
        notice(t.name + (c === '/mod' ? ' is now a moderator.' : ' is no longer a moderator.'));
        audit(u.name, c.slice(1), t.name);
        toUser(t.name, 'me', { me: pub(t) });
        if (c === '/mod') toUser(t.name, 'modqueue', { reports: openReports });
        presence();
        return { ok: true };
      }
      case '/emote': {
        const e = modOnly(); if (e) return e;
        if (/^(remove|delete|rm)$/i.test(rest[0] || '')) {
          const n = rest[1];
          if (!state.emotes[n]) return { error: isEmote(state, n) ? 'Built-in emotes stay.' : 'No emote called ' + n + '.' };
          delete state.emotes[n]; store.deleteEmote(n);
          broadcast('emotes', emoteList(state));
          audit(u.name, 'emote:remove', '', n);
          return { ok: true, info: 'Removed ' + n + '.' };
        }
        return { error: 'Add emotes from chat settings. Remove with /emote remove Name' };
      }
      default: return { error: 'Unknown command ' + c + '. Type /help.' };
    }
  }

  /** Everything typed into the chat box ends up here. */
  function say(u, text, replyTo) {
    text = String(text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return { error: 'Say something first.' };
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
    const k = lc(u.name), t = now(), mod = isMod(u);
    if (kv.bans[k]) return { error: 'You are banned from Ater chat.' };
    if (kv.mutes[k] > t) return { error: 'You are muted for ' + fmtDur(kv.mutes[k] - t) + ' more.' };
    if (text.startsWith('/') && !/^\/me\s/i.test(text)) return command(u, text);

    const r = recent.get(k) || {};
    recent.set(k, r);
    const slow = kv.settings.slow;
    if (r.last && t - r.last < 450) return { error: 'Slow down a little.' };
    if (!mod && slow && r.last && t - r.last < slow * 1000) return { error: `Slow mode: wait ${Math.ceil((slow * 1000 - (t - r.last)) / 1000)}s.` };
    if (!mod && !isEmote(state, text) && r.text === text && t - r.last < 20000) return { error: 'Duplicate message.' };
    if (!mod && filterHit(text, kv.filters)) return { error: 'That message has a blocked word in it.' };
    if (!mod && t - (u.created || 0) < NEW_ACCOUNT_LINKS_MS && LINK_RE.test(text)) {
      return { error: `New accounts can post links after ${Math.ceil((NEW_ACCOUNT_LINKS_MS - (t - u.created)) / 60000)} more minute(s). It keeps spam bots out.` };
    }

    let me = false;
    if (/^\/me\s/i.test(text)) { me = true; text = text.slice(4).trim(); if (!text) return { error: '/me what?' }; }
    let rp = null;
    if (replyTo) {
      const o = history.find((m) => m.id === replyTo);
      if (o) rp = { id: o.id, n: o.name, t: o.text.slice(0, 160) };
    }
    r.last = t; r.text = text;
    u.msgs = (u.msgs || 0) + 1;
    const d = dayUTC(t), s = u.streak || (u.streak = { last: '', n: 0 });
    if (s.last !== d) { s.n = s.last === dayUTC(t - 864e5) ? s.n + 1 : 1; s.last = d; }
    accounts.save(u);
    post({ id: newId(), ts: t, name: u.name, color: u.color || '', b: badges(u), text, me, rp });
    return { ok: true };
  }

  function attach(req, res, user) {
    const id = ++clientSeq;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const who = user ? lc(user.name) : null;
    clients.set(id, { res, u: who });
    send(res, 'hello', {
      me: pub(user), history: history.slice(-HELLO_HISTORY), pins: kv.pins, poll: pollPub(who),
      emotes: emoteList(state), presence: presenceData(), settings: kv.settings,
    });
    if (isMod(user)) send(res, 'modqueue', { reports: openReports });
    presence();
    req.on('close', () => { clients.delete(id); presence(); });
  }

  /** Close every live stream of one account (sign-out everywhere, deleted account). */
  function kick(name) { for (const [id, c] of clients) if (c.u === lc(name)) { try { c.res.end(); } catch {} clients.delete(id); } presence(); }

  function stop() {
    clearInterval(keepAlive); clearTimeout(pollTimer); clearTimeout(pollBatch); clearTimeout(presTimer);
    for (const c of clients.values()) try { c.res.end(); } catch {}
    clients.clear();
  }

  return {
    attach, say, vote, del, unpin, stop, notice, broadcast, report, resolveReport, purge, kick, audit,
    pin: (id, by) => { const m = history.find((x) => x.id === id); if (!m) return false; pinAdd({ ...m }, by); return true; },
    startPoll: (by, p) => pollStart(by, p),
    addEmote(by, name, e) { state.emotes[name] = e; store.saveEmote(name, e); broadcast('emotes', emoteList(state)); notice(`${by} added the emote ${name}.`); audit(by, 'emote:add', '', name); },
    get clientCount() { return clients.size; },
  };
}

module.exports = { createChat, parsePoll, parseDur, filterHit };
