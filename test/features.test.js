'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, stream, pause } = require('./helpers');

describe('the Ater pick', () => {
  let s, host, fan, live;
  before(async () => {
    s = await start();
    host = client(s.base); await host.register('Host');
    fan = client(s.base); await fan.register('fanp');
    live = await stream(s.base);
    await live.next('hello');
  });
  after(async () => { live.close(); await s.stop(); });

  test('moderators set it, everyone hears about it, new arrivals get it', async () => {
    assert.equal((await fan.call('/api/feature', { p: 'twitch', u: 'someone' })).status, 403);
    assert.match((await fan.say('/feature someone')).error, /moderators/i);
    assert.equal((await host.call('/api/feature', { p: 'kick', u: 'CoStreamer', note: 'watch party' })).ok, true);
    const f = await live.next('featured', (x) => x && x.u === 'costreamer');
    assert.equal(f.data.p, 'kick');
    assert.equal(f.data.note, 'watch party');
    const late = await stream(s.base);
    assert.equal((await late.next('hello')).data.featured.u, 'costreamer');
    late.close();
  });

  test('/feature defaults to Twitch, checks names, /unfeature clears', async () => {
    assert.equal((await host.say('/feature otherguy')).ok, true);
    assert.equal((await live.next('featured', (x) => x && x.u === 'otherguy')).data.p, 'twitch');
    await pause();
    assert.match((await host.say('/feature bad/name')).error, /channel name/);
    await pause();
    assert.equal((await host.say('/unfeature')).ok, true);
    await live.next('featured', (x) => x === null);
    const log = (await host.call('/api/mod/log')).log.map((e) => e.act);
    assert.ok(log.includes('feature') && log.includes('unfeature'));
  });
});

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
