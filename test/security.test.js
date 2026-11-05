'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, stream, pause } = require('./helpers');
const { passwordProblem, normCode, device } = require('../server/accounts');
const { filterHit } = require('../server/chat');

describe('passwords and helpers', () => {
  test('weak passwords are refused', () => {
    assert.ok(passwordProblem('short', 'x'));
    assert.ok(passwordProblem('password123', 'x'));
    assert.ok(passwordProblem('aaaaaaaaaa', 'x'));
    assert.ok(passwordProblem('my-name-is-sam!', 'sam'));
    assert.equal(passwordProblem('correct horse battery', 'sam'), null);
  });
  test('recovery codes are forgiving about format', () => {
    assert.equal(normCode(' K7M2 9XQA '), 'k7m2-9xqa');
    assert.equal(normCode('k7m29xqa'), 'k7m2-9xqa');
  });
  test('device names', () => {
    assert.equal(device('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36'), 'Chrome on Windows');
    assert.equal(device('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17 Mobile Safari/604.1'), 'Safari on iOS');
  });
  test('blocked words match whole words only', () => {
    assert.equal(filterHit('you are a SCAMMER!', ['scammer']), 'scammer');
    assert.equal(filterHit('scammers everywhere', ['scammer']), null);
  });
});

describe('accounts and devices', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  test('sign-up hands out 8 recovery codes, once', async () => {
    const c = client(s.base);
    const r = await c.register('coder');
    assert.equal(r.codes.length, 8);
    assert.match(r.codes[0], /^[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.equal((await c.call('/api/account')).codesLeft, 8);
    assert.equal((await c.call('/api/account')).codes, undefined, 'never shown again');
  });

  test('a recovery code resets the password and signs out everywhere', async () => {
    const a = client(s.base);
    const { codes } = await a.register('forgetful');
    const other = client(s.base);
    await other.login('forgetful', a.password);
    assert.equal((await client(s.base).call('/api/auth/recover', { name: 'forgetful', code: 'aaaa-bbbb', password: 'brand new secret' })).status, 401);
    const fresh = client(s.base);
    const r = await fresh.call('/api/auth/recover', { name: 'forgetful', code: codes[3].toUpperCase(), password: 'brand new secret' });
    assert.equal(r.status, 200);
    assert.equal(r.left, 7);
    assert.equal((await other.call('/api/me')).me, null, 'old sessions are gone');
    assert.equal((await client(s.base).login('forgetful', 'brand new secret')).status, 200);
    const reuse = await client(s.base).call('/api/auth/recover', { name: 'forgetful', code: codes[3], password: 'another new one' });
    assert.equal(reuse.status, 401, 'each code works once');
  });

  test('changing the password signs out other devices only', async () => {
    const a = client(s.base), b = client(s.base);
    await a.register('changer');
    await b.login('changer', a.password);
    assert.equal((await a.call('/api/account/password', { current: 'wrong', next: 'x' })).status, 401);
    assert.equal((await a.call('/api/account/password', { current: a.password, next: 'password123' })).status, 400);
    assert.equal((await a.call('/api/account/password', { current: a.password, next: 'a much better one' })).ok, true);
    assert.equal((await a.call('/api/me')).me.name, 'changer');
    assert.equal((await b.call('/api/me')).me, null);
  });

  test('devices: list and sign out one', async () => {
    const a = client(s.base), b = client(s.base);
    await a.register('multi');
    await b.login('multi', a.password);
    const list = (await a.call('/api/account/sessions')).sessions;
    assert.equal(list.length, 2);
    assert.equal(list.filter((x) => x.current).length, 1);
    const other = list.find((x) => !x.current);
    assert.equal((await a.call('/api/account/sessions/revoke', { id: other.id })).ok, true);
    assert.equal((await b.call('/api/me')).me, null);
    assert.equal((await a.call('/api/account/sessions')).sessions.length, 1);
  });

  test('five wrong passwords lock sign-in for a while', async () => {
    const a = client(s.base);
    await a.register('lockme');
    for (let i = 0; i < 5; i++) assert.equal((await client(s.base).login('lockme', 'nope nope')).status, 401);
    assert.equal((await client(s.base).login('lockme', a.password)).status, 429);
  });

  test('deleting an account removes it and holds the name', async () => {
    const a = client(s.base);
    await a.register('leaving');
    await a.say('bye all');
    assert.equal((await a.call('/api/account/delete', { password: 'wrong' })).status, 401);
    assert.equal((await a.call('/api/account/delete', { password: a.password })).ok, true);
    assert.equal((await a.call('/api/me')).me, null);
    assert.equal((await client(s.base).login('leaving', a.password)).status, 401);
    assert.equal((await client(s.base).register('Leaving')).status, 409, 'name held for 30 days');
    const live = await stream(s.base);
    const hello = await live.next('hello');
    assert.ok(!hello.data.history.some((m) => m.name === 'leaving'), 'their messages are gone');
    live.close();
  });

  test('the honeypot field stops bots', async () => {
    const r = await client(s.base).call('/api/auth/register', { name: 'botty', password: 'a good password', website: 'http://spam' });
    assert.equal(r.status, 400);
    assert.equal((await client(s.base).login('botty', 'a good password')).status, 401);
  });

  test('public profiles', async () => {
    const p = await client(s.base).call('/api/user/coder');
    assert.equal(p.name, 'coder');
    assert.ok(p.created);
    assert.equal(p.hash, undefined);
    assert.equal(p.salt, undefined);
    assert.equal((await client(s.base).call('/api/user/nobody_here')).status, 404);
  });
});

describe('web security', () => {
  let s;
  before(async () => { s = await start({ limits: { signups: 2, auth: 1000 } }); });
  after(() => s.stop());

  test('pages carry security headers', async () => {
    const r = await fetch(s.base + '/');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS on plain http');
    const https = await fetch(s.base + '/', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.headers.get('strict-transport-security'), /max-age=/);
  });

  test('writes from another site are refused', async () => {
    const evil = client(s.base, { origin: 'https://evil.example' });
    assert.equal((await evil.register('victim')).status, 403);
    const same = client(s.base, { origin: s.base });
    assert.equal((await same.register('sameorigin')).status, 200);
  });

  test('session cookies are HttpOnly, SameSite, and Secure over https', async () => {
    const r = await fetch(s.base + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ater': '1', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ name: 'cookiecheck', password: 'a good password' }),
    });
    const c = r.headers.get('set-cookie');
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
  });

  test('sign-ups per address are limited', async () => {
    const r = await client(s.base).register('onetoomany');
    assert.equal(r.status, 429);
  });
});

describe('moderation', () => {
  let s, host, fan, rude, live;
  before(async () => {
    s = await start();
    host = client(s.base); await host.register('Host');
    fan = client(s.base); await fan.register('fan');
    rude = client(s.base); await rude.register('rude');
    live = await stream(s.base, host.cookie);
    await live.next('hello');
  });
  after(async () => { live.close(); await s.stop(); });

  test('new accounts can’t post links, moderators can', async () => {
    assert.match((await fan.say('look https://example.com/x')).error, /New accounts/);
    assert.match((await fan.say('go to scam.xyz now')).error, /New accounts/);
    assert.equal((await host.say('schedule: https://example.com/s')).ok, true);
  });

  test('blocked words', async () => {
    assert.equal((await fan.say('/filter add badword')).status, 400, 'mods only');
    assert.equal((await host.say('/filter add badword')).ok, true);
    await pause();
    assert.match((await fan.say('this is a badword here')).error, /blocked word/);
    assert.match((await host.say('/filter list')).info, /badword/);
  });

  test('reports reach the mod queue and can be resolved', async () => {
    await pause();
    await rude.say('something nasty');
    const m = await live.next('msg', (x) => x.text === 'something nasty');
    assert.match((await rude.call('/api/report', { id: m.data.id })).error, /yourself/);
    assert.equal((await fan.call('/api/report', { id: m.data.id, reason: 'rude' })).ok, true);
    assert.match((await fan.call('/api/report', { id: m.data.id })).info, /already/);
    await live.next('modqueue', (q) => q.reports === 1);
    assert.equal((await fan.call('/api/mod/reports')).status, 403);
    const list = (await host.call('/api/mod/reports')).reports;
    assert.equal(list.length, 1);
    assert.equal(list[0].msg.text, 'something nasty');
    assert.equal((await host.call('/api/mod/reports/resolve', { id: list[0].id, action: 'delete' })).ok, true);
    await live.next('del', (d) => d.id === m.data.id);
    await live.next('modqueue', (q) => q.reports === 0);
    assert.equal((await host.call('/api/mod/reports')).reports.length, 0);
  });

  test('every moderator action lands in the mod log', async () => {
    await host.say('/mute rude 1m');
    await pause(300);
    const log = (await host.call('/api/mod/log')).log;
    const acts = log.map((e) => e.act);
    assert.ok(acts.includes('mute'));
    assert.ok(acts.includes('report:delete'));
    assert.ok(acts.includes('filter:add'));
    assert.equal(log[0].by, 'Host');
    assert.equal((await fan.call('/api/mod/log')).status, 403);
  });

  test('a new moderator hears about it straight away', async () => {
    const fanLive = await stream(s.base, fan.cookie);
    await fanLive.next('hello');
    await host.say('/mod fan');
    const me = await fanLive.next('me');
    assert.equal(me.data.me.mod, true);
    await fanLive.next('modqueue');
    fanLive.close();
  });
});
