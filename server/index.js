#!/usr/bin/env node
'use strict';
/*
 * Start Ater Live:   npm start      (or  node server/index.js)
 *
 * Settings come from environment variables, or from a .env file next to
 * package.json (see .env.example):
 *
 *   PORT=8080                 port to listen on
 *   HOST=127.0.0.1            0.0.0.0 to let other machines connect (when hosting)
 *   ATER_OWNER=inoater        this account gets the broadcaster badge
 *                             (otherwise the first account created does)
 *   ATER_DATA=data/ater-data.json   where accounts and chat are saved
 *   TRUST_PROXY=1             behind nginx/Caddy/Cloudflare: use X-Forwarded-For for rate limits
 */
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');

const ROOT = path.join(__dirname, '..');

/* minimal .env support: KEY=value lines, real environment wins */
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env, that's fine */ }

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const dataFile = path.resolve(ROOT, process.env.ATER_DATA || 'data/ater-data.json');
const owner = process.env.ATER_OWNER || '';

const app = createApp({ dataFile, owner, trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '') });

app.server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Stop the other server, or run with PORT=8081.\n`);
    process.exit(1);
  }
  throw e;
});

app.server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`\n  Ater Live is up:  http://${shown}:${PORT}\n`);
  console.log(`  Data file: ${dataFile}`);
  console.log(`  ${owner ? 'Broadcaster account: ' + owner : 'The first account created becomes the broadcaster.'}\n`);
});

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\n  Saving and shutting down…');
    try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { console.error(e); }
    process.exit(0);
  });
}
