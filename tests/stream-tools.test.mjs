// OBS stream tools: countdown, chat draw and the active-chatters wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamTools } from '../src/stream-tools.mjs';

test('countdown: start, pause/resume, stop, bounds', () => {
  let t = 1000; const s = new StreamTools({ now: () => t });
  assert.throws(() => s.command('countdown-start', { seconds: 2 }), /5 ثوان/);
  s.command('countdown-start', { seconds: 60, label: '<b>استراحة</b>' });
  let v = s.snapshot().countdown; assert.equal(v.endsAt, 61_000); assert.equal(v.label, 'bاستراحة/b'); assert.equal(v.running, true);
  t = 11_000; s.command('countdown-pause'); v = s.snapshot().countdown; assert.equal(v.endsAt, null); assert.equal(v.left, 50_000);
  t = 20_000; s.command('countdown-pause'); assert.equal(s.snapshot().countdown.endsAt, 70_000);
  s.command('countdown-stop'); assert.equal(s.snapshot().countdown.endsAt, null);
});

test('draw: only the keyword enters, once per viewer; the winner is one of them; a redraw picks someone else', () => {
  const s = new StreamTools({ random: (n) => n - 1 });
  assert.throws(() => s.command('draw-pick'), /لا يوجد/);
  s.command('draw-open', { keyword: 'سحب' });
  s.chat({ id: 'a', username: 'ليلى', text: 'سحب' });
  s.chat({ id: 'a', username: 'ليلى', text: 'سحب' });
  s.chat({ id: 'b', username: 'عمر', text: 'مرحبا' });
  s.chat({ id: 'c', username: 'سارة', text: ' سَحب ', avatar: 'javascript:x' });
  let d = s.snapshot().draw; assert.equal(d.count, 2); assert.equal(d.recent[0].avatar, '');
  s.command('draw-pick'); d = s.snapshot().draw;
  assert.equal(d.winner.name, 'سارة'); assert.equal(d.open, false);
  s.chat({ id: 'z', username: 'متأخر', text: 'سحب' }); assert.equal(s.snapshot().draw.count, 2, 'closed after the draw');
  s.command('draw-pick'); assert.equal(s.snapshot().draw.winner.name, 'ليلى');
  s.command('draw-reset'); assert.equal(s.snapshot().draw.count, 0);
  assert.throws(() => s.command('draw-open', { keyword: '  ' }), /كلمة/);
});

test('wall: most recent chatters first, with message counts; can be paused and cleared', () => {
  const s = new StreamTools();
  for (let i = 0; i < 15; i++) s.chat({ id: 'u' + i, username: 'م' + i, text: 'hi' });
  s.chat({ id: 'u3', username: 'م3', text: 'again' });
  const w = s.snapshot().wall;
  assert.equal(w.chatters.length, 12); assert.deepEqual([w.chatters[0].name, w.chatters[0].count], ['م3', 2]);
  s.command('wall', { on: false }); s.chat({ id: 'new', username: 'جديد', text: 'x' });
  assert.ok(!s.snapshot().wall.chatters.some((p) => p.name === 'جديد'));
  s.command('wall', { on: true, clear: true }); assert.equal(s.snapshot().wall.chatters.length, 0);
  assert.throws(() => s.command('nope'), /غير معروفة/);
});
