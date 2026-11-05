'use strict';
/*
 * MongoDB backend (MongoDB Atlas works out of the box).
 *
 * Collections (all prefixed with `prefix`, empty by default):
 *   users     one document per account, _id = lowercase name
 *   sessions  _id = sha256 of the session token; removed by a TTL index when `exp` passes
 *   messages  chat history; removed by a TTL index 30 days after `at`
 *   emotes    uploaded emotes, _id = emote name
 *   kv        small settings documents: pins, bans, mutes, settings, filters, retired
 *   audit     moderator actions; kept 180 days
 *   reports   messages people reported; kept 90 days
 *
 * The server keeps hot state (accounts, pins, recent chat…) in memory and
 * writes changes through, so one server process should own the database.
 */
const { MongoClient } = require('mongodb');

const HIST_LOAD = 300;
const DAY = 86400;

async function createMongoStore(uri, { dbName = 'ater', prefix = '' } = {}) {
  const client = new MongoClient(uri, { appName: 'ater-live', serverSelectionTimeoutMS: 10000, maxPoolSize: 10 });
  await client.connect();
  const db = client.db(dbName);
  const c = (name) => db.collection(prefix + name);
  const users = c('users'), sessions = c('sessions'), messages = c('messages'), emotes = c('emotes'),
    kv = c('kv'), audit = c('audit'), reports = c('reports');

  await Promise.all([
    sessions.createIndex({ exp: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ u: 1 }),
    messages.createIndex({ at: 1 }, { expireAfterSeconds: 30 * DAY }),
    messages.createIndex({ name_lc: 1 }),
    audit.createIndex({ at: 1 }, { expireAfterSeconds: 180 * DAY }),
    reports.createIndex({ at: 1 }, { expireAfterSeconds: 90 * DAY }),
    reports.createIndex({ done: 1, at: -1 }),
    reports.createIndex({ 'msg.id': 1, by: 1 }),
  ]);

  // writes are fire-and-forget from the chat's point of view, but never silently lost
  const bg = (p) => p.catch((e) => console.error('MongoDB write failed:', e.message));
  const strip = ({ _id, ...rest }) => rest;
  const toSession = (s) => s && { ...s, exp: +s.exp, created: +s.created, lastSeen: +s.lastSeen };

  return {
    kind: 'mongo',
    async load() {
      const [u, e, k, h] = await Promise.all([
        users.find().toArray(),
        emotes.find().toArray(),
        kv.find().toArray(),
        messages.find().sort({ at: -1 }).limit(HIST_LOAD).toArray(),
      ]);
      return {
        users: new Map(u.map((d) => [d._id, strip(d)])),
        emotes: Object.fromEntries(e.map((d) => [d._id, strip(d)])),
        kv: Object.fromEntries(k.map((d) => [d._id, d.v])),
        history: h.reverse().map(({ _id, at, name_lc, ...m }) => m),
      };
    },

    saveUser: (u) => bg(users.replaceOne({ _id: u.name.toLowerCase() }, u, { upsert: true })),
    deleteUser: (lname) => bg(users.deleteOne({ _id: lname })),
    saveKV: (key, v) => bg(kv.replaceOne({ _id: key }, { v }, { upsert: true })),

    addMessage: (m) => bg(messages.insertOne({ ...m, _id: m.id, at: new Date(m.ts), name_lc: m.name.toLowerCase() })),
    deleteMessage: (id) => bg(messages.deleteOne({ _id: id })),
    deleteMessagesBy: (name) => bg(messages.deleteMany({ name_lc: name.toLowerCase() })),
    clearMessages: () => bg(messages.deleteMany({})),

    saveEmote: (name, e) => bg(emotes.replaceOne({ _id: name }, e, { upsert: true })),
    deleteEmote: (name) => bg(emotes.deleteOne({ _id: name })),

    createSession: (s) => sessions.insertOne({ ...s, exp: new Date(s.exp), created: new Date(s.created), lastSeen: new Date(s.lastSeen) }),
    async getSession(id) {
      const s = await sessions.findOne({ _id: id });
      return s && +s.exp > Date.now() ? toSession(s) : null;
    },
    touchSession: (id, patch) => bg(sessions.updateOne({ _id: id }, { $set: { ...patch, ...(patch.lastSeen ? { lastSeen: new Date(patch.lastSeen) } : {}) } })),
    deleteSession: (id) => sessions.deleteOne({ _id: id }),
    async listSessions(u) { return (await sessions.find({ u, exp: { $gt: new Date() } }).sort({ lastSeen: -1 }).toArray()).map(toSession); },
    deleteSessions: (u, keepId) => sessions.deleteMany(keepId ? { u, _id: { $ne: keepId } } : { u }),

    addAudit: (e) => bg(audit.insertOne({ ...e, at: new Date(e.ts) })),
    async listAudit(limit = 100) { return (await audit.find().sort({ at: -1 }).limit(limit).toArray()).map(({ _id, at, ...e }) => e); },

    addReport: (r) => bg(reports.insertOne({ ...r, _id: r.id, at: new Date(r.ts) })),
    findReport: (msgId, by) => reports.findOne({ 'msg.id': msgId, by }),
    async listReports(open = true) { return (await reports.find(open ? { done: { $ne: true } } : {}).sort({ at: -1 }).limit(200).toArray()).map(({ _id, at, ...r }) => r); },
    updateReports(filter, patch) {
      const q = { done: { $ne: true } };
      if (filter.id) q._id = filter.id;
      if (filter.msgId) q['msg.id'] = filter.msgId;
      return bg(reports.updateMany(q, { $set: patch }));
    },

    async ping() { try { await db.command({ ping: 1 }); return true; } catch { return false; } },
    close: () => client.close(),
  };
}

module.exports = { createMongoStore };
