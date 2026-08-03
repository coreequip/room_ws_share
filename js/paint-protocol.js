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

const MESSAGE_TYPES = ['cursor', 'stroke-start', 'stroke-point', 'stroke-end'];

export function isPaintMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!MESSAGE_TYPES.includes(message.type)) return false;
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
