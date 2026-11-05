'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('every browser script parses', () => {
  for (const f of fs.readdirSync(path.join(PUB, 'js'))) {
    assert.doesNotThrow(() => new vm.Script(read('public/js/' + f), { filename: f }), f);
  }
});

test('the Kick relay worker parses', () => {
  const src = read('kick-relay/worker.js').replace('export default', 'module.exports =');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'worker.js' }));
});

test('every file index.html points at exists', () => {
  const html = read('public/index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('//'));
  assert.ok(refs.length >= 5, 'found the local references');
  for (const r of refs) assert.ok(fs.existsSync(path.join(PUB, r)), r + ' is missing');
});

test('config.js loads and has the basics', () => {
  const ctx = {};
  vm.runInNewContext(read('public/js/config.js') + '\nthis.CONFIG = CONFIG;', ctx);
  const c = ctx.CONFIG;
  assert.equal(typeof c.name, 'string');
  assert.ok(c.channels && 'twitch' in c.channels);
  assert.ok(Array.isArray(c.week) && c.week.every((s) => /^\d\d:\d\d$/.test(s.utc) && s.day >= 0 && s.day <= 6));
  assert.ok(c.events.every((e) => !Number.isNaN(Date.parse(e.start))));
});
