const DEFAULT_EVENT_LIMIT = 200;

// A bounded, chronological record of what happened to the connections. The
// interesting moment is always "the seconds before it broke", so the log keeps
// the newest entries and drops the oldest ones once it is full.
export class EventLog {
  constructor({ limit = DEFAULT_EVENT_LIMIT, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.now = now;
    this._entries = [];
  }

  add(kind, detail = {}) {
    this._entries.push({ at: this.now(), kind, detail });
    if (this._entries.length > this.limit) this._entries.splice(0, this._entries.length - this.limit);
  }

  entries() {
    return this._entries.slice();
  }
}

const DEFAULT_STALL_SAMPLES = 3;

// Classifies one connection from two consecutive stats snapshots. A NaN delta
// (a browser that doesn't report the counter at all) compares false everywhere
// and lands on 'ok' -- silence is better than a false alarm here.
function classify(previous, current) {
  if (current.bytes - previous.bytes <= 0) return 'silent';
  if (current.frames - previous.frames <= 0) return 'stalled';
  return 'ok';
}

// Turns the per-second stats poll into the two failure modes worth telling
// apart: 'stalled' (bytes keep arriving, nothing comes out of the decoder --
// the black picture on a live connection) and 'silent' (no bytes at all -- a
// dead transport). Screen sharing is bursty, so a bad verdict only counts after
// `stallSamples` consecutive samples agree; a recovery counts immediately.
export class StreamHealthTracker {
  constructor({ stallSamples = DEFAULT_STALL_SAMPLES } = {}) {
    this.stallSamples = stallSamples;
    this._tracked = new Map(); // `${peerId}:${streamId}` -> { previous, state, candidate, candidateCount }
  }

  // The current verdict, for callers that need the state rather than the
  // transition -- an unknown connection counts as healthy.
  stateOf(peerId, streamId) {
    return this._tracked.get(`${peerId}:${streamId}`)?.state ?? 'ok';
  }

  update(summaries) {
    const changes = [];
    const seen = new Set();

    for (const summary of summaries) {
      const key = `${summary.peerId}:${summary.streamId}`;
      seen.add(key);
      const tracked = this._tracked.get(key);
      if (!tracked) {
        this._tracked.set(key, { previous: summary, state: 'ok', candidate: 'ok', candidateCount: 0 });
        continue;
      }

      const candidate = classify(tracked.previous, summary);
      tracked.previous = summary;
      if (candidate === tracked.candidate) tracked.candidateCount += 1;
      else {
        tracked.candidate = candidate;
        tracked.candidateCount = 1;
      }

      const confirmed = candidate === 'ok' || tracked.candidateCount >= this.stallSamples ? candidate : null;
      if (confirmed && confirmed !== tracked.state) {
        changes.push({
          peerId: summary.peerId,
          streamId: summary.streamId,
          direction: summary.direction,
          from: tracked.state,
          to: confirmed,
        });
        tracked.state = confirmed;
      }
    }

    for (const key of this._tracked.keys()) {
      if (!seen.has(key)) this._tracked.delete(key);
    }
    return changes;
  }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatClock(at) {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatTimestamp(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(at)}`;
}

// Renders whatever fields an object happens to carry, so new stats fields show
// up in the report without anyone having to remember to add them here.
function formatFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

// Deliberately untranslated: the report is written by whoever hits the problem
// and read by whoever debugs it, often on differently localized browsers.
export function formatDiagnosticsReport({ events, stats, generatedAt, userAgent, recoveries = 0 }) {
  const lines = [
    'roomshare diagnostics',
    `generated: ${formatTimestamp(generatedAt)}`,
    `userAgent: ${userAgent}`,
    `recoveries: ${recoveries}`,
    '',
    `connections (${stats.length}):`,
    ...(stats.length ? stats.map((entry) => `- ${formatFields(entry)}`) : ['none']),
    '',
    `events (${events.length}):`,
    ...(events.length ? events.map((event) => `${formatClock(event.at)} ${event.kind} ${formatFields(event.detail)}`.trimEnd()) : ['none']),
  ];
  return lines.join('\n');
}
