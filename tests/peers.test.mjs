import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerManager } from '../js/peers.js';

// PeerManager only touches RTCPeerConnection when a connection is actually set
// up; broadcastPaint works purely off the paintChannels map, so a fake
// signaling object and hand-placed fake channels are enough to test it.
function makeManager() {
  const signaling = { on: () => {}, members: [], clientId: 'me' };
  return new PeerManager({ stunServers: [], signaling });
}

function fakeChannel(readyState = 'open') {
  return { readyState, sent: [], send(data) { this.sent.push(data); } };
}

test('broadcastPaint relays to every other viewer on the same stream', () => {
  const manager = makeManager();
  const author = fakeChannel();
  const other = fakeChannel();
  manager.paintChannels.set('viewer-a:stream-1', author);
  manager.paintChannels.set('viewer-b:stream-1', other);

  manager.broadcastPaint('stream-1', 'viewer-a', { type: 'cursor', x: 0.5, y: 0.5 });

  assert.equal(author.sent.length, 0);
  assert.deepEqual(JSON.parse(other.sent[0]), { type: 'cursor', x: 0.5, y: 0.5, peer: 'viewer-a' });
});

test('broadcastPaint does not leak across streams', () => {
  const manager = makeManager();
  const sameStream = fakeChannel();
  const otherStream = fakeChannel();
  manager.paintChannels.set('viewer-b:stream-1', sameStream);
  manager.paintChannels.set('viewer-c:stream-2', otherStream);

  manager.broadcastPaint('stream-1', 'viewer-a', { type: 'cursor', x: 0, y: 0 });

  assert.equal(sameStream.sent.length, 1);
  assert.equal(otherStream.sent.length, 0);
});

test('broadcastPaint skips channels that are not open', () => {
  const manager = makeManager();
  const connecting = fakeChannel('connecting');
  manager.paintChannels.set('viewer-b:stream-1', connecting);

  manager.broadcastPaint('stream-1', 'viewer-a', { type: 'cursor', x: 0, y: 0 });

  assert.equal(connecting.sent.length, 0);
});
