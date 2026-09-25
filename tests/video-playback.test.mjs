import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachStream } from '../js/video-playback.js';

function fakeVideo({ playResult = Promise.resolve() } = {}) {
  const video = {
    srcObject: null,
    muted: false,
    autoplay: false,
    playsInline: false,
    playCalls: 0,
    play() {
      video.playCalls += 1;
      return playResult;
    },
  };
  return video;
}

const stream = { id: 'stream-a' };

test('attachStream mutes the element so the browser may start it without a user gesture', () => {
  const video = fakeVideo();
  attachStream(video, stream);
  assert.equal(video.muted, true);
  assert.equal(video.autoplay, true);
  assert.equal(video.playsInline, true);
});

test('attachStream starts playback explicitly instead of relying on autoplay', () => {
  const video = fakeVideo();
  attachStream(video, stream);
  assert.equal(video.srcObject, stream);
  assert.equal(video.playCalls, 1);
});

test('attachStream leaves an element that already shows the stream alone', () => {
  const video = fakeVideo();
  attachStream(video, stream);
  attachStream(video, stream);
  assert.equal(video.playCalls, 1);
});

test('attachStream clears the element without trying to play nothing', () => {
  const video = fakeVideo();
  attachStream(video, stream);
  attachStream(video, null);
  assert.equal(video.srcObject, null);
  assert.equal(video.playCalls, 1);
});

test('attachStream reports a refused start', async () => {
  const refusal = Object.assign(new Error('play() not allowed'), { name: 'NotAllowedError' });
  const video = fakeVideo({ playResult: Promise.reject(refusal) });
  const reported = [];
  attachStream(video, stream, (err) => reported.push(err.name));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reported, ['NotAllowedError']);
});

test('attachStream stays quiet when a newer stream interrupted the start', async () => {
  const abort = Object.assign(new Error('interrupted by a new load request'), { name: 'AbortError' });
  const video = fakeVideo({ playResult: Promise.reject(abort) });
  const reported = [];
  attachStream(video, stream, (err) => reported.push(err.name));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reported, []);
});
