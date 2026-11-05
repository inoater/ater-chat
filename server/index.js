#!/usr/bin/env node
'use strict';
/*
 * Start Ater Live:   npm start      (or  node server/index.js)
 *
 * Settings come from environment variables, or from a .env file next to
 * package.json (see .env.example):
 *
 *   PORT=8080                 port to listen on (Render sets this for you)
 *   HOST=127.0.0.1            0.0.0.0 to let other machines connect (automatic on Render)
 *   ATER_OWNER=inoater        this account gets the broadcaster badge
 *                             (otherwise the first account created does: set this when public!)
 *   MONGODB_URI=mongodb+srv://…   store everything in MongoDB (Atlas works)
 *   MONGODB_DB=ater           database name
 *   ATER_DATA=data/ater-data.json   without MongoDB: where to save
 *   PUBLIC_URL=https://…      the site's public address (extra origin allowed for writes)
 *   TRUST_PROXY=1             behind Render/nginx/Cloudflare: use X-Forwarded-For (automatic on Render)
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

const env = process.env;
const onRender = Boolean(env.RENDER);
const yes = (v) => /^(1|true|yes)$/i.test(v || '');
const PORT = Number(env.PORT) || 8080;
const HOST = env.HOST || (onRender ? '0.0.0.0' : '127.0.0.1');

(async () => {
  const app = await createApp({
    mongoUri: env.MONGODB_URI || '',
    mongoDb: env.MONGODB_DB || 'ater',
    dataFile: path.resolve(ROOT, env.ATER_DATA || 'data/ater-data.json'),
    owner: env.ATER_OWNER || '',
    trustProxy: env.TRUST_PROXY ? yes(env.TRUST_PROXY) : onRender,
    publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '',
  });

  app.server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use. Stop the other server, or run with PORT=8081.\n`);
      process.exit(1);
    }
    throw e;
  });

  app.server.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    console.log(`\n  Ater Live is up:  http://${shown}:${PORT}`);
    console.log(`  Storage: ${app.store.kind === 'mongo' ? 'MongoDB (' + (env.MONGODB_DB || 'ater') + ')' : 'JSON file'}`);
    console.log(`  ${env.ATER_OWNER ? 'Broadcaster account: ' + env.ATER_OWNER : 'The first account created becomes the broadcaster. Set ATER_OWNER before going public.'}\n`);
  });

  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      if (stopping) process.exit(1);
      stopping = true;
      console.log('\n  Saving and shutting down…');
      try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]); } catch (e) { console.error(e); }
      process.exit(0);
    });
  }
})().catch((e) => {
  console.error('\n  Ater Live could not start:', e.message);
  if (/querySrv|ENOTFOUND|Authentication failed|bad auth|timed out|Server selection/i.test(e.message)) {
    console.error('  Check MONGODB_URI, the database user and password, and that Atlas Network Access allows this machine.\n');
  }
  process.exit(1);
});
