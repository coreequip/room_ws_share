// Hands a MediaStream to a <video> element and makes sure it actually plays.
//
// The `autoplay` attribute alone is not enough: Chrome refuses to start an
// unmuted element without a prior user gesture, and it does so silently --
// the element sits at paused:true, readyState 4, currentTime 0 with every
// frame decoded, and the viewer sees black (observed with a native sender
// on a freshly loaded tab). Nothing here carries audio (getDisplayMedia is
// called with video only), so muting costs nothing and lifts that restriction.

export function attachStream(video, stream, onPlayError) {
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  // Assigning srcObject runs the load algorithm again even for the same
  // stream, which pauses the element and starts over -- so only on a change.
  if (video.srcObject === stream) return;
  video.srcObject = stream;
  if (!stream) return;
  video.play().catch((err) => {
    // A newer srcObject assignment interrupts the pending start; that one
    // brings its own play() call, so this is not a failure.
    if (err.name === 'AbortError') return;
    onPlayError?.(err);
  });
}
