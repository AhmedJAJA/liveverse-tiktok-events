// Active-stream cards: broadcaster picture + a direct link to the real broadcast.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine, liveUrlFor, safeStreamerAvatar } from '../src/engine.mjs';

test('live links are built only from a valid handle on a known platform', () => {
  assert.equal(liveUrlFor('tiktok', '@usdplayz'), 'https://www.tiktok.com/@usdplayz/live');
  assert.equal(liveUrlFor('kick', 'Some_Channel'), 'https://kick.com/some_channel');
  for (const bad of ['', 'a b', '../x', 'x?y=1', 'javascript:alert(1)']) assert.equal(liveUrlFor('tiktok', bad), '', bad);
});

test('broadcaster pictures come only from the platform image hosts', () => {
  assert.ok(safeStreamerAvatar('https://p16-sign-va.tiktokcdn.com/a.jpeg'));
  assert.ok(safeStreamerAvatar('https://files.kick.com/images/user/1/profile_image/x.webp'));
  for (const bad of ['http://p16.tiktokcdn.com/a.jpg', 'https://evil.example/a.jpg', 'https://tiktokcdn.com.evil.example/a.jpg', 'data:image/png;base64,xx']) assert.equal(safeStreamerAvatar(bad), '', bad);
});

test('the engine keeps the profile per channel and learns it from the streamer comment', () => {
  const e = new Engine({ lazy: true, notify() {} });
  e.setConnection('connected', 'usdplayz', '', 'tiktok');
  e.setStreamer({ displayName: 'USD Playz', avatar: 'https://p16-sign.tiktokcdn.com/me.jpeg' });
  assert.deepEqual([e.streamer.name, e.streamer.avatar], ['USD Playz', 'https://p16-sign.tiktokcdn.com/me.jpeg']);
  e.setConnection('connecting', 'usdplayz', '', 'tiktok'); // reconnect: same channel keeps its picture
  assert.equal(e.streamer.avatar, 'https://p16-sign.tiktokcdn.com/me.jpeg');
  e.setConnection('connected', 'other', '', 'tiktok'); // another channel: nothing carried over
  assert.equal(e.streamer.avatar, '');
  e.receiveChat({ id: '9', username: 'Other Name', text: 'hello', avatar: 'https://p16.tiktokcdn.com/o.jpeg', handle: 'other', msgId: 'm1' });
  assert.equal(e.streamer.avatar, 'https://p16.tiktokcdn.com/o.jpeg');
  e.receiveChat({ id: '10', username: 'Viewer', text: 'hi', avatar: 'https://p16.tiktokcdn.com/v.jpeg', handle: 'viewer', msgId: 'm2' });
  assert.equal(e.streamer.avatar, 'https://p16.tiktokcdn.com/o.jpeg', 'a viewer never replaces the broadcaster');
});

test('the stream card shows the picture and opens the real broadcast in a new tab, or says the link is missing', () => {
  const js = fs.readFileSync(new URL('../public/home.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(js, /st\.avatarUrl/);
  assert.match(js, /watch\.target = '_blank'; watch\.rel = 'noopener noreferrer'/);
  assert.match(js, /رابط البث غير متوفر حالياً/);
  assert.match(js, /off\.disabled = true/);
  assert.match(server, /displayName: who\.name \|\| handle,\s*avatarUrl: who\.avatar \|\| '', liveUrl: liveUrlFor/);
  assert.match(server, /img-src [^;]*https:\/\/files\.kick\.com/);
});
