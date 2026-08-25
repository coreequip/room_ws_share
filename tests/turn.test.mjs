import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IceServerProvider } from '../js/turn.js';

const FALLBACK = [{ urls: 'stun:stun.example:19302' }];

test('IceServerProvider returns the fallback without fetching when no URL is configured', async () => {
  let calls = 0;
  const provider = new IceServerProvider({
    url: '',
    fallback: FALLBACK,
    fetchImpl: () => { calls++; throw new Error('should not be called'); },
  });

  assert.deepEqual(await provider.get(), FALLBACK);
  assert.equal(calls, 0);
});

function fakeFetch(payload, { ok = true } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return { ok, status: ok ? 200 : 503, json: async () => payload };
  };
  impl.calls = calls;
  return impl;
}

const CREDENTIALS = {
  iceServers: [{ urls: ['turns:turn.room.ws:443?transport=tcp'], username: '999:abc', credential: 'sig' }],
  ttl: 7200,
};

test('IceServerProvider appends the fetched relay to the fallback list', async () => {
  const fetchImpl = fakeFetch(CREDENTIALS);
  const provider = new IceServerProvider({ url: 'https://live.example/turn', fallback: FALLBACK, fetchImpl });

  const servers = await provider.get();

  assert.deepEqual(servers, [...FALLBACK, ...CREDENTIALS.iceServers]);
  assert.deepEqual(fetchImpl.calls, ['https://live.example/turn']);
});

test('IceServerProvider reuses cached credentials until they near expiry', async () => {
  let now = 0;
  const fetchImpl = fakeFetch(CREDENTIALS);
  const provider = new IceServerProvider({
    url: 'https://live.example/turn',
    fallback: FALLBACK,
    fetchImpl,
    now: () => now,
  });

  await provider.get();
  now = 7200 * 1000 - 61 * 1000; // still a minute before the safety margin bites
  await provider.get();
  assert.equal(fetchImpl.calls.length, 1);

  now = 7200 * 1000; // expired
  await provider.get();
  assert.equal(fetchImpl.calls.length, 2);
});

test('IceServerProvider falls back to STUN when the endpoint fails', async () => {
  const provider = new IceServerProvider({
    url: 'https://live.example/turn',
    fallback: FALLBACK,
    fetchImpl: async () => { throw new Error('network down'); },
  });

  assert.deepEqual(await provider.get(), FALLBACK);
});

test('IceServerProvider falls back to STUN on a non-OK response', async () => {
  const provider = new IceServerProvider({
    url: 'https://live.example/turn',
    fallback: FALLBACK,
    fetchImpl: fakeFetch({}, { ok: false }),
  });

  assert.deepEqual(await provider.get(), FALLBACK);
});

test('IceServerProvider waits out a cooldown before retrying a failed endpoint', async () => {
  let now = 0;
  let calls = 0;
  const provider = new IceServerProvider({
    url: 'https://live.example/turn',
    fallback: FALLBACK,
    fetchImpl: async () => { calls++; throw new Error('network down'); },
    now: () => now,
  });

  await provider.get();
  await provider.get();
  assert.equal(calls, 1, 'a second connection must not hammer a dead endpoint');

  now = 30000;
  await provider.get();
  assert.equal(calls, 2, 'after the cooldown the endpoint is worth another try');
});

test('IceServerProvider issues a single request when several peers connect at once', async () => {
  let calls = 0;
  const provider = new IceServerProvider({
    url: 'https://live.example/turn',
    fallback: FALLBACK,
    fetchImpl: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, json: async () => CREDENTIALS };
    },
  });

  const [a, b] = await Promise.all([provider.get(), provider.get()]);

  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});
