'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../server/app');

/** Start a server on a free port with a throwaway data file. */
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ater-test-'));
  const dataFile = path.join(dir, 'data.json');
  const app = createApp({ dataFile, saveDelay: 5, ...opts });
  await new Promise((ok) => app.server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app, base, dataFile,
    async stop() { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

/** A browser-ish client that keeps its own login cookie. */
function client(base) {
  let cookie = '';
  async function call(p, body, { header = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (header) headers['x-ater'] = '1';
    if (cookie) headers.cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, ...json };
  }
  const password = crypto.randomUUID();
  return {
    call,
    register: (name) => call('/api/auth/register', { name, password }),
    login: (name, pw = password) => call('/api/auth/login', { name, password: pw }),
    say: (text, rp) => call('/api/send', { text, rp }),
    get cookie() { return cookie; },
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
    /** Wait for the first event (already seen or future) that matches. */
    next(ev, pred = () => true, ms = 2000) {
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

module.exports = { start, client, stream };
