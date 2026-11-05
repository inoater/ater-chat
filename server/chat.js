'use strict';
/*
 * Ater chat: live clients over Server-Sent Events, rooms, messages,
 * presence, pins, polls, direct messages, reports, the moderator log and
 * commands. Who may do what comes from server/roles.js.
 *
 * Events sent to browsers:
 *   hello     { me, rooms, history, pins, poll, emotes, roles, presence, settings, featured }
 *   msg       a chat message (has .room)
 *   del       { id }        a message was deleted
 *   clear     { by, room }  a moderator cleared a room
 *   pins      [ ... ]       the pinned messages changed
 *   poll      poll | null   a poll started, got votes, ended or went away
 *   presence  { n, users }  who is here
 *   emotes    [ ... ]       the emote list changed
 *   roles     [ ... ]       roles or their looks changed
 *   rooms     [ ... ]       rooms were added, changed or removed
 *   settings  { slow }      chat settings changed
 *   notice    { ts, text }  system line (mutes, bans, slow mode…)
 *   dm        a direct message, only to the two people in it
 *   me        { me }        your own account changed (new role, picture…)
 *   modqueue  { reports }   people who handle reports: how many are open
 *   modlog    an entry      moderators: a moderator action just happened
 *   featured  { p, u, note, by, ts } | null   the Ater pick changed
 */
const crypto = require('crypto');
const { badges, pub, lc, dayUTC } = require('./accounts');
const { emoteList, isEmote } = require('./emotes');

const ROOM_HIST = 300;
const HELLO_HISTORY = 150;
const MAX_LEN = 500;
const DM_LEN = 1000;
const MAX_PINS = 3;
const MAX_ROOMS = 10;
const LINK_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|gg|tv|io|ly|me|xyz|ru|co|link|app|site|live)\b/i;
const PLATFORMS = { twitch: 'twitch', tw: 'twitch', kick: 'kick', kk: 'kick', youtube: 'youtube', yt: 'youtube', rumble: 'rumble', angelthump: 'angelthump' };
const HANDLE_RE = /^[A-Za-z0-9_.-]{2,40}$/;
const ROOM_ID = /^[a-z0-9-]{2,20}$/;

const now = () => Date.now();
const newId = () => now().toString(36) + crypto.randomBytes(3).toString('hex');
const fmtDur = (ms) => { const m = Math.ceil(ms / 6e4); return m >= 1440 ? Math.round(m / 1440) + 'd' : m >= 60 ? Math.round(m / 60) + 'h' : m + 'm'; };
function parseDur(s, fallback) {
  const m = String(s || '').match(/^(\d+)\s*(s|m|h|d)?$/i);
  return m ? +m[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[(m[2] || 'm').toLowerCase()] : fallback;
}
const dmKey = (a, b) => [lc(a), lc(b)].sort().join('|');

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
const clean = (text, max) => String(text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function createChat(store, state, accounts, roles) {
  const kv = state.kv;
  kv.pins ||= []; kv.bans ||= {}; kv.mutes ||= {}; kv.filters ||= []; kv.featured ||= null;
  kv.settings = { slow: 0, linkWait: 10, ...(kv.settings || {}) };
  if (!Array.isArray(kv.rooms) || !kv.rooms.length) kv.rooms = [{ id: 'live', name: 'Live chat', topic: '', post: 'everyone', view: 'everyone', builtin: true }];
  const clients = new Map(); // id -> { res, u }
  const recent = new Map();
  let clientSeq = 0;

  /* history per room */
  const rooms = new Map(kv.rooms.map((r) => [r.id, []]));
  for (const m of state.history) {
    const r = rooms.get(m.room || 'live');
    if (r) r.push(m);
  }
  for (const [id, list] of rooms) if (list.length > ROOM_HIST) rooms.set(id, list.slice(-ROOM_HIST));
  const roomOf = (id) => kv.rooms.find((r) => r.id === (id || 'live')) || null;
  function findMsg(id) { for (const list of rooms.values()) { const m = list.find((x) => x.id === id); if (m) return m; } return null; }

  const saveKV = (k) => store.saveKV(k, kv[k]);
  const userOf = (k) => k && state.users.get(k);
  const can = (u, p) => roles.can(u, p);
  const isMod = (u) => roles.isMod(u);

  /* ---------- sending ---------- */
  const send = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* gone */ } };
  const broadcast = (ev, data, only) => { for (const c of clients.values()) if (!only || only(c)) send(c.res, ev, data); };
  const toMods = (ev, data) => broadcast(ev, data, (c) => isMod(userOf(c.u)));
  const notice = (text) => broadcast('notice', { ts: now(), text });
  const toUser = (name, ev, data) => broadcast(ev, data, (c) => c.u === lc(name));
  const canView = (c, room) => room && (room.view !== 'signedin' || Boolean(c.u));
  function canPost(u, room) {
    if (!room) return false;
    if (isMod(u) || room.post === 'everyone') return true;
    if (room.post === 'staff') return roles.staff(u);
    if (room.post.startsWith('role:')) return (u.roles || []).includes(room.post.slice(5));
    return false; // 'mods'
  }
  /** Tell a person's open windows that their account changed (role, picture…). */
  function refreshMe(u) { toUser(u.name, 'me', { me: { ...pub(u), perms: roles.permsOf(u) } }); presence(); }

  /* ---------- moderator log + reports ---------- */
  function audit(by, act, target = '', detail = '') {
    const e = { ts: now(), by, act, target, detail: String(detail).slice(0, 300) };
    store.addAudit(e);
    toMods('modlog', e);
  }
  let openReports = 0;
  store.listReports(true).then((r) => { openReports = r.length; }).catch(() => {});
  const queue = () => broadcast('modqueue', { reports: openReports }, (c) => can(userOf(c.u), 'reports'));

  async function report(u, msgId, reason) {
    const m = findMsg(msgId);
    if (!m) return { error: 'That message is gone.' };
    if (lc(m.name) === lc(u.name)) return { error: 'You can’t report yourself.' };
    if (await store.findReport(msgId, u.name)) return { ok: true, info: 'You already reported that. Thanks.' };
    const r = { id: newId(), ts: now(), by: u.name, reason: String(reason || '').slice(0, 200), msg: { id: m.id, name: m.name, text: m.text, ts: m.ts, room: m.room || 'live' }, done: false };
    await store.addReport(r);
    openReports++;
    queue();
    return { ok: true, info: 'Reported. The moderators will take a look.' };
  }
  async function resolveReport(mod, id, action) {
    if (!can(mod, 'reports')) return { error: 'You can’t handle reports.', status: 403 };
    const list = await store.listReports(true);
    const r = list.find((x) => x.id === id);
    if (!r) return { error: 'That report is already handled.' };
    let res = { ok: true };
    if (action === 'delete') { if (!can(mod, 'delete')) return { error: 'Your role can’t delete messages.' }; del(r.msg.id); }
    else if (action === 'mute') res = command(mod, `/mute ${r.msg.name} 10m`);
    else if (action === 'ban') res = command(mod, `/ban ${r.msg.name} reported: ${r.reason || 'no reason'}`);
    if (res.error) return res;
    await store.updateReports({ msgId: r.msg.id }, { done: true, by_mod: mod.name, action, doneAt: now() });
    const closed = list.filter((x) => x.msg.id === r.msg.id).length;
    openReports = Math.max(0, openReports - closed);
    if (action === 'dismiss' || action === 'delete') audit(mod.name, 'report:' + action, r.msg.name, r.msg.text);
    queue();
    return { ok: true };
  }

  /* ---------- presence ---------- */
  let presTimer = null;
  function presenceData() {
    const seen = new Map();
    for (const c of clients.values()) { const u = userOf(c.u); if (u && !seen.has(c.u)) seen.set(c.u, pub(u)); }
    const rank = (u) => (u.owner ? 0 : u.mod ? 1 : u.staff ? 2 : 3);
    return { n: clients.size, users: [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)) };
  }
  function presence() { if (presTimer) return; presTimer = setTimeout(() => { presTimer = null; broadcast('presence', presenceData()); }, 1200); }
  const keepAlive = setInterval(() => { for (const c of clients.values()) try { c.res.write(': ping\n\n'); } catch {} }, 25000);
  keepAlive.unref();

  /* ---------- polls (live in memory; finished ones go to history) ---------- */
  let poll = null, pollTimer = null, pollBatch = null;
  const pollPub = (who) => poll && {
    id: poll.id, q: poll.q, opts: poll.opts.map((o) => ({ t: o.t, n: o.n })), ends: poll.ends, by: poll.by, done: poll.done,
    total: poll.opts.reduce((a, o) => a + o.n, 0), mine: who && poll.voters[who] != null ? poll.voters[who] : null,
  };
  const pollCast = () => { for (const c of clients.values()) send(c.res, 'poll', pollPub(c.u)); };
  function pollStart(by, { q, opts, secs }) {
    if (poll && !poll.done) pollEnd();
    clearTimeout(pollTimer);
    poll = { id: crypto.randomBytes(4).toString('hex'), q, opts: opts.map((t) => ({ t, n: 0 })), started: now(), ends: now() + secs * 1000, by, done: false, voters: {} };
    pollCast();
    pollTimer = setTimeout(pollEnd, secs * 1000);
    audit(by, 'poll', '', q);
  }
  function pollEnd() {
    if (!poll || poll.done) return;
    poll.done = true; poll.ends = now(); pollCast();
    const total = poll.opts.reduce((a, o) => a + o.n, 0);
    store.addPoll({ id: poll.id, q: poll.q, opts: poll.opts.map((o) => ({ t: o.t, n: o.n })), by: poll.by, started: poll.started, ended: poll.ends, total });
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
    const list = rooms.get(msg.room);
    list.push(msg);
    if (list.length > ROOM_HIST) list.splice(0, list.length - ROOM_HIST);
    store.addMessage(msg);
    const room = roomOf(msg.room);
    broadcast('msg', msg, (c) => canView(c, room));
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
    let m = null;
    for (const list of rooms.values()) { const i = list.findIndex((x) => x.id === id); if (i >= 0) { m = list.splice(i, 1)[0]; break; } }
    store.deleteMessage(id);
    broadcast('del', { id });
    if (kv.pins.some((x) => x.id === id)) unpin(id);
    if (by) audit(by, 'delete', m ? m.name : '', m ? m.text : id);
    return Boolean(m);
  }
  /** Delete a message as `u`: needs the delete power, and to outrank the author (or be them). */
  function delAs(u, id) {
    if (!can(u, 'delete')) return { error: 'Your role can’t delete messages.', status: 403 };
    const m = findMsg(id);
    if (!m) return { error: 'That message is gone.', status: 404 };
    const author = accounts.find(m.name);
    if (author && author !== u && !roles.outranks(u, author)) return { error: 'You can’t delete ' + m.name + '’s messages.', status: 403 };
    del(id, u.name);
    return { ok: true };
  }
  function purge(name) {
    const k = lc(name);
    let n = 0;
    for (const list of rooms.values()) for (let i = list.length - 1; i >= 0; i--) if (lc(list[i].name) === k) { broadcast('del', { id: list[i].id }); list.splice(i, 1); n++; }
    store.deleteMessagesBy(name);
    return n;
  }
  function feature(by, p, u, note) {
    const plat = PLATFORMS[String(p || '').toLowerCase()];
    u = String(u || '').trim().replace(/^[@#]/, '');
    if (!plat) return { error: 'Pick twitch, kick, youtube, rumble or angelthump.' };
    if (!HANDLE_RE.test(u)) return { error: 'That doesn’t look like a channel name.' };
    kv.featured = { p: plat, u: plat === 'youtube' ? u : u.toLowerCase(), note: String(note || '').slice(0, 120), by, ts: now() };
    saveKV('featured');
    broadcast('featured', kv.featured);
    audit(by, 'feature', u, plat + (note ? ' · ' + note : ''));
    return { ok: true, info: `${u} on ${plat} is the Ater pick now.` };
  }
  function unfeature(by) {
    if (!kv.featured) return { error: 'Nothing is featured.' };
    const was = kv.featured;
    kv.featured = null; saveKV('featured');
    broadcast('featured', null);
    audit(by, 'unfeature', was.u, was.p);
    return { ok: true, info: 'The Ater pick is cleared.' };
  }
  /** Time someone out: needs the timeout power, a duration within your role's limit, and to outrank them. */
  function timeout(u, t, ms) {
    if (!can(u, 'timeout')) return { error: 'Your role can’t time people out.' };
    if (!t) return { error: 'No Ater account by that name.' };
    if (!roles.outranks(u, t)) return { error: 'You can’t time out ' + t.name + '.' };
    const cap = roles.timeoutMax(u);
    if (ms > cap) return { error: `Your role can time people out for up to ${fmtDur(cap)}.` };
    kv.mutes[lc(t.name)] = now() + ms; saveKV('mutes');
    notice(`${t.name} was timed out for ${fmtDur(ms)} by ${u.name}.`);
    audit(u.name, 'mute', t.name, fmtDur(ms));
    return { ok: true };
  }
  function ban(u, t, why) {
    if (!isMod(u)) return { error: 'Only moderators can ban.' };
    if (!t) return { error: 'No Ater account by that name.' };
    if (!roles.outranks(u, t)) return { error: 'You can not ban ' + t.name + '.' };
    kv.bans[lc(t.name)] = { name: t.name, by: u.name, ts: now(), why: String(why || '').slice(0, 200) };
    saveKV('bans'); purge(t.name);
    notice(`${t.name} was banned by ${u.name}.`);
    audit(u.name, 'ban', t.name, why);
    return { ok: true };
  }
  function unban(u, name) {
    if (!isMod(u)) return { error: 'Only moderators can unban.' };
    if (!kv.bans[lc(name)]) return { error: (name || 'That name') + ' isn’t banned.' };
    delete kv.bans[lc(name)]; saveKV('bans');
    audit(u.name, 'unban', name);
    return { ok: true, info: name + ' is unbanned.' };
  }
  function unmute(u, name) {
    if (!can(u, 'timeout')) return { error: 'Your role can’t lift timeouts.' };
    if (!(kv.mutes[lc(name)] > now())) return { error: (name || 'They') + ' isn’t timed out.' };
    delete kv.mutes[lc(name)]; saveKV('mutes');
    notice((name || '?') + '’s timeout was lifted.');
    audit(u.name, 'unmute', name || '');
    return { ok: true };
  }
  /** Give or take a role; the target's chat updates straight away. */
  function setRole(u, t, roleId, on) {
    if (!t) return { error: 'No Ater account by that name.', status: 404 };
    const r = roles.assign(u, t, roleId, on);
    if (r.error) return r;
    accounts.save(t);
    audit(u.name, on ? 'role:give' : 'role:take', t.name, r.role.name);
    if (roleId === 'mod') notice(t.name + (on ? ' is now a moderator.' : ' is no longer a moderator.'));
    refreshMe(t);
    if (can(t, 'reports')) toUser(t.name, 'modqueue', { reports: openReports });
    return { ok: true };
  }
  const rolesChanged = () => { broadcast('roles', roles.publicList()); for (const c of clients.values()) { const u = userOf(c.u); if (u) send(c.res, 'me', { me: { ...pub(u), perms: roles.permsOf(u) } }); } presence(); };

  /* ---------- rooms ---------- */
  function saveRoom(u, input) {
    if (!isMod(u)) return { error: 'Only moderators can change rooms.', status: 403 };
    const name = clean(input.name, 24);
    if (!name) return { error: 'Rooms need a name.', status: 400 };
    const post = ['everyone', 'staff', 'mods'].includes(input.post) || /^role:r[0-9a-f]{8}$/.test(input.post || '') ? input.post : 'everyone';
    const view = input.view === 'signedin' ? 'signedin' : 'everyone';
    let r = input.id ? roomOf(input.id) : null;
    if (input.id && !r) return { error: 'That room is gone.', status: 404 };
    if (!r) {
      if (kv.rooms.length >= MAX_ROOMS) return { error: 'Ten rooms is the limit.', status: 400 };
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
      if (!ROOM_ID.test(id) || roomOf(id)) id = 'room-' + crypto.randomBytes(2).toString('hex');
      r = { id, builtin: false };
      kv.rooms.push(r);
      rooms.set(id, []);
    }
    r.name = name; r.topic = clean(input.topic, 120); r.post = r.builtin ? 'everyone' : post; r.view = r.builtin ? 'everyone' : view;
    saveKV('rooms');
    broadcast('rooms', kv.rooms);
    audit(u.name, 'room', r.name, `${r.view === 'signedin' ? 'signed-in' : 'everyone'} can read, ${r.post} can post`);
    return { ok: true, room: r };
  }
  function removeRoom(u, id) {
    if (!isMod(u)) return { error: 'Only moderators can change rooms.', status: 403 };
    const r = roomOf(id);
    if (!r || r.builtin) return { error: r ? 'The live chat room stays.' : 'That room is gone.', status: 400 };
    kv.rooms = kv.rooms.filter((x) => x !== r);
    rooms.delete(id);
    saveKV('rooms');
    broadcast('rooms', kv.rooms);
    audit(u.name, 'room:remove', r.name);
    return { ok: true };
  }

  /* ---------- direct messages ---------- */
  const isOnline = (k) => [...clients.values()].some((c) => c.u === k);
  async function dm(u, toName, text) {
    const t = accounts.find(toName);
    text = clean(text, DM_LEN);
    if (!t) return { error: 'No Ater account called ' + (toName || 'that') + '.', status: 404 };
    if (t === u) return { error: 'That’s you.', status: 400 };
    if (!text) return { error: 'Write something first.', status: 400 };
    if (kv.bans[lc(u.name)]) return { error: 'You are banned from Ater chat.', status: 403 };
    if ((u.blocks || []).includes(lc(t.name))) return { error: 'You blocked ' + t.name + '. Unblock them to send messages.', status: 403 };
    const staff = roles.staff(u);
    if (!staff) {
      if ((t.blocks || []).includes(lc(u.name)) || t.dmFrom === 'nobody') return { error: t.name + ' isn’t taking messages.', status: 403 };
      if (t.dmFrom === 'staff') return { error: t.name + ' only takes messages from the mod team.', status: 403 };
      if (filterHit(text, kv.filters)) return { error: 'That message has a blocked word in it.', status: 400 };
    }
    const r = recent.get('dm:' + lc(u.name)) || {};
    if (r.last && now() - r.last < 400) return { error: 'Slow down a little.', status: 429 };
    r.last = now(); recent.set('dm:' + lc(u.name), r);
    const m = { id: newId(), k: dmKey(u.name, t.name), from: u.name, to: t.name, text, ts: now() };
    await store.addDM(m);
    broadcast('dm', m, (c) => c.u === lc(u.name) || c.u === lc(t.name));
    return { ok: true, dm: m, online: isOnline(lc(t.name)) };
  }
  async function dmList(u) {
    const me = lc(u.name), out = [];
    for (const c of await store.dmConvs(me)) {
      if ((u.dmHide || {})[c.k] >= c.last.ts) continue;
      const other = accounts.find(c.a === me ? c.b : c.a);
      if (!other) continue;
      out.push({ with: pub(other), last: c.last, unread: await store.dmUnread(c.k, u.name, Math.max((u.dmRead || {})[c.k] || 0, (u.dmHide || {})[c.k] || 0)), online: isOnline(lc(other.name)) });
    }
    return out;
  }
  async function dmThread(u, withName, before) {
    const t = accounts.find(withName);
    if (!t) return { error: 'No such account.', status: 404 };
    const k = dmKey(u.name, t.name);
    const hide = (u.dmHide || {})[k] || 0;
    const list = (await store.dmThread(k, Number(before) || Infinity, 60)).filter((m) => m.ts > hide);
    return { with: pub(t), messages: list, blocked: (u.blocks || []).includes(lc(t.name)), canSend: true };
  }
  function dmMark(u, withName, what) {
    const t = accounts.find(withName);
    if (!t) return { error: 'No such account.', status: 404 };
    const k = dmKey(u.name, t.name), field = what === 'hide' ? 'dmHide' : 'dmRead';
    u[field] = { ...(u[field] || {}), [k]: now() };
    accounts.save(u);
    return { ok: true };
  }

  /* ---------- commands ---------- */
  function command(u, text, roomId = 'live') {
    const [c0, ...rest] = text.trim().split(/\s+/);
    const c = c0.toLowerCase(), arg = rest.join(' ');
    const need = (perm, what) => (can(u, perm) ? null : { error: 'Your role can’t ' + what + '.' });
    const modOnly = () => (isMod(u) ? null : { error: 'Only moderators can use ' + c + '.' });
    const target = () => accounts.find(rest[0]);
    const noUser = () => ({ error: 'No Ater account called ' + (rest[0] || 'that') + '.' });

    switch (c) {
      case '/w': case '/whisper': case '/msg': case '/tell': case '/dm':
        return { error: 'Use the Messages tab, or send it there: ' + c + ' now opens a DM.', dm: rest[0] || '' };
      case '/color': case '/colour': {
        if (!arg || /^(reset|none|off)$/i.test(arg)) { u.color = ''; accounts.save(u); refreshMe(u); return { ok: true, info: 'Name colour reset.' }; }
        if (!/^#[0-9a-f]{6}$/i.test(arg)) return { error: 'Use a hex colour, like /color #a855f7' };
        u.color = arg.toLowerCase(); accounts.save(u); refreshMe(u);
        return { ok: true, info: 'Name colour set to ' + u.color + '.' };
      }
      case '/vote': return vote(u, (Number(arg) || 0) - 1);
      case '/poll': { const e = need('polls', 'run polls'); if (e) return e; const p = parsePoll(arg); if (p.error) return p; pollStart(u.name, p); return { ok: true }; }
      case '/endpoll': { const e = need('polls', 'run polls'); if (e) return e; if (!poll || poll.done) return { error: 'No poll running.' }; pollEnd(); return { ok: true }; }
      case '/pin': {
        const e = need('pin', 'pin messages'); if (e) return e;
        if (!arg) return { error: 'Usage: /pin text, or hover a message and press the pin.' };
        pinAdd({ id: newId(), ts: now(), name: u.name, color: u.color || '', b: badges(u), r: roles.displayRole(u), text: arg.slice(0, MAX_LEN) }, u.name);
        return { ok: true };
      }
      case '/unpin': { const e = need('pin', 'pin messages'); if (e) return e; unpin('', u.name); return { ok: true }; }
      case '/mute': case '/timeout': return timeout(u, target(), parseDur(rest[1], Math.min(6e5, roles.timeoutMax(u) || 6e5)));
      case '/unmute': case '/untimeout': return unmute(u, rest[0]);
      case '/ban': return ban(u, target(), rest.slice(1).join(' '));
      case '/unban': return unban(u, rest[0]);
      case '/bans': {
        const e = modOnly(); if (e) return e;
        const list = Object.values(kv.bans);
        return { ok: true, info: list.length ? 'Banned: ' + list.map((b) => b.name || '?').join(', ') : 'Nobody is banned.' };
      }
      case '/purge': {
        const e = modOnly(); if (e) return e;
        const t = target(); if (t && !roles.outranks(u, t)) return { error: 'You can’t purge ' + t.name + '.' };
        const n = purge(rest[0] || '');
        audit(u.name, 'purge', rest[0] || '', n + ' messages');
        return { ok: true, info: `Removed ${n} messages from ${rest[0] || '?'}.` };
      }
      case '/clear': {
        const e = modOnly(); if (e) return e;
        const list = rooms.get(roomId); if (list) list.length = 0;
        store.clearMessages(roomId);
        broadcast('clear', { by: u.name, room: roomId });
        audit(u.name, 'clear', '', roomId);
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
        const e = need('words', 'edit blocked words'); if (e) return e;
        const op = (rest[0] || 'list').toLowerCase();
        const words = rest.slice(1).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
        if (op === 'list') return { ok: true, info: kv.filters.length ? 'Blocked words: ' + kv.filters.join(', ') : 'No blocked words.', words: kv.filters };
        if (!words.length) return { error: 'Usage: /filter add word … | /filter remove word … | /filter list' };
        if (op === 'add') kv.filters = [...new Set([...kv.filters, ...words])].slice(0, 500);
        else if (op === 'remove') kv.filters = kv.filters.filter((w) => !words.includes(w));
        else return { error: 'Usage: /filter add word … | /filter remove word … | /filter list' };
        saveKV('filters');
        audit(u.name, 'filter:' + op, '', words.join(', '));
        return { ok: true, info: `${op === 'add' ? 'Blocked' : 'Unblocked'}: ${words.join(', ')}.`, words: kv.filters };
      }
      case '/feature': {
        const e = need('feature', 'set the Ater pick'); if (e) return e;
        if (!rest.length) return { error: 'Usage: /feature [twitch|kick|youtube] name [note]' };
        const hasPlat = PLATFORMS[rest[0].toLowerCase()] && rest[1];
        return hasPlat ? feature(u.name, rest[0], rest[1], rest.slice(2).join(' ')) : feature(u.name, 'twitch', rest[0], rest.slice(1).join(' '));
      }
      case '/unfeature': { const e = need('feature', 'set the Ater pick'); if (e) return e; return unfeature(u.name); }
      case '/mod': case '/unmod': return setRole(u, target(), 'mod', c === '/mod');
      case '/role': {
        const op = (rest[0] || '').toLowerCase(), t = accounts.find(rest[1]), rn = rest.slice(2).join(' ').toLowerCase();
        const r = roles.list().find((x) => x.name.toLowerCase() === rn || x.id === rn);
        if (!['give', 'take'].includes(op) || !r) return { error: 'Usage: /role give|take name Role Name' };
        return setRole(u, t, r.id, op === 'give');
      }
      case '/emote': {
        const e = need('emotes', 'change emotes'); if (e) return e;
        if (/^(remove|delete|rm)$/i.test(rest[0] || '')) return removeEmote(u, rest[1]);
        return { error: 'Add emotes from the mod dashboard. Remove with /emote remove Name' };
      }
      default: return { error: 'Unknown command ' + c + '. Type /help.' };
    }
  }
  function removeEmote(u, n) {
    if (!can(u, 'emotes')) return { error: 'Your role can’t change emotes.', status: 403 };
    if (!state.emotes[n]) return { error: isEmote(state, n) ? 'Built-in emotes stay.' : 'No emote called ' + n + '.' };
    delete state.emotes[n]; store.deleteEmote(n);
    broadcast('emotes', emoteList(state));
    audit(u.name, 'emote:remove', '', n);
    return { ok: true, info: 'Removed ' + n + '.' };
  }

  /** Everything typed into the chat box ends up here. */
  function say(u, text, replyTo, roomId) {
    text = clean(text, MAX_LEN);
    if (!text) return { error: 'Say something first.' };
    const room = roomOf(roomId);
    if (!room) return { error: 'That room is gone.' };
    const k = lc(u.name), t = now(), mod = isMod(u);
    if (kv.bans[k]) return { error: 'You are banned from Ater chat.' };
    if (kv.mutes[k] > t) return { error: 'You are timed out for ' + fmtDur(kv.mutes[k] - t) + ' more.' };
    if (text.startsWith('/') && !/^\/me\s/i.test(text)) return command(u, text, room.id);
    if (!canPost(u, room)) return { error: 'Only ' + (room.post === 'mods' ? 'moderators' : room.post === 'staff' ? 'the mod team' : (roles.get(room.post.slice(5)) || { name: 'some roles' }).name + 's') + ' can post in ' + room.name + '.' };

    const r = recent.get(k) || {};
    recent.set(k, r);
    const slow = kv.settings.slow;
    if (r.last && t - r.last < 450) return { error: 'Slow down a little.' };
    if (!can(u, 'slow') && slow && r.last && t - r.last < slow * 1000) return { error: `Slow mode: wait ${Math.ceil((slow * 1000 - (t - r.last)) / 1000)}s.` };
    if (!mod && !isEmote(state, text) && r.text === text && t - r.last < 20000) return { error: 'Duplicate message.' };
    if (!mod && filterHit(text, kv.filters)) return { error: 'That message has a blocked word in it.' };
    const wait = (kv.settings.linkWait ?? 10) * 60_000;
    if (!can(u, 'links') && t - (u.created || 0) < wait && LINK_RE.test(text)) {
      return { error: `New accounts can post links after ${Math.ceil((wait - (t - u.created)) / 60000)} more minute(s). It keeps spam bots out.` };
    }
    let me = false;
    if (/^\/me\s/i.test(text)) { me = true; text = text.slice(4).trim(); if (!text) return { error: '/me what?' }; }
    let rp = null;
    if (replyTo) { const o = findMsg(replyTo); if (o) rp = { id: o.id, n: o.name, t: o.text.slice(0, 160) }; }
    r.last = t; r.text = text;
    u.msgs = (u.msgs || 0) + 1;
    const d = dayUTC(t), s = u.streak || (u.streak = { last: '', n: 0 });
    if (s.last !== d) { s.n = s.last === dayUTC(t - 864e5) ? s.n + 1 : 1; s.last = d; }
    accounts.save(u);
    post({ id: newId(), ts: t, name: u.name, color: u.color || '', b: badges(u), r: roles.displayRole(u), text, me, rp, room: room.id });
    return { ok: true };
  }

  function attach(req, res, user) {
    const id = ++clientSeq;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const who = user ? lc(user.name) : null;
    const c = { res, u: who };
    clients.set(id, c);
    const visible = kv.rooms.filter((r) => canView(c, r));
    const history = visible.flatMap((r) => (rooms.get(r.id) || []).slice(-HELLO_HISTORY)).sort((a, b) => a.ts - b.ts);
    send(res, 'hello', {
      me: user ? { ...pub(user), perms: roles.permsOf(user) } : null, rooms: visible, history, pins: kv.pins, poll: pollPub(who),
      emotes: emoteList(state), roles: roles.publicList(), presence: presenceData(), settings: kv.settings, featured: kv.featured,
    });
    if (can(user, 'reports')) send(res, 'modqueue', { reports: openReports });
    presence();
    req.on('close', () => { clients.delete(id); presence(); });
  }

  function kick(name) { for (const [id, c] of clients) if (c.u === lc(name)) { try { c.res.end(); } catch {} clients.delete(id); } presence(); }
  function stop() {
    clearInterval(keepAlive); clearTimeout(pollTimer); clearTimeout(pollBatch); clearTimeout(presTimer);
    for (const c of clients.values()) try { c.res.end(); } catch {}
    clients.clear();
  }
  /** Numbers for the mod dashboard. */
  function stats() {
    const t = now();
    return {
      online: clients.size, signedIn: presenceData().users.length, accounts: state.users.size,
      reports: openReports, bans: Object.keys(kv.bans).length, timeouts: Object.values(kv.mutes).filter((x) => x > t).length,
      rooms: kv.rooms.length, roles: roles.list().length, emotes: Object.keys(state.emotes).length, poll: pollPub(null),
    };
  }

  return {
    attach, say, vote, del, delAs, unpin, stop, notice, broadcast, report, resolveReport, purge, kick, audit,
    pin: (id, by) => { const m = findMsg(id); if (!m) return false; pinAdd({ ...m }, by); return true; },
    startPoll: (by, p) => pollStart(by, p), endPoll: () => { if (poll && !poll.done) { pollEnd(); return true; } return false; },
    addEmote(by, name, e) { state.emotes[name] = e; store.saveEmote(name, e); broadcast('emotes', emoteList(state)); notice(`${by} added the emote ${name}.`); audit(by, 'emote:add', '', name); },
    removeEmote, feature, unfeature, timeout, ban, unban, unmute, setRole, rolesChanged, refreshMe, saveRoom, removeRoom,
    dm, dmList, dmThread, dmMark, stats, command,
    bans: () => Object.values(kv.bans), mutes: () => Object.entries(kv.mutes).filter(([, v]) => v > now()).map(([k, until]) => ({ name: (accounts.find(k) || { name: k }).name, until })),
    settings: () => kv.settings,
    setSettings(u, s) {
      if (!isMod(u)) return { error: 'Only moderators can change chat settings.', status: 403 };
      if (s.slow !== undefined) kv.settings.slow = Math.max(0, Math.min(300, parseInt(s.slow, 10) || 0));
      if (s.linkWait !== undefined) kv.settings.linkWait = Math.max(0, Math.min(1440, parseInt(s.linkWait, 10) || 0));
      saveKV('settings'); broadcast('settings', kv.settings);
      audit(u.name, 'settings', '', `slow ${kv.settings.slow}s, link wait ${kv.settings.linkWait}m`);
      return { ok: true, settings: kv.settings };
    },
    get clientCount() { return clients.size; },
  };
}

module.exports = { createChat, parsePoll, parseDur, filterHit, dmKey };
