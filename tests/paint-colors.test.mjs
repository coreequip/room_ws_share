import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorForPeer } from '../js/paint-colors.js';

const PALETTE = ['#ff6b6b', '#4dabf7', '#82c91e', '#f59f00', '#e64980', '#22b8cf'];

test('colorForPeer is deterministic for the same peer id', () => {
  assert.equal(colorForPeer('peer-abc'), colorForPeer('peer-abc'));
});

test('colorForPeer returns a value from the fixed palette', () => {
  assert.ok(PALETTE.includes(colorForPeer('any-peer-id')));
});

test('colorForPeer can distinguish different peer ids', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `peer-${i}`);
  const colors = new Set(ids.map(colorForPeer));
  assert.ok(colors.size > 1);
});
