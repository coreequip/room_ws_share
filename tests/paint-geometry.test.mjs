import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVideoContentRect, pointToNormalized, normalizedToPoint } from '../js/paint-geometry.js';

test('computeVideoContentRect returns the full container when the video has no dimensions yet', () => {
  const rect = computeVideoContentRect({ videoWidth: 0, videoHeight: 0 }, { width: 400, height: 200 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 400, height: 200 });
});

test('computeVideoContentRect letterboxes top/bottom when the video is relatively wider than the container', () => {
  const rect = computeVideoContentRect({ videoWidth: 200, videoHeight: 100 }, { width: 200, height: 200 });
  assert.deepEqual(rect, { x: 0, y: 50, width: 200, height: 100 });
});

test('computeVideoContentRect letterboxes left/right when the video is relatively taller than the container', () => {
  const rect = computeVideoContentRect({ videoWidth: 100, videoHeight: 200 }, { width: 200, height: 200 });
  assert.deepEqual(rect, { x: 50, y: 0, width: 100, height: 200 });
});

test('computeVideoContentRect fills the container exactly when the ratios match', () => {
  const rect = computeVideoContentRect({ videoWidth: 320, videoHeight: 180 }, { width: 640, height: 360 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 640, height: 360 });
});

test('pointToNormalized maps a point inside the content rect proportionally', () => {
  const contentRect = { x: 50, y: 0, width: 100, height: 200 };
  assert.deepEqual(pointToNormalized(100, 100, contentRect), { x: 0.5, y: 0.5 });
});

test('pointToNormalized clamps points outside the content rect to 0..1', () => {
  const contentRect = { x: 50, y: 0, width: 100, height: 200 };
  assert.deepEqual(pointToNormalized(-1000, -1000, contentRect), { x: 0, y: 0 });
  assert.deepEqual(pointToNormalized(1000, 1000, contentRect), { x: 1, y: 1 });
});

test('normalizedToPoint maps corners and center of the content rect', () => {
  const contentRect = { x: 50, y: 0, width: 100, height: 200 };
  assert.deepEqual(normalizedToPoint(0, 0, contentRect), { x: 50, y: 0 });
  assert.deepEqual(normalizedToPoint(1, 1, contentRect), { x: 150, y: 200 });
  assert.deepEqual(normalizedToPoint(0.5, 0.5, contentRect), { x: 100, y: 100 });
});

test('pointToNormalized and normalizedToPoint round-trip for points inside the content rect', () => {
  const contentRect = { x: 20, y: 10, width: 300, height: 150 };
  const original = { x: 170, y: 85 };
  const normalized = pointToNormalized(original.x, original.y, contentRect);
  const roundTripped = normalizedToPoint(normalized.x, normalized.y, contentRect);
  assert.ok(Math.abs(roundTripped.x - original.x) < 0.001);
  assert.ok(Math.abs(roundTripped.y - original.y) < 0.001);
});
