import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStrokeId,
  makeCursor,
  makeStrokeStart,
  makeStrokePoint,
  makeStrokeEnd,
  isPaintMessage,
  parsePaintMessage,
} from '../js/paint-protocol.js';

test('generateStrokeId produces distinct string ids', () => {
  const a = generateStrokeId();
  const b = generateStrokeId();
  assert.notEqual(a, b);
  assert.equal(typeof a, 'string');
});

test('makeCursor/makeStrokeStart/makeStrokePoint/makeStrokeEnd build the expected shapes', () => {
  assert.deepEqual(makeCursor(0.1, 0.2), { type: 'cursor', x: 0.1, y: 0.2 });
  assert.deepEqual(makeStrokeStart('s1', 0.1, 0.2), { type: 'stroke-start', id: 's1', x: 0.1, y: 0.2 });
  assert.deepEqual(makeStrokePoint('s1', 0.3, 0.4), { type: 'stroke-point', id: 's1', x: 0.3, y: 0.4 });
  assert.deepEqual(makeStrokeEnd('s1'), { type: 'stroke-end', id: 's1' });
});

test('isPaintMessage accepts well-formed messages of every known type', () => {
  assert.equal(isPaintMessage(makeCursor(0.1, 0.2)), true);
  assert.equal(isPaintMessage(makeStrokeStart('s1', 0, 0)), true);
  assert.equal(isPaintMessage(makeStrokePoint('s1', 0, 0)), true);
  assert.equal(isPaintMessage(makeStrokeEnd('s1')), true);
});

test('isPaintMessage rejects garbage, unknown types, and missing fields', () => {
  assert.equal(isPaintMessage(null), false);
  assert.equal(isPaintMessage({}), false);
  assert.equal(isPaintMessage({ type: 'members' }), false);
  assert.equal(isPaintMessage({ type: 'cursor', x: 'nope', y: 0.2 }), false);
  assert.equal(isPaintMessage({ type: 'stroke-start', x: 0, y: 0 }), false);
});

test('parsePaintMessage parses valid JSON into a validated message', () => {
  const raw = JSON.stringify(makeCursor(0.5, 0.5));
  assert.deepEqual(parsePaintMessage(raw), { type: 'cursor', x: 0.5, y: 0.5 });
});

test('parsePaintMessage returns null for invalid JSON or invalid shapes', () => {
  assert.equal(parsePaintMessage('not json'), null);
  assert.equal(parsePaintMessage(JSON.stringify({ type: 'members' })), null);
});
