import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog, StreamHealthTracker, formatDiagnosticsReport } from '../js/diagnostics.js';

// The log has to survive a whole session without growing without bound, and the
// interesting entries are always the most recent ones -- so old entries are the
// ones that get dropped.
test('EventLog keeps entries in insertion order with a timestamp', () => {
  let clock = 1000;
  const log = new EventLog({ now: () => clock });

  log.add('state', { peerId: 'a', state: 'connected' });
  clock = 2500;
  log.add('state', { peerId: 'a', state: 'disconnected' });

  assert.deepEqual(log.entries(), [
    { at: 1000, kind: 'state', detail: { peerId: 'a', state: 'connected' } },
    { at: 2500, kind: 'state', detail: { peerId: 'a', state: 'disconnected' } },
  ]);
});

test('EventLog drops the oldest entries once the limit is reached', () => {
  const log = new EventLog({ limit: 3, now: () => 0 });

  for (const state of ['one', 'two', 'three', 'four']) log.add('state', { state });

  assert.deepEqual(log.entries().map((entry) => entry.detail.state), ['two', 'three', 'four']);
});

test('EventLog defaults the detail to an empty object', () => {
  const log = new EventLog({ now: () => 42 });

  log.add('poll-stopped');

  assert.deepEqual(log.entries(), [{ at: 42, kind: 'poll-stopped', detail: {} }]);
});

// StreamHealthTracker turns a series of stats snapshots into the two failure
// modes we need to tell apart: bytes still arriving but no frames coming out of
// the decoder (a black picture on a live connection), versus no bytes at all (a
// dead transport). Screen sharing is bursty -- a static screen legitimately
// produces no traffic for a moment -- so a verdict only counts after several
// consecutive samples agree.
function summary(overrides = {}) {
  return { peerId: 'sharer', streamId: 'stream-1', direction: 'inbound', bytes: 0, frames: 0, ...overrides };
}

test('StreamHealthTracker reports nothing while bytes and frames both advance', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 3 });

  const changes = [1, 2, 3, 4].map((n) => tracker.update([summary({ bytes: n * 1000, frames: n * 10 })]));

  assert.deepEqual(changes.flat(), []);
});

test('StreamHealthTracker reports "stalled" once bytes advance without frames for the full window', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 3 });
  tracker.update([summary({ bytes: 1000, frames: 10 })]);

  const first = tracker.update([summary({ bytes: 2000, frames: 10 })]);
  const second = tracker.update([summary({ bytes: 3000, frames: 10 })]);
  const third = tracker.update([summary({ bytes: 4000, frames: 10 })]);

  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.deepEqual(third, [{ peerId: 'sharer', streamId: 'stream-1', direction: 'inbound', from: 'ok', to: 'stalled' }]);
});

test('StreamHealthTracker reports "silent" when no bytes arrive at all', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 2 });
  tracker.update([summary({ bytes: 1000, frames: 10 })]);

  tracker.update([summary({ bytes: 1000, frames: 10 })]);
  const changes = tracker.update([summary({ bytes: 1000, frames: 10 })]);

  assert.deepEqual(changes, [{ peerId: 'sharer', streamId: 'stream-1', direction: 'inbound', from: 'ok', to: 'silent' }]);
});

test('StreamHealthTracker reports the recovery back to "ok" on the very next healthy sample', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 2 });
  tracker.update([summary({ bytes: 1000, frames: 10 })]);
  tracker.update([summary({ bytes: 2000, frames: 10 })]);
  tracker.update([summary({ bytes: 3000, frames: 10 })]);

  const changes = tracker.update([summary({ bytes: 4000, frames: 20 })]);

  assert.deepEqual(changes, [{ peerId: 'sharer', streamId: 'stream-1', direction: 'inbound', from: 'stalled', to: 'ok' }]);
});

test('StreamHealthTracker does not report a stall interrupted by a healthy sample', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 3 });
  tracker.update([summary({ bytes: 1000, frames: 10 })]);
  tracker.update([summary({ bytes: 2000, frames: 10 })]);
  tracker.update([summary({ bytes: 3000, frames: 20 })]);

  const changes = tracker.update([summary({ bytes: 4000, frames: 20 })]);

  assert.deepEqual(changes, []);
});

test('StreamHealthTracker forgets connections that stop being reported', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 2 });
  tracker.update([summary({ bytes: 1000, frames: 10 })]);
  tracker.update([summary({ bytes: 2000, frames: 10 })]);
  tracker.update([summary({ bytes: 3000, frames: 10 })]);

  tracker.update([]);
  const changes = tracker.update([summary({ bytes: 4000, frames: 10 })]);

  assert.deepEqual(changes, []);
});

test('StreamHealthTracker tracks each connection separately', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 2 });
  const healthy = (n) => summary({ peerId: 'other', bytes: n * 1000, frames: n * 10 });
  tracker.update([summary({ bytes: 1000, frames: 10 }), healthy(1)]);
  tracker.update([summary({ bytes: 2000, frames: 10 }), healthy(2)]);

  const changes = tracker.update([summary({ bytes: 3000, frames: 10 }), healthy(3)]);

  assert.deepEqual(changes, [{ peerId: 'sharer', streamId: 'stream-1', direction: 'inbound', from: 'ok', to: 'stalled' }]);
});

// The report travels from the person hitting the bug to whoever debugs it, so
// it stays untranslated on purpose: two participants on differently localized
// browsers should produce reports that can be diffed against each other.
process.env.TZ = 'UTC';

test('formatDiagnosticsReport names the generation time and the browser', () => {
  const report = formatDiagnosticsReport({
    events: [],
    stats: [],
    generatedAt: Date.UTC(2026, 7, 18, 14, 32, 10),
    userAgent: 'Mozilla/5.0 (Macintosh) Firefox/141.0',
  });

  assert.match(report, /^roomshare diagnostics\n/);
  assert.match(report, /generated: 2026-08-18 14:32:10\n/);
  assert.match(report, /userAgent: Mozilla\/5\.0 \(Macintosh\) Firefox\/141\.0\n/);
});

test('formatDiagnosticsReport lists every stats field of every connection', () => {
  const report = formatDiagnosticsReport({
    events: [],
    stats: [{ peerId: 'abc', streamId: 'abc-1', connectionState: 'connected', bitrateKbps: 850, framesPerSecond: undefined }],
    generatedAt: 0,
    userAgent: 'x',
  });

  assert.match(report, /connections \(1\):/);
  assert.match(report, /- peerId=abc streamId=abc-1 connectionState=connected bitrateKbps=850\n/);
});

test('formatDiagnosticsReport prints events as a timestamped log', () => {
  const report = formatDiagnosticsReport({
    events: [
      { at: Date.UTC(2026, 7, 18, 14, 29, 1), kind: 'connection-state', detail: { peer: 'abc', value: 'disconnected' } },
      { at: Date.UTC(2026, 7, 18, 14, 29, 4), kind: 'video', detail: { peer: 'abc', value: 'stalled' } },
    ],
    stats: [],
    generatedAt: 0,
    userAgent: 'x',
  });

  assert.match(report, /events \(2\):\n14:29:01 connection-state peer=abc value=disconnected\n14:29:04 video peer=abc value=stalled/);
});

test('formatDiagnosticsReport says so when there is nothing to report', () => {
  const report = formatDiagnosticsReport({ events: [], stats: [], generatedAt: 0, userAgent: 'x' });

  assert.match(report, /connections \(0\):\nnone\n/);
  assert.match(report, /events \(0\):\nnone/);
});

test('StreamHealthTracker exposes the current verdict for one connection', () => {
  const tracker = new StreamHealthTracker({ stallSamples: 2 });
  tracker.update([summary({ bytes: 1000, frames: 10 })]);
  tracker.update([summary({ bytes: 2000, frames: 10 })]);
  tracker.update([summary({ bytes: 3000, frames: 10 })]);

  assert.equal(tracker.stateOf('sharer', 'stream-1'), 'stalled');
  assert.equal(tracker.stateOf('nobody', 'stream-1'), 'ok');
});

test('formatDiagnosticsReport states how often the connection was rebuilt', () => {
  const report = formatDiagnosticsReport({ events: [], stats: [], generatedAt: 0, userAgent: 'x', recoveries: 3 });

  assert.match(report, /recoveries: 3\n/);
});

test('formatDiagnosticsReport lists the room members with their client', () => {
  const report = formatDiagnosticsReport({
    events: [],
    stats: [],
    generatedAt: 0,
    userAgent: 'x',
    members: [{ peer: 'abc12345', name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: true, self: true }, { peer: 'def67890', name: null }],
  });

  assert.match(report, /members \(2\):\n- peer=abc12345 name=Baxter browser=Brave os=macOS sharing=true self=true\n- peer=def67890\n/);
});
