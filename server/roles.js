'use strict';
/*
 * Roles: who can do what, and how their names look.
 *
 * Built in:
 *   owner (Admin)      the broadcaster. Everything, including making moderators.
 *   mod   (Moderator)  everything except making moderators; can create custom
 *                      roles beneath them and hand them out.
 * Custom roles (made by the admin or moderators) carry a precise set of powers:
 *   emotes    add and remove emotes
 *   delete    delete messages
 *   pin       pin messages
 *   polls     run polls
 *   timeout   time people out, up to the role's limit (never more than 1 hour)
 *   links     post links right away (skips the new-account wait)
 *   slow      skip slow mode
 *   feature   set the Ater pick
 *   words     edit blocked words
 *   reports   see and handle reports
 *
 * Every role has a look: the name style (solid, gradient, glow, shimmer,
 * outline, glass) with its colours, and an optional badge image.
 * Roles are ranked; a person's highest-ranked role with a look styles their
 * name, and up to three role badges show beside it.
 */
const crypto = require('crypto');

const PERMS = {
  emotes: 'Add and remove emotes',
  delete: 'Delete messages',
  pin: 'Pin messages',
  polls: 'Run polls',
  timeout: 'Time people out',
  links: 'Post links right away',
  slow: 'Skip slow mode',
  feature: 'Set the Ater pick',
  words: 'Edit blocked words',
  reports: 'See and handle reports',
};
const LOOKS = ['none', 'solid', 'gradient', 'glow', 'shimmer', 'outline', 'glass'];
const MAX_TIMEOUT_MIN = 60;
const MAX_ROLES = 40;
const HEX = /^#[0-9a-f]{6}$/i;

const BUILTIN = [
  { id: 'owner', name: 'Admin', builtin: true, look: { kind: 'none' }, badge: null },
  { id: 'mod', name: 'Moderator', builtin: true, look: { kind: 'none' }, badge: null },
];

function cleanLook(l) {
  l = l || {};
  const kind = LOOKS.includes(l.kind) ? l.kind : 'none';
  const col = (c, d) => (HEX.test(c || '') ? c.toLowerCase() : d);
  return { kind, c1: col(l.c1, '#a855f7'), c2: col(l.c2, '#ec4899'), c3: col(l.c3, ''), glow: col(l.glow, l.c1 && HEX.test(l.c1) ? l.c1.toLowerCase() : '#a855f7') };
}
function cleanPerms(p) {
  const out = {};
  for (const k of Object.keys(PERMS)) if (p && p[k]) out[k] = true;
  return out;
}

function createRoles(store, state) {
  const kv = state.kv;
  if (!Array.isArray(kv.roles)) kv.roles = [];
  for (const b of BUILTIN) if (!kv.roles.some((r) => r.id === b.id)) kv.roles.unshift({ ...b });
  // built-ins always lead, admin first
  kv.roles.sort((a, b) => (a.id === 'owner' ? -1 : b.id === 'owner' ? 1 : a.id === 'mod' ? -1 : b.id === 'mod' ? 1 : 0));
  const save = () => store.saveKV('roles', kv.roles);

  const get = (id) => kv.roles.find((r) => r.id === id) || null;
  const rank = (id) => { const i = kv.roles.findIndex((r) => r.id === id); return i < 0 ? 1e9 : i; };
  const has = (u, id) => Boolean(u && (u.roles || []).includes(id));
  const isOwner = (u) => has(u, 'owner');
  const isMod = (u) => has(u, 'mod') || isOwner(u);
  const custom = (u) => (u && u.roles ? u.roles.map(get).filter((r) => r && !r.builtin) : []);

  function can(u, perm) {
    if (!u) return false;
    if (isMod(u)) return true;
    return custom(u).some((r) => r.perms && r.perms[perm]);
  }
  /** Longest timeout this person may give, in ms (Infinity for mods). */
  function timeoutMax(u) {
    if (isMod(u)) return Infinity;
    let m = 0;
    for (const r of custom(u)) if (r.perms && r.perms.timeout) m = Math.max(m, Math.min(MAX_TIMEOUT_MIN, r.timeoutMin || 10));
    return m * 60_000;
  }
  /** Highest position (lower number = more senior) among a person's roles. */
  function seniority(u) {
    if (isOwner(u)) return -2;
    if (isMod(u)) return -1;
    let best = 1e9;
    for (const id of u.roles || []) best = Math.min(best, rank(id));
    return best;
  }
  /** Can actor moderate target? Only people strictly more senior. */
  const outranks = (actor, target) => isOwner(actor) || (!isOwner(target) && seniority(actor) < seniority(target));
  const staff = (u) => isMod(u) || custom(u).some((r) => r.perms && Object.keys(r.perms).length);
  const permsOf = (u) => (isMod(u) ? Object.keys(PERMS) : [...new Set(custom(u).flatMap((r) => Object.keys(r.perms || {})))]);

  /** Name look: the highest-ranked role that has one. */
  function displayRole(u) {
    const ids = (u.roles || []).slice().sort((a, b) => rank(a) - rank(b));
    for (const id of ids) { const r = get(id); if (r && r.look && r.look.kind !== 'none') return r.id; }
    return '';
  }
  /** Role badges to show beside a name (most senior first, up to 3). */
  function badgeRoles(u) {
    return (u.roles || []).filter((id) => { const r = get(id); return r && !r.builtin && r.badge; }).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  }

  /* ---- editing roles ---- */
  const canEditRole = (actor, role) => (role.builtin ? isOwner(actor) : isMod(actor));
  function upsert(actor, input) {
    if (!isMod(actor)) return { error: 'Only moderators can change roles.', status: 403 };
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 24) return { error: 'Role names are 1 to 24 characters.', status: 400 };
    let r = input.id ? get(input.id) : null;
    if (input.id && !r) return { error: 'That role is gone.', status: 404 };
    if (r && !canEditRole(actor, r)) return { error: 'Only the admin can change the ' + r.name + ' role.', status: 403 };
    if (kv.roles.some((x) => x !== r && x.name.toLowerCase() === name.toLowerCase())) return { error: 'There is already a role called ' + name + '.', status: 409 };
    if (!r) {
      if (kv.roles.length >= MAX_ROLES) return { error: 'That’s a lot of roles. Remove one first.', status: 400 };
      r = { id: 'r' + crypto.randomBytes(4).toString('hex'), builtin: false, badge: null, perms: {}, timeoutMin: 10, created: Date.now(), by: actor.name };
      kv.roles.push(r);
    }
    r.name = name;
    r.look = cleanLook(input.look);
    if (!r.builtin) {
      r.perms = cleanPerms(input.perms);
      r.timeoutMin = Math.max(1, Math.min(MAX_TIMEOUT_MIN, parseInt(input.timeoutMin, 10) || 10));
    }
    save();
    return { ok: true, role: r };
  }
  function setBadge(actor, id, badge) {
    const r = get(id);
    if (!r) return { error: 'That role is gone.', status: 404 };
    if (!canEditRole(actor, r)) return { error: 'Only the admin can change the ' + r.name + ' role.', status: 403 };
    r.badge = badge; save();
    return { ok: true, role: r };
  }
  function remove(actor, id) {
    const r = get(id);
    if (!r) return { error: 'That role is gone.', status: 404 };
    if (r.builtin) return { error: 'Built-in roles stay.', status: 400 };
    if (!isMod(actor)) return { error: 'Only moderators can change roles.', status: 403 };
    kv.roles = kv.roles.filter((x) => x.id !== id);
    save();
    return { ok: true, role: r };
  }
  function reorder(actor, ids) {
    if (!isMod(actor)) return { error: 'Only moderators can change roles.', status: 403 };
    const fixed = kv.roles.filter((r) => r.builtin);
    const rest = kv.roles.filter((r) => !r.builtin);
    const order = (ids || []).map(get).filter((r) => r && !r.builtin);
    for (const r of rest) if (!order.includes(r)) order.push(r);
    kv.roles = [...fixed, ...order];
    save();
    return { ok: true };
  }
  /** Give or take a role. Only the admin hands out Moderator; mods hand out custom roles. */
  function assign(actor, target, id, on) {
    const r = get(id);
    if (!r) return { error: 'That role is gone.', status: 404 };
    if (id === 'owner') return { error: 'There is one admin.', status: 400 };
    if (id === 'mod' ? !isOwner(actor) : !isMod(actor)) return { error: id === 'mod' ? 'Only the admin can make moderators.' : 'Only moderators can hand out roles.', status: 403 };
    if (!isOwner(actor) && isMod(target) && actor !== target) return { error: 'You can’t change another moderator’s roles.', status: 403 };
    target.roles = (target.roles || []).filter((x) => x !== id);
    if (on) target.roles.push(id);
    return { ok: true, role: r };
  }

  /** Roles as browsers see them. Powers are included so the dashboard can show them. */
  const publicList = () => kv.roles.map((r) => ({
    id: r.id, name: r.name, builtin: Boolean(r.builtin), look: r.look || { kind: 'none' },
    badge: r.badge ? `/api/media/rb-${r.id}?v=${r.badge.ts}` : null,
    perms: r.builtin ? (r.id === 'owner' ? ['all', 'mods'] : ['all']) : Object.keys(r.perms || {}), timeoutMin: r.timeoutMin || 0,
  }));

  return {
    PERMS, LOOKS, get, can, timeoutMax, outranks, staff, permsOf, isOwner, isMod, displayRole, badgeRoles,
    upsert, setBadge, remove, reorder, assign, publicList, list: () => kv.roles,
  };
}

module.exports = { createRoles, PERMS, LOOKS, cleanLook, MAX_TIMEOUT_MIN };
