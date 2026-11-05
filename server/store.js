'use strict';
/*
 * A tiny JSON-file store. Everything Ater chat keeps (accounts, sessions,
 * emotes, pins, bans, recent history) lives in one object that is written
 * to disk shortly after it changes, and once more on shutdown.
 */
const fs = require('fs');
const path = require('path');

const EMPTY = () => ({
  users: {},      // lowercase name -> account
  sessions: {},   // token -> { u: lowercase name, exp }
  emotes: {},     // name -> { type, data (base64), by, ts }
  pins: [],
  bans: {},       // lowercase name -> { by, ts, why }
  mutes: {},      // lowercase name -> muted until (ms)
  settings: { slow: 0 },
  history: [],
});

function createStore(file, { delay = 800 } = {}) {
  let db = EMPTY();
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8')));
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

  return {
    get db() { return db; },
    /** Ask for a save soon. Many changes in a row become one write. */
    save() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        try { write(); } catch (e) { console.error('Save failed:', e.message); }
      }, delay);
      timer.unref?.();
    },
    /** Write now (used on shutdown and in tests). */
    flush() {
      clearTimeout(timer);
      timer = null;
      write();
    },
  };
}

module.exports = { createStore };
