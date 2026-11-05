'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, stream, pause } = require('./helpers');

describe('Ater 7TV emotes', () => {
  let s, host, fan;
  before(async () => {
    s = await start();
    host = client(s.base); await host.register('Host');
    fan = client(s.base); await fan.register('fan7');
  });
  after(() => s.stop());

  test('the built-in 7TV set comes with hello', async () => {
    const live = await stream(s.base);
    const { data } = await live.next('hello');
    live.close();
    const kekw = data.emotes.find((e) => e.name === 'KEKW');
    assert.equal(kekw.set, '7tv');
    assert.match(kekw.url, /^https:\/\/cdn\.7tv\.app\/emote\/\w+\/2x\.webp$/);
    assert.equal(data.emotes.find((e) => e.name === 'widepeepoHappy').w, 70);
    assert.ok(data.emotes.filter((e) => e.set === '7tv').length >= 40);
  });

  test('a lone 7TV emote can repeat (combos)', async () => {
    assert.equal((await fan.say('KEKW')).ok, true);
    await pause();
    assert.equal((await fan.say('KEKW')).ok, true);
  });

  test('moderators add 7TV emotes by link', async () => {
    const link = 'https://7tv.app/emotes/01F6NACCD80006SZ7ZW5FMWKWK';
    assert.equal((await fan.call('/api/emote', { name: 'MyPray', link })).status, 403);
    assert.equal((await host.call('/api/emote', { name: 'MyPray', link })).ok, true);
    assert.equal((await host.call('/api/emote', { name: 'KEKW', link })).status, 400, 'name taken by the set');
    assert.equal((await host.call('/api/emote', { name: 'Nope', link: 'not a link' })).status, 400);
    const r = await fetch(s.base + '/api/emote/MyPray', { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /cdn\.7tv\.app/);
  });
});
