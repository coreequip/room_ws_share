const DEFAULT_GRACE_MS = 5000;
const DEFAULT_COOLDOWN_MS = 10000;

// Decides when a broken connection has been broken long enough to be worth
// rebuilding. Short outages heal on their own -- WebRTC recovers from a brief
// 'disconnected' without help -- so a restart only becomes due after the grace
// period, and never more often than the cooldown allows. Without that second
// rule a permanently unreachable peer would be rebuilt every single second.
export class RecoveryPolicy {
  constructor({ graceMs = DEFAULT_GRACE_MS, cooldownMs = DEFAULT_COOLDOWN_MS, now = () => Date.now() } = {}) {
    this.graceMs = graceMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this._tracked = new Map(); // `${peerId}:${streamId}` -> { unhealthySince, lastRestart }
  }

  // Fed from the stats poll once a second; returns the connections to rebuild.
  update(entries) {
    const at = this.now();
    const due = [];
    const seen = new Set();

    for (const { peerId, streamId, healthy } of entries) {
      const key = `${peerId}:${streamId}`;
      seen.add(key);
      const tracked = this._get(key);

      if (healthy) {
        tracked.unhealthySince = null;
        continue;
      }
      if (tracked.unhealthySince === null) {
        tracked.unhealthySince = at;
        continue;
      }
      if (at - tracked.unhealthySince < this.graceMs) continue;
      if (!this._cooldownPassed(tracked, at)) continue;

      tracked.lastRestart = at;
      due.push({ peerId, streamId });
    }

    for (const key of this._tracked.keys()) {
      if (!seen.has(key)) this._tracked.delete(key);
    }
    return due;
  }

  // For restart requests arriving from the other side: several viewers of one
  // stream can ask at the same moment, and the sharer should rebuild once.
  allow(peerId, streamId) {
    const at = this.now();
    const tracked = this._get(`${peerId}:${streamId}`);
    if (!this._cooldownPassed(tracked, at)) return false;
    tracked.lastRestart = at;
    return true;
  }

  _get(key) {
    let tracked = this._tracked.get(key);
    if (!tracked) {
      tracked = { unhealthySince: null, lastRestart: null };
      this._tracked.set(key, tracked);
    }
    return tracked;
  }

  _cooldownPassed(tracked, at) {
    return tracked.lastRestart === null || at - tracked.lastRestart >= this.cooldownMs;
  }
}
