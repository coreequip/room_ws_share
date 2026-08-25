// Credentials are re-fetched a minute before they actually expire, so a
// connection started right at the boundary still gets a usable lifetime.
const REFRESH_MARGIN_MS = 60000;

// After a failed fetch the endpoint is left alone for a while. Without this a
// room with several peers would fire one doomed request per connection attempt.
const RETRY_COOLDOWN_MS = 30000;

// Fetches ephemeral TURN credentials and hands the resulting ICE server list to
// the PeerManager. The relay is a convenience, never a requirement: if the
// endpoint is unset or unreachable, sharing continues on STUN alone -- degraded
// for peers behind restrictive networks, unchanged for everyone else.
export class IceServerProvider {
  constructor({ url, fallback, fetchImpl = fetch, now = () => Date.now() }) {
    this.url = url;
    this.fallback = fallback;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cached = null;
    this.expiresAt = 0;
    this.retryAfter = 0;
    this.inFlight = null;
  }

  async get() {
    if (!this.url) return this.fallback;
    if (this.cached && this.now() < this.expiresAt) return this.cached;
    if (this.now() < this.retryAfter) return this.fallback;
    // Several peers connecting at once must share one request, not queue up
    // behind each other with identical fetches.
    this.inFlight ||= this._fetch().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async _fetch() {
    try {
      const response = await this.fetchImpl(this.url);
      if (!response.ok) throw new Error(`TURN endpoint returned ${response.status}`);
      const payload = await response.json();
      this.cached = [...this.fallback, ...payload.iceServers];
      this.expiresAt = this.now() + payload.ttl * 1000 - REFRESH_MARGIN_MS;
      return this.cached;
    } catch (err) {
      console.warn('IceServerProvider: no TURN credentials, continuing on STUN alone', err);
      this.retryAfter = this.now() + RETRY_COOLDOWN_MS;
      return this.fallback;
    }
  }
}
