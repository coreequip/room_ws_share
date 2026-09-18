import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signaling } from '../js/signaling.js';

function createFakeRoom() {
  const listeners = {};
  const drone = { published: [], publish(msg) { drone.published.push(msg); } };
  return {
    name: 'room-1',
    members: ['client-a', 'client-b'],
    drone,
    on(event, cb) {
      (listeners[event] ||= []).push(cb);
    },
    emit(event, ...args) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
  };
}

test('Signaling emits "offer" only when a share-offer is addressed to the local client', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const received = [];
  signaling.on('offer', (payload) => received.push(payload));

  room.emit('message', { type: 'share-offer', to: 'client-b', stream_id: 's1', sdp: {} }, { client_id: 'client-c' });
  room.emit('message', { type: 'share-offer', to: 'client-a', stream_id: 's1', sdp: { x: 1 } }, { client_id: 'client-c' });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { from: 'client-c', streamId: 's1', sdp: { x: 1 } });
});

test('Signaling emits "stop" for any share-stop regardless of addressing', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const received = [];
  signaling.on('stop', (payload) => received.push(payload));

  room.emit('message', { type: 'share-stop', stream_id: 's1' }, { client_id: 'client-c' });

  assert.deepEqual(received, [{ from: 'client-c', streamId: 's1' }]);
});

test('sendOffer publishes an addressed share-offer message via drone.publish', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');

  signaling.sendOffer('client-b', 's1', { type: 'offer' });

  assert.deepEqual(room.drone.published, [
    { room: 'room-1', message: { type: 'share-offer', to: 'client-b', stream_id: 's1', sdp: { type: 'offer' } }, no_echo: true },
  ]);
});

test('memberJoin/memberLeave events are forwarded', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const joins = [];
  const leaves = [];
  signaling.on('memberJoin', (id) => joins.push(id));
  signaling.on('memberLeave', (id) => leaves.push(id));

  room.emit('member_join', 'client-z');
  room.emit('member_leave', 'client-b');

  assert.deepEqual(joins, ['client-z']);
  assert.deepEqual(leaves, ['client-b']);
});

test('members event is forwarded with the full member list', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const received = [];
  signaling.on('members', (members) => received.push(members));

  room.emit('members', ['client-a', 'client-b', 'client-c']);

  assert.deepEqual(received, [['client-a', 'client-b', 'client-c']]);
});

test('Signaling emits "restart" only when a share-restart is addressed to the local client', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const received = [];
  signaling.on('restart', (payload) => received.push(payload));

  room.emit('message', { type: 'share-restart', to: 'client-b', stream_id: 's1' }, { client_id: 'client-c' });
  room.emit('message', { type: 'share-restart', to: 'client-a', stream_id: 's1' }, { client_id: 'client-c' });

  assert.deepEqual(received, [{ from: 'client-c', streamId: 's1' }]);
});

test('sendRestart publishes an addressed share-restart message', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');

  signaling.sendRestart('client-b', 's1');

  assert.deepEqual(room.drone.published, [
    { room: 'room-1', message: { type: 'share-restart', to: 'client-b', stream_id: 's1' }, no_echo: true },
  ]);
});

test('Signaling emits validated presence broadcasts from other clients only', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const received = [];
  signaling.on('presence', (payload) => received.push(payload));

  room.emit('message', { type: 'presence', name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: true, hello: true }, { client_id: 'client-b' });
  room.emit('message', { type: 'presence', name: 'x', browser: 'Brave', os: 'macOS' }, { client_id: 'client-c' });
  room.emit('message', { type: 'presence', name: 'Myself', browser: 'Brave', os: 'macOS' }, { client_id: 'client-a' });

  assert.deepEqual(received, [
    { from: 'client-b', name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: true, hello: true },
  ]);
});

test('sendPresence broadcasts the local presence, flagged as hello on request', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  const presence = { name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: false };

  signaling.sendPresence(presence, { hello: true });
  signaling.sendPresence(presence);

  assert.deepEqual(room.drone.published.map((entry) => entry.message), [
    { type: 'presence', ...presence, hello: true },
    { type: 'presence', ...presence, hello: false },
  ]);
  assert.equal(room.drone.published[0].no_echo, true);
});

test('Signaling forwards the room open event so presence can be re-announced', () => {
  const room = createFakeRoom();
  const signaling = new Signaling(room, 'client-a');
  let opened = 0;
  signaling.on('open', () => { opened += 1; });

  room.emit('open');
  room.emit('open');

  assert.equal(opened, 2);
});
