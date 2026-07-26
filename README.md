<p align="center">
  <img src="icon.svg" width="128" height="128" alt="roomshare Logo">
</p>

# roomshare

A very lightweight, serverless WebRTC screen-sharing tool, running at
[share.room.ws](https://share.room.ws). Uses the existing
[room.ws](https://room.ws) pub/sub server (`wss://live.room.ws`) for
signaling — no backend code of its own, no build pipeline. The look follows
the style catalog in `docs/design/index.html`; the UI automatically detects
German/English based on the browser language. No CDN is used — CSS and the
font (Droid Sans) are served entirely locally, so no third-party requests
are made.

## Usage

Open the page and share the link with the automatically generated room ID.
Any participant can share their own screen with everyone else in the room
at any time via the Share button — video only, audio is never transmitted.
The most recently selected stream is shown large; additional concurrent
streams appear as thumbnails and can be promoted to the main video with a
click. Fullscreen via button or the `F` key.

NAT traversal happens exclusively via public STUN servers (no TURN) —
connections behind symmetric NAT/restrictive corporate networks may fail.

## Local Development

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Unit tests for the pure signaling and
i18n logic:

```bash
npm test
```

To have asset cache-busting hashes (`?v=<6-char hash>`) refreshed
automatically on every commit, enable the repo's git hook once (no npm
dependencies involved):

```bash
git config core.hooksPath githooks
```

## Manual Testing

Prerequisite: `python3 -m http.server 8000` in the project directory, then
open it in several browser tabs/profiles.

1. Open Tab A: `http://localhost:8000/` → click "Copy link" (the status briefly shows "Link copied!" and then reverts) → paste the link from the clipboard into Tab B and Tab C and open it.
   Expected: All three show the localized "Waiting for screen share…" status, the stage is black with a centered spinner (which disappears once the connection is established).
2. In Tab A, click "Share screen" and select a window/screen (no forced audio in the picker dialog, since only video is requested).
   Expected: Tab B and Tab C show the shared screen within a few seconds, large as the main video (auto-promoted, since it's the first stream) — without audio, even if the shared source has audio.
3. Open Tab D with the same link while Tab A is still sharing (latecomer test).
   Expected: Tab D also immediately receives Tab A's live image, large as the main video.
4. In Tab B, additionally click "Share screen" (a second, simultaneous sharer).
   Expected: In Tab A, C and D, Tab A's existing stream remains the main video; the new stream from Tab B additionally appears as a small thumbnail tile in the bottom right.
5. In Tab C, click on Tab B's thumbnail tile.
   Expected: In Tab C, Tab B's stream becomes the new main video, and Tab A's previous stream moves into the thumbnail row there (Tab A and D remain unchanged).
6. In Tab C, click the "Fullscreen" button or press the `F` key.
   Expected: The stage fills the entire screen, the button text changes to "Exit fullscreen"; clicking/`F`/`Escape` again exits fullscreen mode.
7. In Tab C, move the mouse over the stage and then hold still for about 3 seconds.
   Expected: The thumbnail row and controls panel fade out smoothly; any mouse movement makes them reappear immediately.
8. In Tab A and Tab B, click "Stop sharing" respectively.
   Expected: Both streams disappear for all participants; with no remaining stream, the stage again shows the "Waiting for screen share…" status, and the controls stay permanently visible (no auto-hide without an active stream).
9. Close Tab B.
   Expected: No errors in the console of Tab A/C/D.
10. Language test: set the browser language to English (or simulate it via `navigator.language` in DevTools) and reload the page.
    Expected: Button labels, the warning notice, and status texts appear in English. With German as the browser language, they appear in German. With a third language (e.g. French), they appear in English (fallback).
