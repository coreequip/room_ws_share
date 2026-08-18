const DEFAULT_LIMIT = 15;

// A screenshot is a redraw, not a screen grab: the video frame is drawn at its
// own resolution and the strokes are rendered again on top of it. Because
// strokes are stored normalized, they stay sharp at any size instead of being
// scaled up from what the stage happened to show.
export function drawScreenshot(canvas, video, overlay, { displayWidth = 0 } = {}) {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return false;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  overlay?.renderInto(ctx, { x: 0, y: 0, width, height }, {
    alpha: 1, // a drawing already fading on screen is still captured in full
    withCursors: false, // live pointers say nothing in a still image
    scale: displayWidth > 0 ? width / displayWidth : 1,
  });
  return true;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function screenshotFileName(at) {
  const date = new Date(at);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `roomshare-${day}-${time}.png`;
}

// Holds the captured images for this session. Every image keeps two object URLs
// alive (full size and thumbnail), so anything that drops an image -- the user,
// the size limit, or leaving the page -- has to release both.
export class ScreenshotStore {
  constructor({ limit = DEFAULT_LIMIT, revoke = (url) => URL.revokeObjectURL(url) } = {}) {
    this.limit = limit;
    this.revoke = revoke;
    this._items = []; // oldest first
  }

  add(item) {
    this._items.push(item);
    while (this._items.length > this.limit) this._release(this._items.shift());
    return item;
  }

  remove(url) {
    const index = this._items.findIndex((item) => item.url === url);
    if (index === -1) return;
    this._release(this._items.splice(index, 1)[0]);
  }

  clear() {
    this._items.forEach((item) => this._release(item));
    this._items = [];
  }

  // Newest first -- that is the order the film strip shows them in, so the
  // shot just taken never needs scrolling to.
  items() {
    return this._items.slice().reverse();
  }

  _release(item) {
    this.revoke(item.url);
    this.revoke(item.thumbnailUrl);
  }
}
