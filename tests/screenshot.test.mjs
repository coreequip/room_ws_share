import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawScreenshot, screenshotFileName, ScreenshotStore } from '../js/screenshot.js';

process.env.TZ = 'UTC';

function fakeCanvas() {
  const calls = [];
  const ctx = {
    calls,
    drawImage: (...args) => calls.push({ name: 'drawImage', args }),
  };
  return { width: 0, height: 0, getContext: () => ctx, ctx };
}

function fakeOverlay() {
  const renders = [];
  return { renders, renderInto: (ctx, rect, options) => renders.push({ ctx, rect, options }) };
}

// The screenshot is a redraw, not a screen grab: the video frame goes in at its
// own resolution, and the strokes are drawn again on top at that scale.
test('drawScreenshot sizes the canvas to the video and draws the frame', () => {
  const canvas = fakeCanvas();
  const video = { videoWidth: 2560, videoHeight: 1440 };

  const captured = drawScreenshot(canvas, video, null, { displayWidth: 1280 });

  assert.equal(captured, true);
  assert.equal(canvas.width, 2560);
  assert.equal(canvas.height, 1440);
  assert.deepEqual(canvas.ctx.calls[0], { name: 'drawImage', args: [video, 0, 0, 2560, 1440] });
});

test('drawScreenshot renders the drawing fully opaque, without cursors, scaled to the frame', () => {
  const canvas = fakeCanvas();
  const overlay = fakeOverlay();

  drawScreenshot(canvas, { videoWidth: 2560, videoHeight: 1440 }, overlay, { displayWidth: 1280 });

  assert.deepEqual(overlay.renders[0].rect, { x: 0, y: 0, width: 2560, height: 1440 });
  assert.deepEqual(overlay.renders[0].options, { alpha: 1, withCursors: false, scale: 2 });
});

test('drawScreenshot falls back to scale 1 when the display width is unknown', () => {
  const overlay = fakeOverlay();

  drawScreenshot(fakeCanvas(), { videoWidth: 1920, videoHeight: 1080 }, overlay, {});

  assert.equal(overlay.renders[0].options.scale, 1);
});

test('drawScreenshot refuses a video that has no frame yet', () => {
  const canvas = fakeCanvas();

  const captured = drawScreenshot(canvas, { videoWidth: 0, videoHeight: 0 }, null, { displayWidth: 800 });

  assert.equal(captured, false);
  assert.equal(canvas.ctx.calls.length, 0);
});

test('screenshotFileName is sortable and free of characters that need escaping', () => {
  assert.equal(screenshotFileName(Date.UTC(2026, 7, 18, 14, 32, 10)), 'roomshare-2026-08-18-143210.png');
});

// Every kept image holds two object URLs alive. Whatever drops an image -- the
// user, the size limit, or leaving the page -- has to release both, or the
// memory stays claimed until the tab dies.
function item(name) {
  return { url: `blob:${name}`, thumbnailUrl: `blob:${name}-thumb`, fileName: `${name}.png` };
}

test('ScreenshotStore lists the newest image first', () => {
  const store = new ScreenshotStore({ revoke: () => {} });

  store.add(item('one'));
  store.add(item('two'));

  assert.deepEqual(store.items().map((entry) => entry.fileName), ['two.png', 'one.png']);
});

test('ScreenshotStore drops the oldest image past the limit and releases both its URLs', () => {
  const revoked = [];
  const store = new ScreenshotStore({ limit: 2, revoke: (url) => revoked.push(url) });

  store.add(item('one'));
  store.add(item('two'));
  store.add(item('three'));

  assert.deepEqual(store.items().map((entry) => entry.fileName), ['three.png', 'two.png']);
  assert.deepEqual(revoked, ['blob:one', 'blob:one-thumb']);
});

test('ScreenshotStore releases both URLs of an image removed by hand', () => {
  const revoked = [];
  const store = new ScreenshotStore({ revoke: (url) => revoked.push(url) });
  store.add(item('one'));
  store.add(item('two'));

  store.remove('blob:one');

  assert.deepEqual(store.items().map((entry) => entry.fileName), ['two.png']);
  assert.deepEqual(revoked, ['blob:one', 'blob:one-thumb']);
});

test('ScreenshotStore ignores a removal of something it does not hold', () => {
  const revoked = [];
  const store = new ScreenshotStore({ revoke: (url) => revoked.push(url) });
  store.add(item('one'));

  store.remove('blob:nothing');

  assert.equal(store.items().length, 1);
  assert.deepEqual(revoked, []);
});

test('ScreenshotStore releases everything when cleared', () => {
  const revoked = [];
  const store = new ScreenshotStore({ revoke: (url) => revoked.push(url) });
  store.add(item('one'));
  store.add(item('two'));

  store.clear();

  assert.equal(store.items().length, 0);
  assert.deepEqual(revoked, ['blob:one', 'blob:one-thumb', 'blob:two', 'blob:two-thumb']);
});
