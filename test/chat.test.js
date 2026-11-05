'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePoll, parseDur } = require('../server/chat');

test('parsePoll: question up to the ?, options split on |', () => {
  assert.deepEqual(parsePoll('What should we play tonight? Elden Ring | Chess | Just chatting'), {
    secs: 60, q: 'What should we play tonight?', opts: ['Elden Ring', 'Chess', 'Just chatting'],
  });
});

test('parsePoll: leading number is the duration, clamped', () => {
  assert.equal(parsePoll('120 Ok? a | b').secs, 120);
  assert.equal(parsePoll('2 Ok? a | b').secs, 10);
  assert.equal(parsePoll('9999 Ok? a | b').secs, 1800);
});

test('parsePoll: no options means Yes / No', () => {
  assert.deepEqual(parsePoll('Stream tomorrow?').opts, ['Yes', 'No']);
});

test('parsePoll: no question mark needs three parts', () => {
  assert.deepEqual(parsePoll('Pick one | red | blue').opts, ['red', 'blue']);
  assert.ok(parsePoll('just words').error);
});

test('parseDur', () => {
  assert.equal(parseDur('10m', 0), 600000);
  assert.equal(parseDur('30s', 0), 30000);
  assert.equal(parseDur('2h', 0), 7200000);
  assert.equal(parseDur('5', 0), 300000);
  assert.equal(parseDur('soon', 42), 42);
});
