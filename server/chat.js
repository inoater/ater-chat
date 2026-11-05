'use strict';
/*
 * Ater chat: live clients over Server-Sent Events, messages, presence,
 * pins, polls, whispers and moderator commands.
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
 */
const crypto = require('crypto');
const { badges, pub, isMod, isOwner, lc, dayUTC } = require('./accounts');
const { emoteList, isEmote } = require('./emotes');

const HIST_MAX = 300;     // messages kept for new arrivals
const HELLO_HISTORY = 150;
const MAX_LEN = 500;
const MAX_PINS = 3;

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

function createChat(store, accounts) {
  const db = () => store.db;
  const clients = new Map(); // id -> { res, u (lowercase name or null), ip }
  const recent = new Map();  // lowercase name -> { last, text } for rate limits
  let clientSeq = 0;

  /* ---------- sending ---------- */
  const send = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client went away */ } };
  const broadcast = (ev, data, only) => { for (const c of clients.values()) if (!only || only(c)) send(c.res, ev, data); };
  const notice = (text) => broadcast('notice', { ts: now(), text });

  /* ---------- presence ---------- */
  let presTimer = null;
  function presenceData() {
    const seen = new Map();
    for (const c of clients.values()) {
      const u = c.u && db().users[c.u];
      if (u && !seen.has(c.u)) seen.set(c.u, pub(u));
    }
    const rank = (u) => (u.owner ? 0 : u.mod ? 1 : 2);
    return { n: clients.size, users: [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)) };
  }
  function presence() {
    if (presTimer) return;
    presTimer = setTimeout(() => { presTimer = null; broadcast('presence', presenceData()); }, 1200);
  }
  const keepAlive = setInterval(() => { for (const c of clients.values()) try { c.res.write(': ping\n\n'); } catch {} }, 25000);
  keepAlive.unref();

  /* ---------- polls ---------- */
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
  }
  function pollEnd() {
    if (!poll || poll.done) return;
    poll.done = true; poll.ends = now(); pollCast();
    const id = poll.id;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { if (poll && poll.id === id) { poll = null; pollCast(); } }, 60000); // results stay up for a minute
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
    const h = db().history;
    h.push(msg);
    if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX);
    store.save();
    broadcast('msg', msg);
  }
  function pinAdd(p, by) {
    p.by = by;
    db().pins = [p, ...db().pins.filter((x) => x.id !== p.id)].slice(0, MAX_PINS);
    store.save(); broadcast('pins', db().pins);
  }
  function unpin(id) {
    db().pins = id ? db().pins.filter((x) => x.id !== id) : [];
    store.save(); broadcast('pins', db().pins);
  }
  function del(id) {
    const before = db().history.length;
    db().history = db().history.filter((x) => x.id !== id);
    store.save(); broadcast('del', { id });
    if (db().pins.some((x) => x.id === id)) unpin(id);
    return before !== db().history.length;
  }
  function purge(name) {
    const k = lc(name);
    let n = 0;
    db().history = db().history.filter((m) => { if (lc(m.name) === k) { broadcast('del', { id: m.id }); n++; return false; } return true; });
    store.save();
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
        if (!arg || /^(reset|none|off)$/i.test(arg)) { u.color = ''; store.save(); return { ok: true, info: 'Name colour reset.' }; }
        if (!/^#[0-9a-f]{6}$/i.test(arg)) return { error: 'Use a hex colour, like /color #a855f7' };
        u.color = arg.toLowerCase(); store.save();
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
      case '/unpin': { const e = modOnly(); if (e) return e; unpin(); return { ok: true }; }
      case '/mute': case '/timeout': {
        const e = modOnly(); if (e) return e;
        const t = target(); if (!t) return noUser();
        if (isMod(t) && !isOwner(u)) return { error: 'Moderators can not be muted.' };
        const d = parseDur(rest[1], 6e5);
        db().mutes[lc(t.name)] = now() + d; store.save();
        notice(`${t.name} was muted for ${fmtDur(d)} by ${u.name}.`);
        return { ok: true };
      }
      case '/unmute': {
        const e = modOnly(); if (e) return e;
        delete db().mutes[lc(rest[0])]; store.save();
        notice((rest[0] || '?') + ' was unmuted.');
        return { ok: true };
      }
      case '/ban': {
        const e = modOnly(); if (e) return e;
        const t = target(); if (!t) return noUser();
        if (isOwner(t) || (isMod(t) && !isOwner(u))) return { error: 'You can not ban ' + t.name + '.' };
        db().bans[lc(t.name)] = { by: u.name, ts: now(), why: rest.slice(1).join(' ') };
        store.save(); purge(t.name);
        notice(`${t.name} was banned by ${u.name}.`);
        return { ok: true };
      }
      case '/unban': {
        const e = modOnly(); if (e) return e;
        delete db().bans[lc(rest[0])]; store.save();
        return { ok: true, info: (rest[0] || '?') + ' is unbanned.' };
      }
      case '/purge': {
        const e = modOnly(); if (e) return e;
        return { ok: true, info: `Removed ${purge(rest[0])} messages from ${rest[0] || '?'}.` };
      }
      case '/clear': {
        const e = modOnly(); if (e) return e;
        db().history = []; store.save();
        broadcast('clear', { by: u.name });
        return { ok: true };
      }
      case '/slow': {
        const e = modOnly(); if (e) return e;
        const s = /^(off|0)$/i.test(arg) ? 0 : Math.max(1, Math.min(300, parseInt(arg, 10) || 10));
        db().settings.slow = s; store.save();
        broadcast('settings', db().settings);
        notice(s ? `Slow mode is on: one message every ${s}s.` : 'Slow mode is off.');
        return { ok: true };
      }
      case '/mod': case '/unmod': {
        if (!isOwner(u)) return { error: 'Only the broadcaster can change moderators.' };
        const t = target(); if (!t) return noUser();
        t.roles = (t.roles || []).filter((r) => r !== 'mod');
        if (c === '/mod') t.roles.push('mod');
        store.save();
        notice(t.name + (c === '/mod' ? ' is now a moderator.' : ' is no longer a moderator.'));
        presence();
        return { ok: true };
      }
      case '/emote': {
        const e = modOnly(); if (e) return e;
        if (/^(remove|delete|rm)$/i.test(rest[0] || '')) {
          const n = rest[1];
          if (!db().emotes[n]) return { error: isEmote(db(), n) ? 'Built-in emotes stay.' : 'No emote called ' + n + '.' };
          delete db().emotes[n]; store.save();
          broadcast('emotes', emoteList(db()));
          return { ok: true, info: 'Removed ' + n + '.' };
        }
        return { error: 'Add emotes from chat settings. Remove with /emote remove Name' };
      }
      default: return { error: 'Unknown command ' + c + '. Type /help.' };
    }
  }

  /** Everything typed into the chat box ends up here. */
  function say(u, text, replyTo) {
    text = String(text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return { error: 'Say something first.' };
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
    const k = lc(u.name), t = now();
    if (db().bans[k]) return { error: 'You are banned from Ater chat.' };
    if (db().mutes[k] > t) return { error: 'You are muted for ' + fmtDur(db().mutes[k] - t) + ' more.' };
    if (text.startsWith('/') && !/^\/me\s/i.test(text)) return command(u, text);

    const r = recent.get(k) || {};
    recent.set(k, r);
    const slow = db().settings.slow;
    if (r.last && t - r.last < 450) return { error: 'Slow down a little.' };
    if (!isMod(u) && slow && r.last && t - r.last < slow * 1000) return { error: `Slow mode: wait ${Math.ceil((slow * 1000 - (t - r.last)) / 1000)}s.` };
    // a lone emote may repeat: that's how combos happen
    if (!isMod(u) && !isEmote(db(), text) && r.text === text && t - r.last < 20000) return { error: 'Duplicate message.' };

    let me = false;
    if (/^\/me\s/i.test(text)) { me = true; text = text.slice(4).trim(); if (!text) return { error: '/me what?' }; }
    let rp = null;
    if (replyTo) {
      const o = db().history.find((m) => m.id === replyTo);
      if (o) rp = { id: o.id, n: o.name, t: o.text.slice(0, 160) };
    }
    r.last = t; r.text = text;
    u.msgs = (u.msgs || 0) + 1;
    const d = dayUTC(t), s = u.streak || (u.streak = { last: '', n: 0 });
    if (s.last !== d) { s.n = s.last === dayUTC(t - 864e5) ? s.n + 1 : 1; s.last = d; }
    post({ id: newId(), ts: t, name: u.name, color: u.color || '', b: badges(u), text, me, rp });
    return { ok: true };
  }

  /** Open an SSE stream for a browser. */
  function attach(req, res, user) {
    const id = ++clientSeq;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const who = user ? lc(user.name) : null;
    clients.set(id, { res, u: who });
    send(res, 'hello', {
      me: pub(user), history: db().history.slice(-HELLO_HISTORY), pins: db().pins, poll: pollPub(who),
      emotes: emoteList(db()), presence: presenceData(), settings: db().settings,
    });
    presence();
    req.on('close', () => { clients.delete(id); presence(); });
  }

  function stop() {
    clearInterval(keepAlive); clearTimeout(pollTimer); clearTimeout(pollBatch); clearTimeout(presTimer);
    for (const c of clients.values()) try { c.res.end(); } catch {}
    clients.clear();
  }

  return {
    attach, say, vote, del, unpin, stop, notice, broadcast,
    pin: (id, by) => { const m = db().history.find((x) => x.id === id); if (!m) return false; pinAdd({ ...m }, by); return true; },
    startPoll: (by, p) => pollStart(by, p),
    get clientCount() { return clients.size; },
  };
}

module.exports = { createChat, parsePoll, parseDur };
