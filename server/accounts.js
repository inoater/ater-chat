'use strict';
/*
 * Ater accounts.
 *
 * - Passwords: scrypt with a per-account salt. Common passwords and ones
 *   containing the account name are refused.
 * - Sessions: a random token in an HttpOnly cookie. Only its SHA-256 is
 *   stored, so a database leak doesn't hand out logins.
 * - Recovery codes: 8 one-time codes shown once at sign-up (and when
 *   regenerated). They reset a forgotten password without email. Stored hashed.
 * - Lockout: 5 wrong passwords lock that account's sign-in for 15 minutes.
 * - Deleted names are held for 30 days so nobody can pick one up right away
 *   and pose as that person.
 */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const COOKIE = 'ater_s';
const SESSION_DAYS = 90;
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED = new Set(['system', 'ater', 'aterbot', 'admin', 'administrator', 'moderator', 'mod', 'mods', 'everyone', 'here', 'support', 'staff', 'root', 'null', 'undefined']);
const OG_LIMIT = 100;
const LOCK_AFTER = 5, LOCK_MS = 15 * 60_000;
const RETIRE_MS = 30 * 864e5;
const CODES = 8;
const COMMON = new Set(('password password1 password12 password123 passw0rd 12345678 123456789 1234567890 11111111 00000000 ' +
  'qwertyuiop qwerty123 qwerty12 1q2w3e4r 1q2w3e4r5t iloveyou sunshine princess football baseball welcome1 ' +
  'welcome123 letmein1 trustno1 dragon123 monkey123 abc12345 abcd1234 superman batman123 starwars ' +
  'aaaaaaaa asdfghjkl zxcvbnm1 changeme internet computer whatever 87654321 12341234 11223344 ' +
  'twitch123 kickstream streamer1 ateriscool').split(/\s+/));

const lc = (s) => String(s || '').toLowerCase().replace(/^@/, '');
const now = () => Date.now();
const dayUTC = (t = now()) => new Date(t).toISOString().slice(0, 10);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = async (pw, salt) => (await scrypt(pw, salt, 64)).toString('hex');

const isOwner = (u) => Boolean(u && (u.roles || []).includes('owner'));
const isMod = (u) => Boolean(u && ((u.roles || []).includes('mod') || isOwner(u)));

function badges(u) {
  const b = [];
  if (isOwner(u)) b.push('owner');
  else if (isMod(u)) b.push('mod');
  if (u.og) b.push('og');
  if (u.streak && u.streak.n >= 3 && u.streak.last >= dayUTC(now() - 864e5)) b.push('streak:' + u.streak.n);
  return b;
}
const pub = (u) => (u ? { name: u.name, color: u.color || '', b: badges(u), mod: isMod(u), owner: isOwner(u), created: u.created } : null);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bad cookie */ } }
  }
  return out;
}

/** "Chrome on Windows" from a User-Agent, for the devices list. */
function device(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /OBS/.test(ua) ? 'OBS' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} on ${o}` : b;
}

function passwordProblem(pw, name) {
  if (pw.length < 8) return 'Use at least 8 characters for the password.';
  if (pw.length > 200) return 'That password is too long.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Pick something less guessable.';
  if (name && pw.toLowerCase().includes(lc(name))) return 'Don’t put your name in your password.';
  if (/^(.)\1+$/.test(pw)) return 'That password is too easy to guess.';
  return null;
}

/** 8 codes like "k7m2-9xqa", returned in the clear once and stored hashed. */
function makeCodes() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const one = () => { const b = crypto.randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += abc[b[i] % abc.length]; return s.slice(0, 4) + '-' + s.slice(4); };
  const codes = Array.from({ length: CODES }, one);
  return { codes, stored: codes.map((c) => ({ h: sha256(c), used: false })) };
}
const normCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

function createAccounts(store, state, { owner = '', secureCookies = 'auto' } = {}) {
  owner = lc(owner);
  const users = state.users;              // Map lowercase name -> account
  const retired = (state.kv.retired ||= {});
  const fails = new Map();                // lowercase name -> { n, until }
  const cache = new Map();                // session hash -> { s, at }
  const CACHE_MS = 60_000;

  const saveUser = (u) => store.saveUser(u);
  const find = (n) => users.get(lc(n)) || null;

  function cookieFlags(req) {
    const secure = secureCookies === true || (secureCookies === 'auto' && (req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted));
    return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  async function sessionOf(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return null;
    const id = sha256(token);
    const hit = cache.get(id);
    let s = hit && now() - hit.at < CACHE_MS ? hit.s : null;
    if (!s) {
      s = await store.getSession(id);
      if (!s) { cache.delete(id); return null; }
      cache.set(id, { s, at: now() });
      if (cache.size > 5000) cache.delete(cache.keys().next().value);
    }
    if (s.exp < now()) return null;
    const user = users.get(s.u);
    if (!user) return null;
    if (now() - s.lastSeen > 10 * 60_000) { s.lastSeen = now(); store.touchSession(id, { lastSeen: s.lastSeen }); }
    return { user, sid: id, session: s };
  }

  async function startSession(req, res, u) {
    const token = crypto.randomBytes(32).toString('base64url');
    const s = { _id: sha256(token), u: lc(u.name), exp: now() + SESSION_DAYS * 864e5, created: now(), lastSeen: now(), device: device(req.headers['user-agent']) };
    await store.createSession(s);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_DAYS * 86400}`);
    return s._id;
  }

  async function endSession(req, res) {
    const s = await sessionOf(req);
    if (s) { cache.delete(s.sid); await store.deleteSession(s.sid); }
    res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieFlags(req)}; Max-Age=0`);
  }

  async function dropSessions(u, keepSid) {
    for (const [id, h] of cache) if (h.s.u === lc(u.name) && id !== keepSid) cache.delete(id);
    await store.deleteSessions(lc(u.name), keepSid);
  }

  function nameProblem(name) {
    if (!NAME_RE.test(name)) return 'Names are 3 to 20 letters, numbers or _.';
    if (RESERVED.has(lc(name))) return 'That name is reserved.';
    if (users.has(lc(name))) return 'That name is taken.';
    if (retired[lc(name)] > now()) return 'That name was used recently. Try another.';
    return null;
  }

  async function register(name, password) {
    name = String(name || '').trim();
    password = String(password || '');
    const np = nameProblem(name);
    if (np) return { error: np, status: np.includes('taken') || np.includes('recently') ? 409 : 400 };
    const pp = passwordProblem(password, name);
    if (pp) return { error: pp, status: 400 };
    const count = users.size;
    const salt = crypto.randomBytes(16).toString('hex');
    const rc = makeCodes();
    const u = {
      name, salt, hash: await hashPw(password, salt),
      roles: (owner ? lc(name) === owner : count === 0) ? ['owner'] : [],
      color: '', created: now(), og: count < OG_LIMIT, msgs: 0, streak: { last: '', n: 0 },
      rc: rc.stored, pwAt: now(),
    };
    if (users.has(lc(name))) return { error: 'That name is taken.', status: 409 }; // lost a race
    users.set(lc(name), u);
    await saveUser(u);
    return { user: u, codes: rc.codes };
  }

  async function checkPassword(u, pw) {
    const a = Buffer.from(await hashPw(String(pw || ''), u.salt), 'hex');
    return crypto.timingSafeEqual(a, Buffer.from(u.hash, 'hex'));
  }

  function locked(k) {
    const f = fails.get(k);
    return f && f.until > now() ? Math.ceil((f.until - now()) / 60000) : 0;
  }
  function failed(k) {
    const f = fails.get(k) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= LOCK_AFTER) { f.until = now() + LOCK_MS; f.n = 0; }
    fails.set(k, f);
  }

  async function login(name, password) {
    const k = lc(name), u = users.get(k);
    const mins = locked(k);
    if (mins) return { error: `Too many wrong passwords. Try again in ${mins} minute${mins > 1 ? 's' : ''}, or use a recovery code.`, status: 429 };
    if (!u || !(await checkPassword(u, password))) {
      if (!u) await hashPw(String(password || ''), 'x'.repeat(32)); // same timing whether or not the name exists
      failed(k);
      return { error: 'Wrong name or password.', status: 401 };
    }
    fails.delete(k);
    if (owner && k === owner && !isOwner(u)) { u.roles = [...(u.roles || []), 'owner']; await saveUser(u); }
    return { user: u };
  }

  async function recover(name, code, newPassword) {
    const k = lc(name), u = users.get(k);
    const mins = locked(k);
    if (mins) return { error: `Too many tries. Wait ${mins} minute${mins > 1 ? 's' : ''}.`, status: 429 };
    const h = sha256(normCode(code));
    const slot = u && (u.rc || []).find((c) => !c.used && c.h === h);
    if (!slot) { failed(k); return { error: 'That name and recovery code don’t match.', status: 401 }; }
    const pp = passwordProblem(String(newPassword || ''), u.name);
    if (pp) return { error: pp, status: 400 };
    slot.used = true;
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = await hashPw(String(newPassword), u.salt);
    u.pwAt = now();
    fails.delete(k);
    await saveUser(u);
    await dropSessions(u);
    return { user: u, left: u.rc.filter((c) => !c.used).length };
  }

  async function changePassword(u, current, next, keepSid) {
    if (!(await checkPassword(u, current))) return { error: 'Your current password is wrong.', status: 401 };
    const pp = passwordProblem(String(next || ''), u.name);
    if (pp) return { error: pp, status: 400 };
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = await hashPw(String(next), u.salt);
    u.pwAt = now();
    await saveUser(u);
    await dropSessions(u, keepSid);
    return { ok: true, info: 'Password changed. Your other devices were signed out.' };
  }

  async function newCodes(u, password) {
    if (!(await checkPassword(u, password))) return { error: 'Your password is wrong.', status: 401 };
    const rc = makeCodes();
    u.rc = rc.stored;
    await saveUser(u);
    return { ok: true, codes: rc.codes };
  }

  async function deleteAccount(u, password) {
    if (!(await checkPassword(u, password))) return { error: 'Your password is wrong.', status: 401 };
    if (isOwner(u)) return { error: 'The broadcaster account can’t be deleted from here.', status: 400 };
    const k = lc(u.name);
    users.delete(k);
    retired[k] = now() + RETIRE_MS;
    await Promise.all([store.deleteUser(k), store.saveKV('retired', retired), dropSessions(u)]);
    return { ok: true };
  }

  async function listSessions(u, currentSid) {
    const list = await store.listSessions(lc(u.name));
    return list.map((s) => ({ id: s._id.slice(0, 16), device: s.device || 'Browser', created: s.created, lastSeen: s.lastSeen, current: s._id === currentSid }));
  }
  async function revokeSession(u, shortId, currentSid) {
    const s = (await store.listSessions(lc(u.name))).find((x) => x._id.startsWith(String(shortId || '')) && String(shortId || '').length >= 8);
    if (!s) return { error: 'That device is already signed out.', status: 404 };
    if (s._id === currentSid) return { error: 'Use Sign out for this device.', status: 400 };
    cache.delete(s._id);
    await store.deleteSession(s._id);
    return { ok: true };
  }

  function profile(name) {
    const u = find(name);
    if (!u) return null;
    return { ...pub(u), msgs: u.msgs || 0, streak: u.streak && u.streak.n ? u.streak.n : 0 };
  }

  function account(u) {
    return { ...pub(u), msgs: u.msgs || 0, pwAt: u.pwAt || u.created, codesLeft: (u.rc || []).filter((c) => !c.used).length };
  }

  return {
    sessionOf, startSession, endSession, register, login, recover, changePassword, newCodes, deleteAccount,
    listSessions, revokeSession, revokeOthers: (u, keep) => dropSessions(u, keep), profile, account, find,
    save: saveUser, all: () => users.values(),
  };
}

module.exports = { createAccounts, badges, pub, isMod, isOwner, lc, dayUTC, passwordProblem, device, normCode };
