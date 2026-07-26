const ROOM_ID_LENGTH = 13; // ceil(log36(2^64)), fixed width regardless of the random value's magnitude

export function generateRoomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value.toString(36).padStart(ROOM_ID_LENGTH, '0');
}

export function getRoomIdFromLocation(hash) {
  const match = /^#([a-z0-9]+)$/.exec(hash);
  return match ? match[1] : null;
}

export function roomIdToHash(roomId) {
  return `#${roomId}`;
}
