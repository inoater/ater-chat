'use strict';
/* Sign in with Google/Twitch/Kick, against a fake provider that behaves like the real ones. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { start, client } = require('./helpers');

function fakeProvider() {
  const seen = { tokens: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const f = new URLSearchParams(body);
        seen.tokens.push(Object.fromEntries(f));
        if (f.get('client_secret') !== 'sec' || !f.get('code').startsWith('good')) { res.writeHead(400); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'AT-' + f.get('code') }));
      });
      return;
    }
    if (url.pathname === '/user') {
      const code = String(req.headers.authorization || '').replace('Bearer AT-', '');
      const who = { 'good-1': { sub: 'g-111', given_name: 'Tester Person' }, 'good-2': { sub: 'g-222', given_name: 'Second' } }[code];
      res.writeHead(who ? 200 : 401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(who || {}));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

/** Run start + callback like a browser would, returning where we end up. */
async function signInVia(s, c, code, mode = 'login') {
  const r1 = await fetch(s.base + '/api/auth/oauth/google/start' + (mode === 'link' ? '?mode=link' : ''), { redirect: 'manual', headers: c.cookie ? { cookie: c.cookie } : {} });
  assert.equal(r1.status, 302);
  const to = new URL(r1.headers.get('location'));
  const state = to.searchParams.get('state');
  const flowCookie = r1.headers.get('set-cookie').split(';')[0];
  const cookie = [c.cookie, flowCookie].filter(Boolean).join('; ');
  const r2 = await fetch(s.base + '/api/auth/oauth/google/callback?' + new URLSearchParams({ code, state }), { redirect: 'manual', headers: { cookie } });
  const set = r2.headers.getSetCookie ? r2.headers.getSetCookie() : [r2.headers.get('set-cookie')];
  const sess = (set || []).map((x) => x.split(';')[0]).find((x) => x.startsWith('ater_s=') && !x.endsWith('='));
  if (sess) c.cookie = sess;
  return { to, back: new URL(r2.headers.get('location'), s.base), status: r2.status };
}

describe('sign in with a provider', () => {
  let s, fake;
  before(async () => {
    fake = await fakeProvider();
    s = await start({ oauth: { google: { clientId: 'cid', clientSecret: 'sec', auth: fake.base + '/auth', token: fake.base + '/token', user: fake.base + '/user' } } });
  });
  after(async () => { await s.stop(); fake.server.close(); });

  test('only configured providers are offered', async () => {
    const me = await client(s.base).call('/api/me');
    assert.deepEqual(me.providers.map((p) => p.id), ['google']);
    const off = await fetch(s.base + '/api/auth/oauth/kick/start', { redirect: 'manual' });
    assert.match(off.headers.get('location'), /oauth=off/);
  });

  test('start sends people to the provider with state and PKCE', async () => {
    const r = await fetch(s.base + '/api/auth/oauth/google/start', { redirect: 'manual' });
    const to = new URL(r.headers.get('location'));
    assert.equal(to.origin + to.pathname, fake.base + '/auth');
    assert.equal(to.searchParams.get('client_id'), 'cid');
    assert.match(to.searchParams.get('redirect_uri'), /\/api\/auth\/oauth\/google\/callback$/);
    assert.ok(to.searchParams.get('state').length > 20);
    assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
    assert.match(r.headers.get('set-cookie'), /^ater_o=.*HttpOnly/);
  });

  test('a callback without the matching browser cookie is refused', async () => {
    const r1 = await fetch(s.base + '/api/auth/oauth/google/start', { redirect: 'manual' });
    const state = new URL(r1.headers.get('location')).searchParams.get('state');
    const r2 = await fetch(s.base + '/api/auth/oauth/google/callback?code=good-1&state=' + state, { redirect: 'manual' });
    assert.match(r2.headers.get('location'), /oauth=error/);
  });

  let first;
  test('a new identity picks a name and gets recovery codes', async () => {
    first = client(s.base);
    const { back } = await signInVia(s, first, 'good-1');
    assert.equal(back.searchParams.get('oauth'), 'new');
    assert.equal(back.searchParams.get('n'), 'TesterPerson');
    const verifierSent = fake.seen.tokens.at(-1).code_verifier;
    assert.ok(verifierSent && verifierSent.length > 20, 'PKCE verifier sent');
    const t = back.searchParams.get('t');
    assert.equal((await first.call('/api/auth/oauth/finish', { t, name: 'ab' })).status, 400);
    const r = await first.call('/api/auth/oauth/finish', { t, name: 'TesterPerson' });
    assert.equal(r.status, 200);
    assert.equal(r.codes.length, 8);
    const acct = await first.call('/api/account');
    assert.equal(acct.hasPassword, false);
    assert.ok(acct.links.google);
    assert.equal((await first.call('/api/auth/oauth/finish', { t, name: 'Another' })).status, 400, 'tokens work once');
  });

  test('a password sign-in explains how this account signs in', async () => {
    const r = await client(s.base).login('TesterPerson', 'anything at all');
    assert.match(r.error, /signs in with Google/);
  });

  test('the same identity signs straight in next time', async () => {
    const c = client(s.base);
    const { back } = await signInVia(s, c, 'good-1');
    assert.equal(back.searchParams.get('oauth'), 'in');
    assert.equal((await c.call('/api/me')).me.name, 'TesterPerson');
  });

  test('linking and unlinking, never leaving zero ways in', async () => {
    assert.match((await first.call('/api/account/unlink', { p: 'google' })).error, /only way/);
    assert.equal((await first.call('/api/account/password', { current: '', next: 'a brand new password' })).ok, true, 'can add a password without one');
    assert.equal((await first.call('/api/account/unlink', { p: 'google' })).ok, true);
    assert.equal((await client(s.base).login('TesterPerson', 'a brand new password')).status, 200);

    const other = client(s.base);
    await other.register('PasswordUser');
    const linked = await signInVia(s, other, 'good-2', 'link');
    assert.equal(linked.back.searchParams.get('oauth'), 'linked');
    assert.ok((await other.call('/api/account')).links.google);
    await first.call('/api/auth/login', { name: 'TesterPerson', password: 'a brand new password' });
    const taken = await signInVia(s, first, 'good-2', 'link');
    assert.equal(taken.back.searchParams.get('oauth'), 'taken', 'one identity, one account');
  });

  test('a provider refusing the code ends with an error, not a crash', async () => {
    const { back } = await signInVia(s, client(s.base), 'bad-code');
    assert.equal(back.searchParams.get('oauth'), 'error');
  });

  test('deleting an account with no password asks for the name instead', async () => {
    const c = client(s.base);
    const { back } = await signInVia(s, c, 'good-1'); // that identity was unlinked above, so it's new again
    assert.equal(back.searchParams.get('oauth'), 'new');
    assert.equal((await c.call('/api/auth/oauth/finish', { t: back.searchParams.get('t'), name: 'GoneSoon' })).status, 200);
    assert.equal((await c.call('/api/account/delete', { confirm: 'someone else' })).status, 401);
    assert.equal((await c.call('/api/account/delete', { confirm: 'gonesoon' })).ok, true);
    const again = await signInVia(s, client(s.base), 'good-1');
    assert.equal(again.back.searchParams.get('oauth'), 'new', 'the identity is free once the account is gone');
  });
});
