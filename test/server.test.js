'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, stream } = require('./helpers');
const { createApp } = require('../server/app');

describe('accounts', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  test('the first account is the broadcaster, later ones are not', async () => {
    const a = client(s.base), b = client(s.base);
    const ra = await a.register('Streamer');
    assert.equal(ra.status, 200);
    assert.equal(ra.me.owner, true);
    assert.ok(ra.me.b.includes('owner'));
    const rb = await b.register('viewer_1');
    assert.equal(rb.me.owner, false);
    assert.equal(rb.me.mod, false);
    assert.ok(rb.me.b.includes('og'), 'early accounts are OG');
  });

  test('names and passwords are checked', async () => {
    const c = client(s.base);
    assert.equal((await c.register('ab')).status, 400);
    assert.equal((await c.register('no spaces')).status, 400);
    assert.equal((await c.register('admin')).status, 400);
    assert.equal((await c.register('streamer')).status, 409, 'names are case-insensitive');
    const short = await c.call('/api/auth/register', { name: 'shortpw', password: '1234567' });
    assert.equal(short.status, 400);
  });

  test('login works, the wrong password does not', async () => {
    const c = client(s.base);
    await c.register('loginner');
    await c.call('/api/auth/logout', {});
    assert.equal((await c.call('/api/me')).me, null);
    assert.equal((await c.login('loginner', 'not-the-password')).status, 401);
    const ok = await c.login('LOGINNER');
    assert.equal(ok.me.name, 'loginner');
    assert.equal((await c.call('/api/me')).me.name, 'loginner');
  });

  test('writes need the X-Ater header and a session', async () => {
    const c = client(s.base);
    assert.equal((await c.call('/api/send', { text: 'hi' }, { header: false })).status, 403);
    assert.equal((await c.call('/api/send', { text: 'hi' })).status, 401);
  });
});

describe('chat', () => {
  let s, owner, viewer, live;
  before(async () => {
    s = await start();
    owner = client(s.base); await owner.register('Host');
    viewer = client(s.base); await viewer.register('fan');
    live = await stream(s.base);
    await live.next('hello');
  });
  after(async () => { live.close(); await s.stop(); });

  test('messages reach everyone live', async () => {
    assert.equal((await viewer.say('hello chat AterW')).ok, true);
    const e = await live.next('msg', (m) => m.text === 'hello chat AterW');
    assert.equal(e.data.name, 'fan');
    assert.ok(e.data.id);
  });

  test('/me and replies', async () => {
    const first = await live.next('msg', (m) => m.text === 'hello chat AterW');
    await new Promise((r) => setTimeout(r, 500));
    await owner.say('/me waves');
    const me = await live.next('msg', (m) => m.text === 'waves');
    assert.equal(me.data.me, true);
    await new Promise((r) => setTimeout(r, 500));
    await owner.say('welcome!', first.data.id);
    const rp = await live.next('msg', (m) => m.text === 'welcome!');
    assert.deepEqual(rp.data.rp, { id: first.data.id, n: 'fan', t: 'hello chat AterW' });
  });

  test('the same text twice is blocked, a lone emote is not', async () => {
    const c = client(s.base); await c.register('repeater');
    assert.equal((await c.say('same thing')).ok, true);
    await new Promise((r) => setTimeout(r, 500));
    assert.match((await c.say('same thing')).error, /Duplicate/);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await c.say('AterPog')).ok, true);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await c.say('AterPog')).ok, true);
  });

  test('new arrivals get recent history', async () => {
    const late = await stream(s.base);
    const hello = await late.next('hello');
    assert.ok(hello.data.history.some((m) => m.text === 'hello chat AterW'));
    assert.ok(hello.data.emotes.some((e) => e.name === 'AterW'));
    late.close();
  });

  test('only moderators can moderate', async () => {
    assert.match((await viewer.say('/slow 5')).error, /moderators/i);
    assert.equal((await viewer.call('/api/del', { id: 'x' })).status, 403);
  });

  test('mute stops someone chatting', async () => {
    assert.equal((await owner.say('/mute fan 5m')).ok, true);
    await live.next('notice', (n) => /fan was muted/.test(n.text));
    assert.match((await viewer.say('can I talk?')).error, /muted/);
    assert.equal((await owner.say('/unmute fan')).ok, true);
    assert.equal((await viewer.say('thanks')).ok, true);
  });

  test('delete, pin and unpin', async () => {
    await new Promise((r) => setTimeout(r, 500));
    await viewer.say('pin me please');
    const m = await live.next('msg', (x) => x.text === 'pin me please');
    assert.equal((await owner.call('/api/pin', { id: m.data.id })).ok, true);
    const pins = await live.next('pins', (p) => p.length === 1);
    assert.equal(pins.data[0].text, 'pin me please');
    assert.equal((await owner.call('/api/del', { id: m.data.id })).ok, true);
    await live.next('del', (d) => d.id === m.data.id);
    await live.next('pins', (p) => p.length === 0);
  });

  test('polls: start, vote once, results', async () => {
    assert.equal((await owner.say('/poll 30 What next? Games | Chess | Talk')).ok, true);
    const p = await live.next('poll', (x) => x && x.q === 'What next?');
    assert.deepEqual(p.data.opts.map((o) => o.t), ['Games', 'Chess', 'Talk']);
    assert.equal((await viewer.call('/api/vote', { i: 1 })).mine, 1);
    assert.match((await viewer.call('/api/vote', { i: 0 })).error, /already/);
    await live.next('poll', (x) => x && x.total === 1);
    assert.equal((await owner.say('/endpoll')).ok, true);
    await live.next('poll', (x) => x && x.done);
  });

  test('the broadcaster can make moderators', async () => {
    assert.match((await viewer.say('/mod fan')).error, /broadcaster/);
    assert.equal((await owner.say('/mod fan')).ok, true);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await viewer.say('/slow off')).ok, true);
  });

  test('emote uploads: images only, unique names', async () => {
    const png = 'data:image/png;base64,' + Buffer.from('fake png bytes').toString('base64');
    assert.equal((await owner.call('/api/emote', { name: 'MyEmote', data: png })).ok, true);
    assert.equal((await owner.call('/api/emote', { name: 'MyEmote', data: png })).status, 400);
    assert.equal((await owner.call('/api/emote', { name: 'AterW', data: png })).status, 400);
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
    assert.equal((await owner.call('/api/emote', { name: 'Sneaky', data: svg })).status, 400);
    const r = await fetch(s.base + '/api/emote/MyEmote');
    assert.equal(r.headers.get('content-type'), 'image/png');
    const b = await fetch(s.base + '/api/emote/AterHype');
    assert.equal(b.headers.get('content-type'), 'image/svg+xml');
  });
});

describe('website', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  test('serves the site and its files', async () => {
    const home = await fetch(s.base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /Ater Live/);
    assert.equal((await fetch(s.base + '/healthz')).status, 200);
  });

  test('answers repeat visits with 304', async () => {
    const r = await fetch(s.base + '/index.html');
    const again = await fetch(s.base + '/index.html', { headers: { 'if-none-match': r.headers.get('etag') } });
    assert.equal(again.status, 304);
  });

  test('nothing outside public/ is reachable', async () => {
    for (const p of ['/../server/app.js', '/..%2Fserver%2Fapp.js', '/%2e%2e/package.json', '/server/app.js']) {
      assert.equal((await fetch(s.base + p)).status, 404, p);
    }
  });
});

test('accounts and chat survive a restart', async () => {
  const s = await start();
  const c = client(s.base);
  await c.register('keeper');
  await c.say('remember me');
  await s.app.close();
  const again = createApp({ dataFile: s.dataFile });
  await new Promise((ok) => again.server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${again.server.address().port}`;
  const live = await stream(base);
  const hello = await live.next('hello');
  assert.ok(hello.data.history.some((m) => m.text === 'remember me'));
  assert.equal((await client(base).login('keeper')).status, 401, 'a different password still fails');
  live.close();
  await again.close();
});
