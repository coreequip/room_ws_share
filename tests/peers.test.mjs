import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerManager } from '../js/peers.js';

// PeerManager only touches RTCPeerConnection when a connection is actually set
// up; broadcastPaint works purely off the paintChannels map, so a fake
// signaling object and hand-placed fake channels are enough to test it.
function makeManager(callbacks = {}) {
  const signaling = { on: () => {}, members: [], clientId: 'me' };
  return new PeerManager({ resolveIceServers: async () => [], signaling, ...callbacks });
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

// An RTCStatsReport behaves like a Map for everything _summarizeStats does with
// it, so a plain Map is enough to drive the summary without a real connection.
function fakeConnection(stats, states = {}) {
  const report = new Map(stats.map((stat, index) => [stat.id ?? String(index), stat]));
  return {
    connectionState: states.connectionState ?? 'connected',
    iceConnectionState: states.iceConnectionState ?? 'connected',
    getStats: async () => report,
  };
}

test('_summarizeStats reports the counters that tell a decoder stall from a dead transport', async () => {
  const manager = makeManager();
  const pc = fakeConnection([
    { type: 'inbound-rtp', kind: 'video', bytesReceived: 5000, framesDecoded: 120, keyFramesDecoded: 3, freezeCount: 2, framesDropped: 1, pliCount: 7, nackCount: 4, timestamp: 1000 },
  ]);

  const summary = await manager._summarizeStats('sharer', 'stream-1', pc);

  assert.equal(summary.bytes, 5000);
  assert.equal(summary.frames, 120);
  assert.equal(summary.keyFrames, 3);
  assert.equal(summary.freezeCount, 2);
  assert.equal(summary.framesDropped, 1);
  assert.equal(summary.pliCount, 7);
  assert.equal(summary.nackCount, 4);
});

test('_summarizeStats reports encoded frames and sent bytes for an outbound stream', async () => {
  const manager = makeManager();
  const pc = fakeConnection([
    { type: 'outbound-rtp', kind: 'video', bytesSent: 9000, framesEncoded: 240, keyFramesEncoded: 5, pliCount: 2, nackCount: 1, timestamp: 1000 },
  ]);

  const summary = await manager._summarizeStats('viewer', 'stream-1', pc);

  assert.equal(summary.bytes, 9000);
  assert.equal(summary.frames, 240);
  assert.equal(summary.keyFrames, 5);
  assert.equal(summary.pliCount, 2);
  assert.equal(summary.nackCount, 1);
});

test('_summarizeStats includes the ICE connection state alongside the connection state', async () => {
  const manager = makeManager();
  const pc = fakeConnection([], { connectionState: 'disconnected', iceConnectionState: 'checking' });

  const summary = await manager._summarizeStats('sharer', 'stream-1', pc);

  assert.equal(summary.connectionState, 'disconnected');
  assert.equal(summary.iceConnectionState, 'checking');
});

// A remote track going 'mute' is the browser saying "no media is arriving" --
// on a connection that still reports itself as connected, that is exactly the
// black-picture case, so it has to reach the event log.
function fakeTrack() {
  const handlers = {};
  return {
    muted: false,
    addEventListener(type, handler) { handlers[type] = handler; },
    fire(type) { handlers[type](); },
  };
}

test('_wireRemoteTrack reports the remote track muting and unmuting', () => {
  const seen = [];
  const manager = makeManager({ onTrackMuteChange: (peerId, streamId, muted) => seen.push([peerId, streamId, muted]) });
  const track = fakeTrack();

  manager._wireRemoteTrack('sharer', 'stream-1', track);
  track.fire('mute');
  track.fire('unmute');

  assert.deepEqual(seen, [['sharer', 'stream-1', true], ['sharer', 'stream-1', false]]);
});

test('_wireRemoteTrack survives a missing callback', () => {
  const manager = makeManager();
  const track = fakeTrack();

  manager._wireRemoteTrack('sharer', 'stream-1', track);

  assert.doesNotThrow(() => track.fire('mute'));
});

// Rebuilding a connection guarantees stray ICE candidates: the ones the old
// connection was still gathering arrive after the new one exists, and the
// browser rejects them. That must not tear down the connection that just came
// up -- otherwise every recovery immediately undoes itself.
function silenceConsoleError() {
  const original = console.error;
  console.error = () => {};
  return () => { console.error = original; };
}

test('_handleIce keeps the connection when a stale candidate is rejected', async () => {
  const manager = makeManager();
  const pc = { remoteDescription: {}, addIceCandidate: async () => { throw new Error('stale candidate'); }, close: () => {} };
  manager.connections.set('sharer', new Map([['stream-1', pc]]));
  const restore = silenceConsoleError();

  await manager._handleIce('sharer', 'stream-1', { candidate: 'x' });
  restore();

  assert.equal(manager.connections.get('sharer').has('stream-1'), true);
});

test('_flushCandidates applies the remaining candidates after one is rejected', async () => {
  const manager = makeManager();
  const applied = [];
  const pc = {
    addIceCandidate: async (candidate) => {
      if (candidate.candidate === 'bad') throw new Error('stale candidate');
      applied.push(candidate.candidate);
    },
  };
  manager.pendingCandidates.set('sharer:stream-1', [{ candidate: 'bad' }, { candidate: 'good' }]);
  const restore = silenceConsoleError();

  await manager._flushCandidates('sharer', 'stream-1', pc);
  restore();

  assert.deepEqual(applied, ['good']);
});

// A minimal RTCPeerConnection stand-in: enough surface for _createOutgoing to
// run through, and it records the configuration it was constructed with.
function stubPeerConnection(configs) {
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class {
    constructor(config) { configs.push(config); }
    createDataChannel() { return { readyState: 'connecting', send() {} }; }
    addTrack() { return { getParameters: () => ({ encodings: [{}] }), setParameters: async () => {} }; }
    getTransceivers() { return []; }
    async createOffer() { return { type: 'offer' }; }
    async setLocalDescription() {}
    get localDescription() { return { type: 'offer' }; }
    close() {}
  };
  return () => { globalThis.RTCPeerConnection = original; };
}

test('PeerManager builds connections with the ICE servers it resolves at connect time', async () => {
  const configs = [];
  const restore = stubPeerConnection(configs);
  const iceServers = [
    { urls: 'stun:stun.example:19302' },
    { urls: ['turns:turn.room.ws:443?transport=tcp'], username: '999:abc', credential: 'sig' },
  ];
  const manager = new PeerManager({
    resolveIceServers: async () => iceServers,
    signaling: { on: () => {}, members: ['me', 'peer-1'], clientId: 'me', sendOffer: () => {} },
  });

  try {
    await manager.startSharing({ getTracks: () => [] }, 'stream-1');
    assert.equal(configs.length, 1);
    assert.deepEqual(configs[0].iceServers, iceServers);
  } finally {
    restore();
  }
});
