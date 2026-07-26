import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStreamId,
  makeOffer,
  makeAnswer,
  makeIce,
  makeStop,
  isAddressedTo,
  isSignalingMessage,
} from '../js/signaling-protocol.js';

test('generateStreamId embeds the client id and produces distinct ids', () => {
  const a = generateStreamId('client-1');
  const b = generateStreamId('client-1');
  assert.match(a, /^client-1-/);
  assert.notEqual(a, b);
});

test('makeOffer/makeAnswer/makeIce build addressed messages carrying the payload', () => {
  assert.deepEqual(makeOffer('peer-2', 'stream-1', { type: 'offer' }), {
    type: 'share-offer', to: 'peer-2', stream_id: 'stream-1', sdp: { type: 'offer' },
  });
  assert.deepEqual(makeAnswer('peer-2', 'stream-1', { type: 'answer' }), {
    type: 'share-answer', to: 'peer-2', stream_id: 'stream-1', sdp: { type: 'answer' },
  });
  assert.deepEqual(makeIce('peer-2', 'stream-1', { candidate: 'x' }), {
    type: 'share-ice', to: 'peer-2', stream_id: 'stream-1', candidate: { candidate: 'x' },
  });
});

test('makeStop builds an unaddressed broadcast message', () => {
  assert.deepEqual(makeStop('stream-1'), { type: 'share-stop', stream_id: 'stream-1' });
  assert.equal('to' in makeStop('stream-1'), false);
});

test('isAddressedTo matches only the given client id', () => {
  const message = makeOffer('peer-2', 'stream-1', {});
  assert.equal(isAddressedTo(message, 'peer-2'), true);
  assert.equal(isAddressedTo(message, 'peer-3'), false);
});

test('isSignalingMessage recognizes known types and rejects everything else', () => {
  assert.equal(isSignalingMessage(makeStop('stream-1')), true);
  assert.equal(isSignalingMessage({ type: 'members' }), false);
  assert.equal(isSignalingMessage(null), false);
});
