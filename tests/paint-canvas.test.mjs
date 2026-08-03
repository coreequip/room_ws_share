import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokeAlpha } from '../js/paint-canvas.js';

test('strokeAlpha is fully opaque before the fade window starts', () => {
  assert.equal(strokeAlpha(0), 1);
  assert.equal(strokeAlpha(4999), 1);
});

test('strokeAlpha ramps down linearly during the fade window', () => {
  assert.equal(strokeAlpha(5000), 1);
  assert.equal(strokeAlpha(5500), 0.5);
  assert.equal(strokeAlpha(6000), 0);
});

test('strokeAlpha never goes negative after the fade window ends', () => {
  assert.equal(strokeAlpha(10000), 0);
});
