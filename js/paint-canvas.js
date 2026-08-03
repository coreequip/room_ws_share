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
    this.cursors = new Map(); // peerId -> { x, y }
    this.strokes = new Map(); // `${peerId}:${strokeId}` -> { peerId, points, lastUpdate }
    this.rafHandle = null;
  }

  attach(video, container) {
    this.video = video;
    this.container = container;
    container.appendChild(this.canvas);
    this._ensureLoop();
  }

  isAttached() {
    return this.video !== null;
  }

  detach() {
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.video = null;
    this.container = null;
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
    this._ensureLoop();
  }

  addStrokePoint(peerId, strokeId, x, y) {
    const stroke = this.strokes.get(`${peerId}:${strokeId}`);
    if (!stroke) return;
    stroke.points.push({ x, y });
    stroke.lastUpdate = performance.now();
  }

  endStroke() {
    // Strokes fade purely based on `lastUpdate` (see strokeAlpha) — nothing
    // to do here beyond having stopped receiving new points for this id.
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
      this._prune();
      this._draw();
      this.rafHandle = (this.cursors.size > 0 || this.strokes.size > 0) ? requestAnimationFrame(tick) : null;
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  _prune() {
    const now = performance.now();
    for (const [key, stroke] of this.strokes) {
      if (strokeAlpha(now - stroke.lastUpdate) <= 0) this.strokes.delete(key);
    }
  }

  _draw() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    const contentRect = computeVideoContentRect(this.video, rect);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const now = performance.now();
    for (const stroke of this.strokes.values()) {
      const alpha = strokeAlpha(now - stroke.lastUpdate);
      if (alpha > 0) this._drawStroke(stroke, contentRect, alpha);
    }
    for (const [peerId, cursor] of this.cursors) {
      this._drawCursor(peerId, cursor, contentRect);
    }
  }

  _drawStroke(stroke, contentRect, alpha) {
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

  _drawCursor(peerId, cursor, contentRect) {
    const { x, y } = normalizedToPoint(cursor.x, cursor.y, contentRect);
    this.ctx.fillStyle = colorForPeer(peerId);
    this.ctx.beginPath();
    this.ctx.arc(x, y, CURSOR_RADIUS, 0, Math.PI * 2);
    this.ctx.fill();
  }
}
