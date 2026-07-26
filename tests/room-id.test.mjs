import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomId, getRoomIdFromLocation, roomIdToHash } from '../js/room-id.js';

test('generateRoomId returns a 13-character lowercase base36 string', () => {
  const id = generateRoomId();
  assert.match(id, /^[0-9a-z]{13}$/);
});

test('generateRoomId returns different values on subsequent calls', () => {
  assert.notEqual(generateRoomId(), generateRoomId());
});

test('getRoomIdFromLocation extracts the id from a matching hash', () => {
  assert.equal(getRoomIdFromLocation('#ab12cd34ef56a'), 'ab12cd34ef56a');
});

test('getRoomIdFromLocation returns null for a non-matching hash', () => {
  assert.equal(getRoomIdFromLocation('#/room/ab12cd34ef56a'), null);
  assert.equal(getRoomIdFromLocation(''), null);
});

test('roomIdToHash builds the expected hash', () => {
  assert.equal(roomIdToHash('ab12cd34ef56a'), '#ab12cd34ef56a');
});
