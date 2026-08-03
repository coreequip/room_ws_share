const PALETTE = ['#ff6b6b', '#4dabf7', '#82c91e', '#f59f00', '#e64980', '#22b8cf'];

export function colorForPeer(peerId) {
  return PALETTE[hashString(peerId) % PALETTE.length];
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
