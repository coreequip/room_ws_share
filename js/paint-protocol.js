let counter = 0;

export function generateStrokeId() {
  counter += 1;
  return `s${counter}`;
}

export function makeCursor(x, y) {
  return { type: 'cursor', x, y };
}

export function makeStrokeStart(id, x, y) {
  return { type: 'stroke-start', id, x, y };
}

export function makeStrokePoint(id, x, y) {
  return { type: 'stroke-point', id, x, y };
}

export function makeStrokeEnd(id) {
  return { type: 'stroke-end', id };
}

export function makeCursorLeave() {
  return { type: 'cursor-leave' };
}

// Stamps the originating peer onto a message the sharer relays onward. Viewers
// only have a DataChannel to the sharer, never to each other, so without this
// a relayed message would look like it came from the sharer and every viewer's
// strokes would collapse onto one colour.
export function withPeer(message, peerId) {
  return { ...message, peer: peerId };
}

const MESSAGE_TYPES = ['cursor', 'cursor-leave', 'stroke-start', 'stroke-point', 'stroke-end'];

export function isPaintMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!MESSAGE_TYPES.includes(message.type)) return false;
  if ('peer' in message && typeof message.peer !== 'string') return false;
  if (message.type === 'cursor-leave') return true;
  if (message.type === 'stroke-end') return typeof message.id === 'string';
  if (message.type === 'cursor') return isFiniteNumber(message.x) && isFiniteNumber(message.y);
  return typeof message.id === 'string' && isFiniteNumber(message.x) && isFiniteNumber(message.y);
}

export function parsePaintMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPaintMessage(message) ? message : null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
