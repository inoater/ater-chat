'use strict';
/*
 * JSON-file backend. Used when MONGODB_URI isn't set: local development,
 * tests, and small single-machine setups. Same interface as mongo.js.
 */
const fs = require('fs');
const path = require('path');

const HIST_MAX = 300;
const AUDIT_MAX = 2000;
const REPORTS_MAX = 1000;

function createJsonStore(file, { delay = 800 } = {}) {
  let db = {
    users: {}, sessions: {}, emotes: {}, kv: {}, history: [], audit: [], reports: [],
  };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    // files written by the first version kept pins/bans/mutes/settings at the top level
    for (const k of ['pins', 'bans', 'mutes', 'settings']) if (raw[k] !== undefined && !(raw.kv && k in raw.kv)) (raw.kv ||= {})[k] = raw[k];
    db = Object.assign(db, raw);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read', file, '-', e.message);
  }

  let timer = null;
  const write = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  };
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; try { write(); } catch (e) { console.error('Save failed:', e.message); } }, delay);
    timer.unref?.();
  };
  const ok = (v) => Promise.resolve(v);
  const now = () => Date.now();

  return {
    kind: 'json',
    async load() {
      const t = now();
      for (const [id, s] of Object.entries(db.sessions)) if (s.exp < t) delete db.sessions[id];
      return {
        users: new Map(Object.entries(db.users)),
        emotes: { ...db.emotes },
        kv: { ...db.kv },
        history: db.history.slice(-HIST_MAX),
      };
    },

    saveUser(u) { db.users[u.name.toLowerCase()] = u; save(); return ok(); },
    deleteUser(lname) { delete db.users[lname]; save(); return ok(); },
    saveKV(key, value) { db.kv[key] = value; save(); return ok(); },

    addMessage(m) { db.history.push(m); if (db.history.length > HIST_MAX) db.history.splice(0, db.history.length - HIST_MAX); save(); return ok(); },
    deleteMessage(id) { db.history = db.history.filter((m) => m.id !== id); save(); return ok(); },
    deleteMessagesBy(name) { const k = name.toLowerCase(); db.history = db.history.filter((m) => m.name.toLowerCase() !== k); save(); return ok(); },
    clearMessages() { db.history = []; save(); return ok(); },

    saveEmote(name, e) { db.emotes[name] = e; save(); return ok(); },
    deleteEmote(name) { delete db.emotes[name]; save(); return ok(); },

    createSession(s) { db.sessions[s._id] = s; save(); return ok(); },
    getSession(id) { const s = db.sessions[id]; return ok(s && s.exp > now() ? { ...s } : null); },
    touchSession(id, patch) { if (db.sessions[id]) { Object.assign(db.sessions[id], patch); save(); } return ok(); },
    deleteSession(id) { delete db.sessions[id]; save(); return ok(); },
    listSessions(u) { return ok(Object.values(db.sessions).filter((s) => s.u === u && s.exp > now()).map((s) => ({ ...s }))); },
    deleteSessions(u, keepId) { for (const [id, s] of Object.entries(db.sessions)) if (s.u === u && id !== keepId) delete db.sessions[id]; save(); return ok(); },

    addAudit(e) { db.audit.push(e); if (db.audit.length > AUDIT_MAX) db.audit.splice(0, db.audit.length - AUDIT_MAX); save(); return ok(); },
    listAudit(limit = 100) { return ok(db.audit.slice(-limit).reverse()); },

    addReport(r) { db.reports.push(r); if (db.reports.length > REPORTS_MAX) db.reports.splice(0, db.reports.length - REPORTS_MAX); save(); return ok(); },
    findReport(msgId, by) { return ok(db.reports.find((r) => r.msg.id === msgId && r.by === by) || null); },
    listReports(open = true) { return ok(db.reports.filter((r) => !open || !r.done).slice(-200).reverse()); },
    updateReports(filter, patch) {
      for (const r of db.reports) if ((!filter.id || r.id === filter.id) && (!filter.msgId || r.msg.id === filter.msgId) && !r.done) Object.assign(r, patch);
      save(); return ok();
    },

    ping: () => ok(true),
    async close() { clearTimeout(timer); timer = null; write(); },
  };
}

module.exports = { createJsonStore };
