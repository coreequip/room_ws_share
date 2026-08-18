import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryPolicy } from '../js/recovery.js';

// The policy is the only thing standing between a broken connection and a
// restart storm: it waits out short outages that heal by themselves, and it
// refuses to fire again before the cooldown has passed.
function entry(healthy, overrides = {}) {
  return { peerId: 'sharer', streamId: 'stream-1', healthy, ...overrides };
}

test('RecoveryPolicy stays quiet while the connection is healthy', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });

  const due = [0, 1000, 60000].map((at) => {
    clock = at;
    return policy.update([entry(true)]);
  });

  assert.deepEqual(due.flat(), []);
});

test('RecoveryPolicy waits out an outage shorter than the grace period', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });
  policy.update([entry(false)]);

  clock = 4000;
  const due = policy.update([entry(false)]);
  clock = 4500;
  const recovered = policy.update([entry(true)]);

  assert.deepEqual(due, []);
  assert.deepEqual(recovered, []);
});

test('RecoveryPolicy asks for a restart once the outage outlasts the grace period', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });
  policy.update([entry(false)]);

  clock = 5000;
  const due = policy.update([entry(false)]);

  assert.deepEqual(due, [{ peerId: 'sharer', streamId: 'stream-1' }]);
});

test('RecoveryPolicy does not ask again before the cooldown has passed', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });
  policy.update([entry(false)]);
  clock = 5000;
  policy.update([entry(false)]);

  clock = 12000;
  const tooSoon = policy.update([entry(false)]);
  clock = 15000;
  const allowed = policy.update([entry(false)]);

  assert.deepEqual(tooSoon, []);
  assert.deepEqual(allowed, [{ peerId: 'sharer', streamId: 'stream-1' }]);
});

test('RecoveryPolicy restarts the grace period after a recovery', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 0, now: () => clock });
  policy.update([entry(false)]);
  clock = 3000;
  policy.update([entry(true)]);

  clock = 6000;
  policy.update([entry(false)]);
  clock = 10000;
  const tooEarly = policy.update([entry(false)]);
  clock = 11000;
  const due = policy.update([entry(false)]);

  assert.deepEqual(tooEarly, []);
  assert.deepEqual(due, [{ peerId: 'sharer', streamId: 'stream-1' }]);
});

test('RecoveryPolicy tracks each connection on its own', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });
  policy.update([entry(false), entry(true, { peerId: 'other' })]);

  clock = 5000;
  const due = policy.update([entry(false), entry(true, { peerId: 'other' })]);

  assert.deepEqual(due, [{ peerId: 'sharer', streamId: 'stream-1' }]);
});

test('RecoveryPolicy forgets connections that are gone', () => {
  let clock = 0;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });
  policy.update([entry(false)]);

  clock = 5000;
  policy.update([]);
  const due = policy.update([entry(false)]);

  assert.deepEqual(due, []);
});

// The sharer answers restart requests from viewers, and several viewers of the
// same stream can ask at once -- the cooldown has to apply there too.
test('RecoveryPolicy.allow lets the first request through and blocks the rest until the cooldown passes', () => {
  let clock = 1000;
  const policy = new RecoveryPolicy({ graceMs: 5000, cooldownMs: 10000, now: () => clock });

  const first = policy.allow('viewer-a', 'stream-1');
  const second = policy.allow('viewer-a', 'stream-1');
  const otherPeer = policy.allow('viewer-b', 'stream-1');
  clock = 11000;
  const afterCooldown = policy.allow('viewer-a', 'stream-1');

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(otherPeer, true);
  assert.equal(afterCooldown, true);
});
