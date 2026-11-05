// TikTok reconnects: exponential back-off with a cap and jitter; an offline stream is not retried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, offlineError, permanentError, RETRY, LiveBridge } from '../src/bridge.mjs';

test('back-off grows, is capped, and is jittered within ±20%', () => {
  assert.equal(backoffDelay(1, () => 0.5), RETRY.baseMs);
  assert.equal(backoffDelay(3, () => 0.5), RETRY.baseMs * 4);
  assert.equal(backoffDelay(30, () => 0.5), RETRY.capMs);
  assert.equal(backoffDelay(1, () => 0), RETRY.baseMs * 0.8); assert.equal(backoffDelay(1, () => 1), RETRY.baseMs * 1.2);
});
test('offline and permanent errors stop the retries; the state says why', () => {
  assert.ok(offlineError(new Error('The requested user is offline (UserOfflineError)'))); assert.ok(!offlineError(new Error('socket hang up')));
  assert.ok(permanentError(new Error('User not found'))); assert.ok(!permanentError(new Error('ETIMEDOUT')));
  const seen = [];
  const b = new LiveBridge({ setConnection: (state, u, detail) => seen.push([state, detail]) });
  b.username = 'host'; b.schedule(b.generation, new Error('user is offline'));
  assert.equal(b.retry, null, 'no timer for an offline stream'); assert.equal(seen.at(-1)[0], 'disconnected');
  b.schedule(b.generation, new Error('socket hang up'));
  assert.ok(b.retry, 'a network error is retried'); assert.equal(b.failures, 1); assert.ok(b.retryState().nextAt > Date.now());
  b.disconnect(false); assert.equal(b.retry, null);
});
