'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, stream, pause } = require('./helpers');
const { imageInfo, checkImage } = require('../server/media');

const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('image checks', () => {
  test('reads real sizes and refuses fakes and SVG', () => {
    assert.deepEqual(imageInfo(Buffer.from(PNG1.split(',')[1], 'base64')), { type: 'png', w: 1, h: 1 });
    assert.ok(checkImage('avatar', PNG1).data);
    assert.ok(checkImage('avatar', 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')).error);
    assert.ok(checkImage('avatar', 'data:image/png;base64,' + Buffer.from('nope, not a png file').toString('base64')).error);
    const big = Buffer.alloc(40); Buffer.from(PNG1.split(',')[1], 'base64').copy(big); big.writeUInt32BE(4000, 16);
    assert.match(checkImage('avatar', 'data:image/png;base64,' + big.toString('base64')).error, /at most/);
  });
});

describe('roles and powers', () => {
  let s, admin, mod, helper, fan, other, roleId, live;
  before(async () => {
    s = await start();
    admin = client(s.base); await admin.register('Boss');
    mod = client(s.base); await mod.register('Moddy');
    helper = client(s.base); await helper.register('Helper');
    fan = client(s.base); await fan.register('Fanny');
    other = client(s.base); await other.register('Other');
    await admin.say('/mod Moddy');
    live = await stream(s.base);
    await live.next('hello');
  });
  after(async () => { live.close(); await s.stop(); });

  test('only the admin makes moderators', async () => {
    assert.match((await mod.call('/api/mod/role', { name: 'Fanny', role: 'mod', on: true })).error, /admin/);
    const r = await admin.call('/api/mod/role', { name: 'Other', role: 'mod', on: true });
    assert.equal(r.ok, true);
    assert.equal((await admin.call('/api/mod/role', { name: 'Other', role: 'mod', on: false })).ok, true);
  });

  test('moderators create custom roles with powers and a look', async () => {
    assert.equal((await fan.call('/api/mod/roles/save', { name: 'Nope' })).status, 403);
    const r = await mod.call('/api/mod/roles/save', {
      name: 'Timeouter', look: { kind: 'gradient', c1: '#ff0000', c2: '#00ff00' }, perms: { timeout: true, delete: true, bogus: true }, timeoutMin: 999,
    });
    assert.equal(r.ok, true);
    roleId = r.role.id;
    assert.equal(r.role.timeoutMin, 60, 'capped at an hour');
    assert.deepEqual(Object.keys(r.role.perms).sort(), ['delete', 'timeout']);
    const ev = await live.next('roles', (l) => l.some((x) => x.name === 'Timeouter'));
    assert.equal(ev.data.find((x) => x.id === roleId).look.kind, 'gradient');
    assert.equal((await mod.call('/api/mod/roles/save', { name: 'timeouter' })).status, 409, 'names are unique');
  });

  test('a mod can’t restyle the Admin role; the admin can', async () => {
    assert.equal((await mod.call('/api/mod/roles/save', { id: 'owner', name: 'Admin', look: { kind: 'glow', c1: '#ffffff' } })).status, 403);
    assert.equal((await admin.call('/api/mod/roles/save', { id: 'owner', name: 'Streamer', look: { kind: 'glow', c1: '#ffcc00' } })).ok, true);
  });

  test('a role’s powers work, within their limits', async () => {
    assert.equal((await mod.call('/api/mod/role', { name: 'Helper', role: roleId, on: true })).ok, true);
    const me = await live.next('presence', () => true).catch(() => null); void me;
    assert.match((await helper.say('/mute Fanny 2h')).error, /up to 1h/);
    assert.equal((await helper.say('/mute Fanny 20m')).ok, true);
    assert.match((await helper.say('/mute Moddy 5m')).error, /can’t time out/);
    assert.match((await helper.say('/ban Fanny')).error, /moderators/i);
    assert.equal((await helper.call('/api/mod/roles/save', { name: 'Sneaky' })).status, 403, 'can’t make roles');
    assert.equal((await helper.call('/api/mod/role', { name: 'Other', role: roleId, on: true })).status, 403, 'can’t hand out roles');
    assert.equal((await helper.say('/unmute Fanny')).ok, true);
  });

  test('messages carry the name look and role badges', async () => {
    const png = await mod.call('/api/mod/roles/badge', { id: roleId, data: PNG1 });
    assert.equal(png.ok, true);
    const badge = png.roles.find((r) => r.id === roleId).badge;
    assert.match(badge, /^\/api\/media\/rb-/);
    assert.equal((await fetch(s.base + badge)).headers.get('content-type'), 'image/png');
    await pause();
    await helper.say('styled hello');
    const m = await live.next('msg', (x) => x.text === 'styled hello');
    assert.equal(m.data.r, roleId);
    assert.ok(m.data.b.includes('role:' + roleId));
  });

  test('deleting a role takes it off everyone', async () => {
    assert.equal((await mod.call('/api/mod/roles/delete', { id: roleId })).ok, true);
    assert.equal((await mod.call('/api/mod/roles/delete', { id: 'mod' })).status, 400, 'built-ins stay');
    const prof = await client(s.base).call('/api/user/Helper');
    assert.ok(!prof.roles.includes(roleId));
    assert.match((await helper.say('/mute Fanny 5m')).error, /can’t time/);
  });

  test('an emote editor can add emotes and nothing else', async () => {
    const r = await mod.call('/api/mod/roles/save', { name: 'Emote editor', perms: { emotes: true } });
    await mod.call('/api/mod/role', { name: 'Other', role: r.role.id, on: true });
    assert.equal((await other.call('/api/emote', { name: 'OtherW', data: PNG1 })).ok, true);
    assert.equal((await other.call('/api/emote/remove', { name: 'OtherW' })).ok, true);
    assert.equal((await other.call('/api/pin', { id: 'x' })).status, 403);
    assert.equal((await other.call('/api/mod/overview')).perms.join(), 'emotes');
    assert.equal((await fan.call('/api/mod/overview')).status, 403, 'no powers, no dashboard');
  });

  test('a trusted linker skips the new-account link wait', async () => {
    const r = await mod.call('/api/mod/roles/save', { name: 'Trusted linker', perms: { links: true } });
    assert.match((await fan.say('see https://example.com/a')).error, /New accounts/);
    await mod.call('/api/mod/role', { name: 'Fanny', role: r.role.id, on: true });
    await pause();
    assert.equal((await fan.say('see https://example.com/b')).ok, true);
  });
});

describe('profiles', () => {
  let s, a;
  before(async () => { s = await start(); a = client(s.base); await a.register('Profiled'); });
  after(() => s.stop());

  test('bio, pronouns, colours and a picture', async () => {
    assert.equal((await a.call('/api/account/profile', { accent: 'red' })).status, 400);
    const r = await a.call('/api/account/profile', { bio: 'I like streams\nand <b>tags</b>', pronouns: 'they/them', accent: '#123456', color: '#abcdef' });
    assert.equal(r.ok, true);
    assert.equal((await a.call('/api/account/avatar', { data: 'data:image/png;base64,' + Buffer.from('fake').toString('base64') })).status, 400);
    const av = await a.call('/api/account/avatar', { data: PNG1 });
    assert.match(av.av, /^\/api\/media\/av-profiled\?v=/);
    const p = await client(s.base).call('/api/user/profiled');
    assert.equal(p.bio, 'I like streams\nand <b>tags</b>', 'stored as text, the page shows it as text');
    assert.equal(p.pronouns, 'they/them');
    assert.equal(p.acc, '#123456');
    assert.equal(p.color, '#abcdef');
    assert.equal((await fetch(s.base + p.av)).status, 200);
    assert.equal((await a.call('/api/account/avatar', { clear: true })).ok, true);
    assert.equal((await client(s.base).call('/api/user/profiled')).av, null);
  });
});

describe('direct messages', () => {
  let s, a, b, c, liveB;
  before(async () => {
    s = await start();
    a = client(s.base); await a.register('Alpha');
    b = client(s.base); await b.register('Bravo');
    c = client(s.base); await c.register('Charlie');
    liveB = await stream(s.base, b.cookie);
    await liveB.next('hello');
  });
  after(async () => { liveB.close(); await s.stop(); });

  test('send, arrive live, list, unread, read', async () => {
    assert.equal((await a.call('/api/dm/send', { to: 'Alpha', text: 'me' })).status, 400);
    assert.equal((await a.call('/api/dm/send', { to: 'nobody_x', text: 'hi' })).status, 404);
    assert.equal((await a.call('/api/dm/send', { to: 'Bravo', text: 'hey Bravo' })).ok, true);
    const ev = await liveB.next('dm', (m) => m.text === 'hey Bravo');
    assert.equal(ev.data.from, 'Alpha');
    const list = (await b.call('/api/dm/list')).convs;
    assert.equal(list[0].with.name, 'Alpha');
    assert.equal(list[0].unread, 1);
    assert.equal((await b.call('/api/dm/thread?with=Alpha')).messages.length, 1);
    await b.call('/api/dm/read', { with: 'Alpha' });
    assert.equal((await b.call('/api/dm/list')).convs[0].unread, 0);
  });

  test('works when the other person is offline', async () => {
    await pause();
    assert.equal((await a.call('/api/dm/send', { to: 'Charlie', text: 'for later' })).ok, true);
    assert.equal((await c.call('/api/dm/list')).convs[0].last.text, 'for later');
  });

  test('blocking and "who can message me"', async () => {
    await b.call('/api/account/block', { name: 'Charlie', on: true });
    assert.match((await c.call('/api/dm/send', { to: 'Bravo', text: 'hi' })).error, /isn’t taking messages/);
    await b.call('/api/account/block', { name: 'Charlie', on: false });
    await b.call('/api/account/profile', { dmFrom: 'nobody' });
    await pause();
    assert.match((await c.call('/api/dm/send', { to: 'Bravo', text: 'hi again' })).error, /isn’t taking messages/);
  });

  test('hiding a conversation clears it for you only', async () => {
    await c.call('/api/dm/hide', { with: 'Alpha' });
    assert.equal((await c.call('/api/dm/list')).convs.length, 0);
    assert.equal((await a.call('/api/dm/thread?with=Charlie')).messages.length, 1);
  });
});

describe('rooms, poll history and the dashboard', () => {
  let s, admin, fan, anon, signed;
  before(async () => {
    s = await start();
    admin = client(s.base); await admin.register('Boss');
    fan = client(s.base); await fan.register('fanr');
  });
  after(async () => { anon && anon.close(); signed && signed.close(); await s.stop(); });

  test('moderators add rooms; signed-in-only rooms stay hidden from visitors', async () => {
    assert.equal((await fan.call('/api/mod/rooms/save', { name: 'Nope' })).status, 403);
    const r = await admin.call('/api/mod/rooms/save', { name: 'General', topic: 'anything goes', view: 'signedin' });
    assert.equal(r.room.id, 'general');
    const ann = await admin.call('/api/mod/rooms/save', { name: 'Announcements', post: 'mods' });
    anon = await stream(s.base);
    const h1 = (await anon.next('hello')).data;
    assert.deepEqual(h1.rooms.map((x) => x.id).sort(), ['announcements', 'live']);
    signed = await stream(s.base, fan.cookie);
    const h2 = (await signed.next('hello')).data;
    assert.ok(h2.rooms.some((x) => x.id === 'general'));
    assert.equal((await fan.say('hello general', null)).ok, true);
    await pause();
    const r2 = await fan.call('/api/send', { text: 'in general', room: 'general' });
    assert.equal(r2.ok, true);
    const m = await signed.next('msg', (x) => x.text === 'in general');
    assert.equal(m.data.room, 'general');
    await pause(300);
    assert.ok(!anon.events.some((e) => e.ev === 'msg' && e.data.text === 'in general'), 'visitors don’t get it');
    assert.match((await fan.call('/api/send', { text: 'can I?', room: ann.room.id })).error, /moderators/);
  });

  test('finished polls go to history', async () => {
    await admin.say('/poll 30 Best snack? Chips | Fruit');
    await pause(200);
    await fan.call('/api/vote', { i: 1 });
    await admin.call('/api/poll/end', {});
    await pause(200);
    const polls = (await admin.call('/api/mod/polls')).polls;
    assert.equal(polls[0].q, 'Best snack?');
    assert.equal(polls[0].total, 1);
  });

  test('overview, users, bans and settings', async () => {
    await admin.say('/ban fanr spamming');
    const o = await admin.call('/api/mod/overview');
    assert.equal(o.accounts, 2);
    assert.equal(o.bans, 1);
    const users = await admin.call('/api/mod/users?filter=banned');
    assert.equal(users.users[0].name, 'fanr');
    assert.equal(users.users[0].banned.why, 'spamming');
    assert.equal((await admin.call('/api/mod/bans')).bans.length, 1);
    assert.equal((await admin.call('/api/mod/unban', { name: 'fanr' })).ok, true);
    const st = await admin.call('/api/mod/settings', { slow: 5, linkWait: 0 });
    assert.deepEqual(st.settings, { slow: 5, linkWait: 0 });
  });
});
