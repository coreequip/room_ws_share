import { computeVideoContentRect, normalizedToPoint } from './paint-geometry.js?v=480280';
import { colorForPeer } from './paint-colors.js?v=3940f9';

const STROKE_FADE_START_MS = 5000;
const STROKE_FADE_DURATION_MS = 1000;
const CURSOR_RADIUS = 6;
const STROKE_WIDTH = 3;

export function strokeAlpha(ageMs) {
  if (ageMs <= STROKE_FADE_START_MS) return 1;
  return Math.max(0, 1 - (ageMs - STROKE_FADE_START_MS) / STROKE_FADE_DURATION_MS);
}

export class PaintOverlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'paint-overlay';
    this.ctx = this.canvas.getContext('2d');
    this.video = null;
    this.container = null;
    this.streamId = null;
    this.cursors = new Map(); // peerId -> { x, y }
    this.strokes = new Map(); // `${peerId}:${strokeId}` -> { peerId, points, lastUpdate }
    // Everything on the overlay fades as one picture: the timer runs from the
    // last drawing activity by anyone, not per stroke. Adding to the drawing
    // keeps the whole annotation alive, so a multi-stroke sketch can't have
    // its first strokes vanish while the last are still being drawn.
    this.lastActivityAt = null;
    this.rafHandle = null;
  }

  attach(video, container, streamId) {
    this.video = video;
    this.container = container;
    this.streamId = streamId;
    container.appendChild(this.canvas);
    this._ensureLoop();
  }

  isAttached() {
    return this.video !== null;
  }

  // Paint messages are scoped to the shared stream they were drawn on. An
  // overlay only renders messages for the stream it is currently showing, so
  // switching the main feed between two simultaneous sharers can't paint one
  // sharer's strokes over the other's video.
  handles(streamId) {
    return this.isAttached() && this.streamId === streamId;
  }

  detach() {
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.video = null;
    this.container = null;
    this.streamId = null;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  setCursor(peerId, x, y) {
    this.cursors.set(peerId, { x, y });
    this._ensureLoop();
  }

  startStroke(peerId, strokeId, x, y) {
    this.strokes.set(`${peerId}:${strokeId}`, { peerId, points: [{ x, y }], lastUpdate: performance.now() });
    this.lastActivityAt = performance.now();
    this._ensureLoop();
  }

  addStrokePoint(peerId, strokeId, x, y) {
    const stroke = this.strokes.get(`${peerId}:${strokeId}`);
    if (!stroke) return;
    stroke.points.push({ x, y });
    stroke.lastUpdate = performance.now();
    this.lastActivityAt = performance.now();
  }

  endStroke() {
    // Strokes fade purely based on `lastUpdate` (see strokeAlpha) — nothing
    // to do here beyond having stopped receiving new points for this id.
  }

  removeCursor(peerId) {
    // Only the cursor: strokes already in flight keep fading out on their own
    // (see strokeAlpha), so leaving paint mode mid-stroke doesn't make the
    // line vanish abruptly.
    this.cursors.delete(peerId);
  }

  removePeer(peerId) {
    this.cursors.delete(peerId);
    for (const key of [...this.strokes.keys()]) {
      if (this.strokes.get(key).peerId === peerId) this.strokes.delete(key);
    }
  }

  _ensureLoop() {
    if (this.rafHandle !== null || !this.video) return;
    const tick = () => {
      const now = performance.now();
      this._prune(now);
      this._draw(now);
      this.rafHandle = (this.cursors.size > 0 || this.strokes.size > 0) ? requestAnimationFrame(tick) : null;
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  _currentAlpha(now) {
    return this.lastActivityAt === null ? 0 : strokeAlpha(now - this.lastActivityAt);
  }

  _prune(now) {
    if (this.strokes.size > 0 && this._currentAlpha(now) <= 0) this.strokes.clear();
  }

  _draw(now) {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    const contentRect = computeVideoContentRect(this.video, rect);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const alpha = this._currentAlpha(now);
    for (const stroke of this.strokes.values()) {
      if (alpha > 0) this._drawStroke(stroke, contentRect, alpha);
    }
    for (const [peerId, cursor] of this.cursors) {
      this._drawCursor(peerId, cursor, contentRect);
    }
  }

  _drawStroke(stroke, contentRect, alpha) {
    // A path made of a single moveTo has zero length, and stroke() paints
    // nothing for it -- a click without a drag would leave no mark at all. Draw
    // that case as an explicit filled dot instead.
    if (stroke.points.length === 1) {
      this._drawDot(stroke, contentRect, alpha);
      return;
    }
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = colorForPeer(stroke.peerId);
    this.ctx.lineWidth = STROKE_WIDTH;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const { x, y } = normalizedToPoint(point.x, point.y, contentRect);
      if (index === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  _drawDot(stroke, contentRect, alpha) {
    const { x, y } = normalizedToPoint(stroke.points[0].x, stroke.points[0].y, contentRect);
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = colorForPeer(stroke.peerId);
    this.ctx.beginPath();
    this.ctx.arc(x, y, STROKE_WIDTH / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }

  _drawCursor(peerId, cursor, contentRect) {
    const { x, y } = normalizedToPoint(cursor.x, cursor.y, contentRect);
    this.ctx.fillStyle = colorForPeer(peerId);
    this.ctx.beginPath();
    this.ctx.arc(x, y, CURSOR_RADIUS, 0, Math.PI * 2);
    this.ctx.fill();
  }
}
