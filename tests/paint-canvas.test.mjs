import { test } from 'node:test';
import assert from 'node:assert/strict';

// PaintOverlay's constructor is the only part of it that touches the DOM, and
// the state methods exercised below are pure Map bookkeeping. Stubbing just
// createElement lets them be tested in Node without a full DOM. A detached
// overlay never schedules animation frames (_ensureLoop returns early while
// this.video is null), so no requestAnimationFrame stub is needed.
function recordingContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fill: record('fill'),
    clearRect: record('clearRect'),
  };
}

globalThis.document = { createElement: () => ({ className: '', getContext: () => recordingContext() }) };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const fakeVideo = () => ({ videoWidth: 100, videoHeight: 100 });
const fakeContainer = () => ({ appendChild() {} });

const { strokeAlpha, PaintOverlay } = await import('../js/paint-canvas.js');

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

test('removeCursor drops the peer cursor but leaves its strokes to fade out', () => {
  const overlay = new PaintOverlay();
  overlay.setCursor('peer-a', 0.1, 0.2);
  overlay.startStroke('peer-a', 's1', 0.1, 0.2);

  overlay.removeCursor('peer-a');

  assert.equal(overlay.cursors.has('peer-a'), false);
  assert.equal(overlay.strokes.has('peer-a:s1'), true);
});

test('strokes drawn long ago stay while drawing continues', () => {
  const overlay = new PaintOverlay();
  overlay.startStroke('peer-a', 'old', 0, 0);
  overlay.startStroke('peer-a', 'fresh', 0.5, 0.5);
  // Old enough that per-stroke ageing would have discarded it long ago...
  overlay.strokes.get('peer-a:old').lastUpdate = performance.now() - 10000;
  overlay.lastActivityAt = 20000; // ...but the 'fresh' stroke just landed.

  overlay._prune(24000); // 4s of quiet -- still inside the shared fade window

  assert.equal(overlay.strokes.size, 2);
});

test('every stroke is dropped together once drawing has paused long enough', () => {
  const overlay = new PaintOverlay();
  overlay.startStroke('peer-a', 'first', 0, 0);
  overlay.startStroke('peer-b', 'second', 0.5, 0.5);
  overlay.lastActivityAt = 20000;

  overlay._prune(26001); // past fade start (5s) + fade duration (1s)

  assert.equal(overlay.strokes.size, 0);
});

test('adding to a stroke restarts the shared fade timer', () => {
  const overlay = new PaintOverlay();
  overlay.startStroke('peer-a', 's1', 0, 0);
  overlay.lastActivityAt = 0;

  overlay.addStrokePoint('peer-a', 's1', 0.1, 0.1);

  assert.notEqual(overlay.lastActivityAt, 0);
});

test('a stroke of a single point is drawn as a dot', () => {
  const overlay = new PaintOverlay();
  const contentRect = { x: 0, y: 0, width: 100, height: 100 };

  overlay._drawStroke({ peerId: 'peer-a', points: [{ x: 0.5, y: 0.5 }] }, contentRect, 1);

  // A path of one moveTo has zero length, so stroke() paints nothing at all --
  // a click without drag has to become an explicit filled dot instead.
  assert.equal(overlay.ctx.calls.some((call) => call.name === 'arc'), true);
});

test('handles() is true only for the stream the overlay is attached to', () => {
  const overlay = new PaintOverlay();
  overlay.attach(fakeVideo(), fakeContainer(), 'stream-1');

  assert.equal(overlay.handles('stream-1'), true);
  assert.equal(overlay.handles('stream-2'), false);
});

test('handles() is false while the overlay is detached', () => {
  const overlay = new PaintOverlay();
  overlay.attach(fakeVideo(), fakeContainer(), 'stream-1');

  overlay.detach();

  assert.equal(overlay.handles('stream-1'), false);
});

test('removeCursor leaves other peers cursors untouched', () => {
  const overlay = new PaintOverlay();
  overlay.setCursor('peer-a', 0.1, 0.2);
  overlay.setCursor('peer-b', 0.3, 0.4);

  overlay.removeCursor('peer-a');

  assert.equal(overlay.cursors.has('peer-b'), true);
});
