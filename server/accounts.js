'use strict';
/*
 * Ater accounts: names, passwords (scrypt), sessions (HttpOnly cookie),
 * roles and badges.
 */
const crypto = require('crypto');

const COOKIE = 'ater_s';
const SESSION_DAYS = 90;
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED = new Set(['system', 'ater', 'aterbot', 'admin', 'moderator', 'mod', 'everyone', 'here']);
const OG_LIMIT = 100; // the first 100 accounts get the OG badge

const lc = (s) => String(s || '').toLowerCase().replace(/^@/, '');
const now = () => Date.now();
const dayUTC = (t = now()) => new Date(t).toISOString().slice(0, 10);
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

const isOwner = (u) => Boolean(u && (u.roles || []).includes('owner'));
const isMod = (u) => Boolean(u && ((u.roles || []).includes('mod') || isOwner(u)));

/** Badges shown next to a name. 'streak:N' appears from 3 days in a row. */
function badges(u) {
  const b = [];
  if (isOwner(u)) b.push('owner');
  else if (isMod(u)) b.push('mod');
  if (u.og) b.push('og');
  if (u.streak && u.streak.n >= 3 && u.streak.last >= dayUTC(now() - 864e5)) b.push('streak:' + u.streak.n);
  return b;
}

/** What other people (and the browser) get to see about an account. */
const pub = (u) => (u ? { name: u.name, color: u.color || '', b: badges(u), mod: isMod(u), owner: isOwner(u) } : null);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAccounts(store, { owner = '' } = {}) {
  const db = () => store.db;
  owner = lc(owner);

  function userOf(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const s = db().sessions[token];
    if (!s || s.exp < now()) {
      if (s) { delete db().sessions[token]; store.save(); }
      return null;
    }
    return db().users[s.u] || null;
  }

  function startSession(req, res, u) {
    const token = crypto.randomBytes(24).toString('base64url');
    db().sessions[token] = { u: lc(u.name), exp: now() + SESSION_DAYS * 864e5 };
    store.save();
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) { delete db().sessions[token]; store.save(); }
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  function register(name, password) {
    name = String(name || '').trim();
    password = String(password || '');
    if (!NAME_RE.test(name)) return { error: 'Names are 3 to 20 letters, numbers or _.', status: 400 };
    if (RESERVED.has(lc(name))) return { error: 'That name is reserved.', status: 400 };
    if (db().users[lc(name)]) return { error: 'That name is taken.', status: 409 };
    if (password.length < 8) return { error: 'Use at least 8 characters for the password.', status: 400 };
    const count = Object.keys(db().users).length;
    const salt = crypto.randomBytes(16).toString('hex');
    const isFirstOwner = owner ? lc(name) === owner : count === 0;
    const u = {
      name, salt, hash: hashPw(password, salt),
      roles: isFirstOwner ? ['owner'] : [],
      color: '', created: now(), og: count < OG_LIMIT, msgs: 0, streak: { last: '', n: 0 },
    };
    db().users[lc(name)] = u;
    store.save();
    return { user: u };
  }

  function login(name, password) {
    const u = db().users[lc(name)];
    const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
    if (!ok) return { error: 'Wrong name or password.', status: 401 };
    if (owner && lc(name) === owner && !isOwner(u)) { u.roles = [...(u.roles || []), 'owner']; store.save(); }
    return { user: u };
  }

  /** Forget expired sessions now and then. */
  const sweep = setInterval(() => {
    let n = 0;
    for (const [t, s] of Object.entries(db().sessions)) if (s.exp < now()) { delete db().sessions[t]; n++; }
    if (n) store.save();
  }, 36e5);
  sweep.unref();

  return { userOf, startSession, endSession, register, login, find: (n) => db().users[lc(n)] || null, stop: () => clearInterval(sweep) };
}

module.exports = { createAccounts, badges, pub, isMod, isOwner, lc, dayUTC };
