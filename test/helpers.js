'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../server/app');

/**
 * Start a server on a free port. Uses a throwaway JSON file, or MongoDB
 * when TEST_MONGODB_URI is set (collections get a random prefix and are
 * dropped afterwards).
 */
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ater-test-'));
  const dataFile = path.join(dir, 'data.json');
  const mongoPrefix = process.env.TEST_MONGODB_URI ? 'test_' + crypto.randomBytes(3).toString('hex') + '_' : '';
  const base = { dataFile, saveDelay: 5, limits: { signups: 1000, auth: 1000 }, mongoUri: process.env.TEST_MONGODB_URI || '', mongoPrefix };
  const app = await createApp({ ...base, ...opts });
  await new Promise((ok) => app.server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const handle = {
    app, base: url, dataFile, appOpts: { ...base, ...opts },
    async stop() {
      await handle.app.close().catch(() => {});
      if (mongoPrefix) await dropPrefix(process.env.TEST_MONGODB_URI, mongoPrefix);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return handle;
}

async function dropPrefix(uri, prefix) {
  const { MongoClient } = require('mongodb');
  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db('ater');
  for (const col of await db.listCollections().toArray()) if (col.name.startsWith(prefix)) await db.collection(col.name).drop();
  await c.close();
}

/** A browser-ish client that keeps its own login cookie. */
function client(base, { origin } = {}) {
  let cookie = '';
  const password = crypto.randomUUID();
  async function call(p, body, { header = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (header) headers['x-ater'] = '1';
    if (origin) headers.origin = origin;
    if (cookie) headers.cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, headers: r.headers, ...json };
  }
  return {
    call, password,
    register: (name, pw = password) => call('/api/auth/register', { name, password: pw }),
    login: (name, pw = password) => call('/api/auth/login', { name, password: pw }),
    say: (text, rp) => call('/api/send', { text, rp }),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

/** Open the live chat stream and collect events. */
async function stream(base, cookie = '') {
  const ac = new AbortController();
  const r = await fetch(base + '/api/stream', { headers: cookie ? { cookie } : {}, signal: ac.signal });
  const events = [];
  const waiters = [];
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (chunk.match(/^event: (.*)$/m) || [])[1];
          const data = (chunk.match(/^data: (.*)$/m) || [])[1];
          if (!ev) continue;
          const e = { ev, data: JSON.parse(data) };
          events.push(e);
          for (const w of [...waiters]) if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.ok(e); }
        }
      }
    } catch { /* aborted */ }
  })();
  return {
    events,
    next(ev, pred = () => true, ms = 3000) {
      const test = (e) => e.ev === ev && pred(e.data);
      const seen = events.find(test);
      if (seen) return Promise.resolve(seen);
      return new Promise((ok, no) => {
        const w = { test, ok };
        waiters.push(w);
        setTimeout(() => no(new Error('timed out waiting for ' + ev)), ms).unref();
      });
    },
    close: () => ac.abort(),
  };
}

const pause = (ms = 500) => new Promise((r) => setTimeout(r, ms));

module.exports = { start, client, stream, pause };
