import { test } from 'node:test';
import assert from 'node:assert/strict';

// PaintOverlay's constructor is the only part of it that touches the DOM, and
// the state methods exercised below are pure Map bookkeeping. Stubbing just
// createElement lets them be tested in Node without a full DOM. A detached
// overlay never schedules animation frames (_ensureLoop returns early while
// this.video is null), so no requestAnimationFrame stub is needed.
function recordingContext() {
  const calls = [];
  const alphas = []; // every value assigned to globalAlpha, in order
  const record = (name) => (...args) => calls.push({ name, args });
  const ctx = {
    calls,
    alphas,
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fill: record('fill'),
    clearRect: record('clearRect'),
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    set(value) { alphas.push(value); },
    get() { return alphas.length ? alphas[alphas.length - 1] : 1; },
  });
  return ctx;
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

// The screenshot draws the same strokes into a different canvas at the video's
// native resolution, so the drawing logic has to work against any context and
// any content rect -- not just the overlay's own.
test('renderInto draws the strokes into a foreign context', () => {
  const overlay = new PaintOverlay();
  overlay.startStroke('peer-a', 's1', 0.1, 0.1);
  overlay.addStrokePoint('peer-a', 's1', 0.9, 0.9);
  const target = recordingContext();

  overlay.renderInto(target, { x: 0, y: 0, width: 1920, height: 1080 }, { alpha: 1 });

  const lineTo = target.calls.find((call) => call.name === 'lineTo');
  assert.deepEqual(lineTo.args, [1728, 972]);
  assert.equal(overlay.ctx.calls.length, 0);
});

test('renderInto honours the alpha override for strokes that were already fading', () => {
  const overlay = new PaintOverlay();
  overlay.startStroke('peer-a', 's1', 0, 0);
  overlay.addStrokePoint('peer-a', 's1', 1, 1);
  overlay.lastActivityAt = performance.now() - 5500; // half faded on screen
  const target = recordingContext();

  overlay.renderInto(target, { x: 0, y: 0, width: 100, height: 100 }, { alpha: 1 });

  // Without the override this would have been drawn at ~0.5.
  assert.equal(target.alphas[0], 1);
});

test('renderInto can leave the live cursors out', () => {
  const overlay = new PaintOverlay();
  overlay.setCursor('peer-a', 0.5, 0.5);
  const target = recordingContext();

  overlay.renderInto(target, { x: 0, y: 0, width: 100, height: 100 }, { alpha: 1, withCursors: false });

  assert.equal(target.calls.some((call) => call.name === 'arc'), false);
});

test('renderInto draws the cursors when asked to', () => {
  const overlay = new PaintOverlay();
  overlay.setCursor('peer-a', 0.5, 0.5);
  const target = recordingContext();

  overlay.renderInto(target, { x: 0, y: 0, width: 100, height: 100 }, { alpha: 1 });

  assert.equal(target.calls.some((call) => call.name === 'arc'), true);
});

// A 3px line looks right on a 1280px-wide stage and vanishes in a 2560px
// screenshot. The stroke has to grow with the surface it is drawn on.
test('renderInto scales the stroke width with the target surface', () => {
  const overlay = new PaintOverlay();
  overlay.startStroke('peer-a', 's1', 0, 0);
  overlay.addStrokePoint('peer-a', 's1', 1, 1);
  const target = recordingContext();

  overlay.renderInto(target, { x: 0, y: 0, width: 2560, height: 1440 }, { alpha: 1, scale: 2 });

  assert.equal(target.lineWidth, 6);
});

test('renderInto scales the cursor with the target surface', () => {
  const overlay = new PaintOverlay();
  overlay.setCursor('peer-a', 0.5, 0.5);
  const target = recordingContext();

  overlay.renderInto(target, { x: 0, y: 0, width: 2560, height: 1440 }, { alpha: 1, scale: 2 });

  const arc = target.calls.find((call) => call.name === 'arc');
  assert.equal(arc.args[2], 12); // cursor radius 6 at scale 1
});
