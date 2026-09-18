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

On the first visit the page asks for a name before joining the room: at least
three letters or digits and at most 32 characters, with single spaces allowed
between words and nothing else — no punctuation or emoji. The
name is remembered in the browser and can be changed from the info panel,
which lists everyone in the room with their browser and system, e.g.
`Baxter (Brave/macOS)`, and marks whoever is currently sharing with 🖥️. Each
client announces itself with a `presence` broadcast when it enters and whenever
its name or sharing state changes; the others answer the entry announcement
with their own, so a newcomer learns who is already there.

NAT traversal starts with public STUN servers. Where that is not enough —
symmetric NAT, or a corporate network that blocks UDP and allows nothing but
outbound 443 — the page fetches short-lived credentials for a TURN relay from
`https://live.room.ws/turn` and adds it to the ICE candidates. The relay is a
convenience, not a requirement: if the endpoint is unreachable or switched off,
sharing continues on STUN alone. Append `?turn=` to the URL to disable it for a
comparison run.

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
10. Pull the network on the viewer side for about ten seconds (turn Wi-Fi off and on again, or kill the connection in the OS) while a stream is running.
    Expected: The picture freezes on its last frame instead of disappearing. Within roughly 5-15 seconds it comes back on its own, without a reload — the viewer asks the sharer for a fresh offer (`share-restart`), the sharer answers it, and the tile is replaced by the new track. The info panel then reports "Connection restored automatically 1×" on both sides, and the event log holds the matching `recovery` line.
11. In any tab, press `I` (or click the info button) while a stream is running.
    Expected: The connection panel lists every connection with its codec, resolution, bitrate and packet loss, followed by an "Events" section with a timestamped log (connection state changes, joins/leaves, share start/stop, tab visibility, and any detected video stall). "Copy diagnostics" puts the full untranslated report — header, all connection fields, the whole event log — on the clipboard; the button briefly confirms with "Copied!".
12. While a stream is running, draw something on it and press `Shift+S` (or click the screenshot button).
    Expected: A toast confirms the image is on the clipboard, and a thumbnail appears in the film strip at the bottom left. The captured PNG holds the video frame at its native resolution with the drawing rendered on top at full opacity — even if the drawing had already begun to fade on screen — and without any of the live mouse cursors. Hovering a thumbnail reveals a copy button, a download button and a remove button; clicking the thumbnail itself opens the full image over the stage, and clicking that enlarged view (or pressing Escape) closes it again. While the pointer rests on the strip nothing fades out, and the wheel scrolls it horizontally once more images exist than fit. Past 15 images the oldest one drops out. The strip fades out with the rest of the controls after a few seconds of no mouse movement.
13. Open a fresh browser profile on the room link, try `Anna.`, `Al` and `😀😀😀` in the name dialog, then enter `Anna Lena`. Press `I` in both tabs.
    Expected: Each invalid name is refused with a message saying why; `Anna Lena` joins, and the other tab shows the toast "Anna Lena joined". Both info panels list both people with browser and system, the own entry marked "you" with a "Change name" button. While one of them shares, its entry carries 🖥️ on both sides; after a rename or a closed tab the other panel follows within a moment.
14. Language test: set the browser language to English (or simulate it via `navigator.language` in DevTools) and reload the page.
    Expected: Button labels, the warning notice, and status texts appear in English. With German as the browser language, they appear in German. With a third language (e.g. French), they appear in English (fallback).
