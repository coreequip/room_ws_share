import { icons } from './icons.js?v=d5ed2d';
import { computeVideoContentRect, pointToNormalized } from './paint-geometry.js?v=480280';
import { generateStrokeId, makeCursor, makeStrokeStart, makeStrokePoint, makeStrokeEnd, makeCursorLeave } from './paint-protocol.js?v=c25ffc';
import { PaintOverlay } from './paint-canvas.js?v=1a266b';
import { drawScreenshot } from './screenshot.js?v=88e50e';

const SELF_KEY = 'self:local';
const IDLE_HIDE_DELAY_MS = 2500;
const TOAST_DURATION_MS = 3000;
const THUMBNAIL_WIDTH = 160;
const SPARKLINE_WIDTH = 60;
const SPARKLINE_HEIGHT = 16;
const SPARKLINE_MAX_SAMPLES = 20;
const SPARKLINE_SMOOTHING = 0.3;

export class Ui {
  constructor({ root, t, onShareClick, onCopyLinkClick, onFullscreenClick, onZoomClick, onPaintClick, onPaintPointerEvent, onScreenshotClick, onScreenshotCopy, onScreenshotDownload, onScreenshotRemove, onInfoClick, onInfoCopyClick, onInfoModalClose }) {
    this.root = root;
    this.t = t;
    this._onPaintPointerEvent = onPaintPointerEvent;
    this._onScreenshotCopy = onScreenshotCopy;
    this._onScreenshotDownload = onScreenshotDownload;
    this._onScreenshotRemove = onScreenshotRemove;
    this.tiles = new Map(); // key -> { stream, label, hasError, peerId, streamId }
    this.mainKey = null;
    this.selfPrevMainKey = null; // mainKey to restore when the self tile is un-promoted
    this.idleTimer = null;
    this.isZoomed = false;
    this.toastTimer = null;
    this.bitrateSamples = [];
    this.paintOverlay = new PaintOverlay();
    this.pipOverlay = new PaintOverlay(); // attached in Task 9, kept here so handlePaintMessage/removePaintPeer stay stable
    this._paintPeerIds = new Set(); // peerIds we've ever received a paint message from -- NOT this.tiles, because a
    // pure viewer (never shares media back to us) sends paint messages but never gets a video tile via addRemoteTrack
    this._pendingPaintChannelOpen = new Set(); // `${peerId}:${streamId}` keys whose paint DataChannel already
    // reported 'open' before addRemoteTrack created the matching tile (event ordering between the DataChannel and
    // the track isn't guaranteed) -- consumed by _setTile so the tile starts with paintChannelOpen already true
    // instead of defaulting to undefined and permanently disabling the paint button for that peer.
    this.paintModeActive = false;
    this._pointerOverFilmStrip = false;
    this._activePaintStrokeId = null;
    this._paintMouseMoveHandler = (event) => this._handlePaintMouseMove(event);
    this._paintMouseDownHandler = (event) => this._handlePaintMouseDown(event);
    this._paintMouseUpHandler = () => this._endPaintStroke();

    this.stageEl = root.querySelector('[data-role="stage"]');
    this.stageVideo = root.querySelector('[data-role="stage-video"]');
    this.stageLabelEl = root.querySelector('[data-role="stage-label"]');
    this.stageEmpty = root.querySelector('[data-role="stage-empty"]');
    this.connectingSpinner = root.querySelector('[data-role="connecting-spinner"]');
    this.statusEl = root.querySelector('[data-role="status"]');
    this.overlayEl = root.querySelector('[data-role="stage-overlay"]');
    this.thumbnailRail = root.querySelector('[data-role="thumbnail-rail"]');
    this.shareButton = root.querySelector('[data-role="share-button"]');
    this.copyLinkButton = root.querySelector('[data-role="copy-link-button"]');
    this.fullscreenButton = root.querySelector('[data-role="fullscreen-button"]');
    this.zoomButton = root.querySelector('[data-role="zoom-button"]');
    this.paintButton = root.querySelector('[data-role="paint-button"]');
    this.screenshotButton = root.querySelector('[data-role="screenshot-button"]');
    this.filmStrip = root.querySelector('[data-role="film-strip"]');
    this.lightboxEl = root.querySelector('[data-role="lightbox"]');
    this.lightboxImage = root.querySelector('[data-role="lightbox-image"]');
    this.infoButton = root.querySelector('[data-role="info-button"]');
    this.infoModalBackdrop = root.querySelector('[data-role="info-modal-backdrop"]');
    this.infoModalTitleEl = root.querySelector('[data-role="info-modal-title"]');
    this.infoModalBody = root.querySelector('[data-role="info-modal-body"]');
    this.infoCopyButton = root.querySelector('[data-role="info-copy-button"]');
    this.infoModalCloseButton = root.querySelector('[data-role="info-modal-close"]');
    this.memberWidgetCountEl = root.querySelector('[data-role="member-widget-count"]');
    this.memberWidgetStatusEl = root.querySelector('[data-role="member-widget-status"]');
    this.toastEl = root.querySelector('[data-role="toast"]');

    this.shareButton.innerHTML = icons.shareStart;
    this.shareButton.title = this.t('shareStart');
    this.copyLinkButton.innerHTML = icons.copyLink;
    this.copyLinkButton.title = this.t('copyLink');
    this.fullscreenButton.innerHTML = icons.fullscreenEnter;
    this.fullscreenButton.title = this.t('fullscreenEnter');
    this.zoomButton.innerHTML = icons.zoomEnter;
    this.zoomButton.title = this.t('zoomEnter');
    this.paintButton.innerHTML = icons.paint;
    this.paintButton.title = this.t('paintEnter');
    this.screenshotButton.innerHTML = icons.screenshot;
    this.screenshotButton.title = this.t('screenshotLabel');
    this.infoButton.innerHTML = icons.info;
    this.infoButton.title = this.t('infoLabel');
    this.infoModalTitleEl.textContent = this.t('infoLabel');
    this.infoCopyButton.textContent = this.t('infoCopy');
    this.infoModalCloseButton.title = this.t('infoClose');
    this.memberWidgetCountEl.textContent = '–';
    this.memberWidgetStatusEl.textContent = this.t('memberWidgetNoShare');
    this.statusEl.textContent = this.t('statusConnecting');

    this.shareButton.addEventListener('click', onShareClick);
    this.copyLinkButton.addEventListener('click', onCopyLinkClick);
    this.fullscreenButton.addEventListener('click', onFullscreenClick);
    this.zoomButton.addEventListener('click', onZoomClick);
    this.paintButton.addEventListener('click', onPaintClick);
    this.screenshotButton.addEventListener('click', onScreenshotClick);
    this.infoButton.addEventListener('click', onInfoClick);
    this.infoCopyButton.addEventListener('click', onInfoCopyClick);
    this.infoModalCloseButton.addEventListener('click', onInfoModalClose);
    this.infoModalBackdrop.addEventListener('click', (event) => {
      if (event.target === this.infoModalBackdrop) onInfoModalClose();
    });

    this.lightboxEl.addEventListener('click', () => this.hideLightbox());

    // The strip lives inside the auto-hiding overlay. While the pointer rests
    // on it -- scrolling through the shots, aiming for a button -- nothing may
    // fade away underneath.
    this.filmStrip.addEventListener('mouseenter', () => {
      this._pointerOverFilmStrip = true;
      this._handleMouseActivity();
    });
    this.filmStrip.addEventListener('mouseleave', () => {
      this._pointerOverFilmStrip = false;
      this._handleMouseActivity();
    });
    // A wheel reports vertical movement, which does nothing in a horizontal
    // strip -- put it on the axis that actually moves.
    this.filmStrip.addEventListener('wheel', (event) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      this.filmStrip.scrollLeft += event.deltaY;
    }, { passive: false });
    this.filmStrip.addEventListener('scroll', () => this._updateFilmStripOverflow());

    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = document.fullscreenElement === this.stageEl;
      this.fullscreenButton.innerHTML = isFullscreen ? icons.fullscreenExit : icons.fullscreenEnter;
      this.fullscreenButton.title = isFullscreen ? this.t('fullscreenExit') : this.t('fullscreenEnter');
    });

    this.stageEl.addEventListener('mousemove', () => this._handleMouseActivity());
    this.stageEl.addEventListener('mousemove', (event) => this._handlePan(event));
  }

  setSharing(isSharing) {
    this.shareButton.innerHTML = isSharing ? icons.shareStop : icons.shareStart;
    this.shareButton.title = isSharing ? this.t('shareStop') : this.t('shareStart');
    this.shareButton.classList.toggle('btn-cancel', isSharing);
    this.shareButton.classList.toggle('btn-confirm', !isSharing);
    this.shareButton.dataset.sharing = String(isSharing);
  }

  setShareBusy(isBusy) {
    this.shareButton.disabled = isBusy;
  }

  setInfoBusy(isBusy) {
    this.infoButton.disabled = isBusy;
  }

  showInfoModal() {
    this.infoModalBackdrop.classList.remove('is-hidden');
  }

  hideInfoModal() {
    this.infoModalBackdrop.classList.add('is-hidden');
  }

  setInfoContent(html) {
    this.infoModalBody.innerHTML = html;
  }

  setInfoCopied(isCopied) {
    this.infoCopyButton.textContent = isCopied ? this.t('infoCopied') : this.t('infoCopy');
  }

  setMemberCount(count) {
    this.memberWidgetCountEl.textContent = this.t('memberCountText', count);
  }

  setShareActivity(totalBitrateKbps) {
    if (totalBitrateKbps === null) {
      this.bitrateSamples = [];
      this.memberWidgetStatusEl.textContent = this.t('memberWidgetNoShare');
      this.memberWidgetStatusEl.title = '';
      return;
    }
    this._pushBitrateSample(totalBitrateKbps);
    this.memberWidgetStatusEl.innerHTML = this._renderSparkline();
    this.memberWidgetStatusEl.title = this.t('memberWidgetBitrate', Math.round(totalBitrateKbps));
  }

  _pushBitrateSample(value) {
    const previous = this.bitrateSamples[this.bitrateSamples.length - 1];
    const smoothed = previous === undefined ? value : previous * (1 - SPARKLINE_SMOOTHING) + value * SPARKLINE_SMOOTHING;
    this.bitrateSamples.push(smoothed);
    if (this.bitrateSamples.length > SPARKLINE_MAX_SAMPLES) this.bitrateSamples.shift();
  }

  _renderSparkline() {
    if (this.bitrateSamples.length < 2) return '';
    const max = Math.max(...this.bitrateSamples, 1);
    const min = Math.min(...this.bitrateSamples, 0);
    const range = max - min || 1;
    // Fixed time-per-pixel scale (based on the full window, not the current
    // sample count) so the line slides in from the right as samples arrive,
    // instead of always stretching to fill the whole width.
    const stepX = SPARKLINE_WIDTH / (SPARKLINE_MAX_SAMPLES - 1);
    const offsetX = SPARKLINE_WIDTH - (this.bitrateSamples.length - 1) * stepX;

    const coords = this.bitrateSamples.map((value, i) => ({
      x: offsetX + i * stepX,
      y: SPARKLINE_HEIGHT - ((value - min) / range) * SPARKLINE_HEIGHT,
    }));

    const linePoints = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    const fillPoints = `${linePoints} ${lastX},${SPARKLINE_HEIGHT} ${firstX},${SPARKLINE_HEIGHT}`;

    return `<svg viewBox="0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}" class="sparkline">`
      + `<defs><linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0%" stop-color="currentColor" stop-opacity="0.5"/>`
      + `<stop offset="100%" stop-color="currentColor" stop-opacity="0.2"/>`
      + `</linearGradient></defs>`
      + `<polygon points="${fillPoints}" fill="url(#sparkline-fill)" stroke="none"/>`
      + `<polyline points="${linePoints}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
      + `</svg>`;
  }

  showToast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('is-hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.add('is-hidden');
    }, TOAST_DURATION_MS);
  }

  setConnecting(isConnecting) {
    this.connectingSpinner.style.display = isConnecting ? '' : 'none';
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  showLocalPreview(stream, streamId) {
    // streamId is carried on the self tile so the paint overlay can bind to it
    // the same way it binds to a remote tile's stream (see _updateStageOverlay).
    this._setTile(SELF_KEY, stream, this.t('youLabel'), { autoPromote: false, streamId });
  }

  setLocalPeerId(peerId) {
    this.localPeerId = peerId;
  }

  removeLocalPreview() {
    this._removeTile(SELF_KEY);
  }

  addRemoteTrack(peerId, streamId, mediaStream) {
    this._setTile(`${peerId}:${streamId}`, mediaStream, peerId.slice(0, 8), { peerId, streamId });
  }

  setTileStatus(peerId, streamId, text) {
    const tile = this.tiles.get(`${peerId}:${streamId}`);
    if (!tile) return;
    tile.label = text;
    tile.hasError = true;
    this._render();
  }

  showConnectionFailed(peerId, streamId) {
    const key = `${peerId}:${streamId}`;
    if (this.tiles.has(key)) {
      this.setTileStatus(peerId, streamId, this.t('tileConnectionFailed'));
      return;
    }
    this._setTile(key, null, this.t('tileConnectionFailed'), { hasError: true });
  }

  removeTile(peerId, streamId) {
    this._removeTile(`${peerId}:${streamId}`);
  }

  toggleFullscreen() {
    if (document.fullscreenElement === this.stageEl) {
      document.exitFullscreen();
    } else {
      this.stageEl.requestFullscreen();
    }
  }

  toggleZoom() {
    this.isZoomed = !this.isZoomed;
    this.stageVideo.classList.toggle('is-zoomed', this.isZoomed);
    this.zoomButton.innerHTML = this.isZoomed ? icons.zoomExit : icons.zoomEnter;
    this.zoomButton.title = this.isZoomed ? this.t('zoomExit') : this.t('zoomEnter');
    if (!this.isZoomed) this.stageVideo.style.objectPosition = '';
  }

  togglePaintMode() {
    // Reuse the same availability check _updatePaintButton uses to
    // enable/disable the button, so the keyboard shortcut can't turn on
    // paint mode when the button itself would be disabled/hidden (no remote
    // main tile, or its paint channel isn't open yet).
    if (!this.paintModeActive && !this.canPaint()) return;
    this._setPaintMode(!this.paintModeActive);
  }

  canPaint() {
    const mainTile = this._mainTile();
    return Boolean(mainTile && mainTile.paintChannelOpen);
  }

  _mainTile() {
    return this.mainKey !== null && this.mainKey !== SELF_KEY ? this.tiles.get(this.mainKey) : null;
  }

  setPaintChannelOpen(peerId, streamId, isOpen) {
    const key = `${peerId}:${streamId}`;
    const tile = this.tiles.get(key);
    if (!tile) {
      // Tile doesn't exist yet -- the DataChannel 'open' event raced ahead of
      // addRemoteTrack. Remember the signal so _setTile can seed it once the
      // tile shows up, instead of silently dropping it and leaving the paint
      // button permanently disabled for this peer.
      if (isOpen) this._pendingPaintChannelOpen.add(key);
      else this._pendingPaintChannelOpen.delete(key);
      return;
    }
    tile.paintChannelOpen = isOpen;
    this._updatePaintButton();
  }

  _setPaintMode(active) {
    this.paintModeActive = active;
    this.paintButton.title = active ? this.t('paintExit') : this.t('paintEnter');
    this.paintButton.classList.toggle('btn-cancel', active);
    this.paintButton.classList.toggle('btn-confirm', !active);
    this.stageVideo.classList.toggle('is-painting', active);
    if (active) {
      this.stageVideo.addEventListener('mousemove', this._paintMouseMoveHandler);
      this.stageVideo.addEventListener('mousedown', this._paintMouseDownHandler);
      this.stageVideo.addEventListener('mouseup', this._paintMouseUpHandler);
      this.stageVideo.addEventListener('mouseleave', this._paintMouseUpHandler);
    } else {
      this.stageVideo.removeEventListener('mousemove', this._paintMouseMoveHandler);
      this.stageVideo.removeEventListener('mousedown', this._paintMouseDownHandler);
      this.stageVideo.removeEventListener('mouseup', this._paintMouseUpHandler);
      this.stageVideo.removeEventListener('mouseleave', this._paintMouseUpHandler);
      this._endPaintStroke();
      // Cursors don't fade on their own the way strokes do (see
      // PaintOverlay._prune), so without this the sharer keeps rendering our
      // last-known cursor position forever after we leave paint mode.
      this._emitPaintEvent(makeCursorLeave());
    }
  }

  // Draws the stage video and the current drawing into a fresh canvas at the
  // video's native resolution. Returns the full image and a thumbnail for the
  // film strip, or null when there is nothing on the stage to capture.
  async captureScreenshot() {
    if (this.mainKey === null) return null;
    const canvas = document.createElement('canvas');
    const contentRect = computeVideoContentRect(this.stageVideo, this.stageEl.getBoundingClientRect());
    const overlay = this.paintOverlay.isAttached() ? this.paintOverlay : null;
    if (!drawScreenshot(canvas, this.stageVideo, overlay, { displayWidth: contentRect.width })) return null;

    const [blob, thumbnail] = await Promise.all([canvasToBlob(canvas), canvasToBlob(this._thumbnailOf(canvas))]);
    if (!blob || !thumbnail) return null;
    return { blob, thumbnail };
  }

  setScreenshots(items) {
    this.filmStrip.replaceChildren();
    for (const item of items) {
      const shot = document.createElement('div');
      shot.className = 'film-shot';
      shot.title = this.t('screenshotEnlarge');
      const image = document.createElement('img');
      image.src = item.thumbnailUrl;
      image.alt = item.fileName;
      // scrollWidth only tells the truth once the thumbnails have loaded.
      image.addEventListener('load', () => this._updateFilmStripOverflow());

      const actions = document.createElement('div');
      actions.className = 'film-shot-actions';
      const remove = this._filmStripAction(icons.close, this.t('screenshotRemove'), () => this._onScreenshotRemove(item));
      remove.classList.add('film-shot-remove');
      actions.append(
        this._filmStripAction(icons.copy, this.t('screenshotCopy'), () => this._onScreenshotCopy(item)),
        this._filmStripAction(icons.download, this.t('screenshotDownload'), () => this._onScreenshotDownload(item)),
        remove,
      );

      shot.append(image, actions);
      shot.addEventListener('click', () => this.showLightbox(item));
      this.filmStrip.append(shot);
    }
    this._updateFilmStripOverflow();
  }

  showLightbox(item) {
    this.lightboxImage.src = item.url;
    this.lightboxEl.classList.remove('is-hidden');
  }

  hideLightbox() {
    if (this.lightboxEl.classList.contains('is-hidden')) return;
    this.lightboxEl.classList.add('is-hidden');
    // Drop the reference so a removed image can't linger in a hidden element.
    this.lightboxImage.removeAttribute('src');
    this._handleMouseActivity();
  }

  _updateFilmStripOverflow() {
    const hidden = this.filmStrip.scrollWidth - this.filmStrip.clientWidth - this.filmStrip.scrollLeft;
    this.filmStrip.classList.toggle('has-more', hidden > 1);
  }

  _filmStripAction(icon, title, onClick) {
    const button = document.createElement('button');
    button.className = 'film-shot-action';
    button.innerHTML = icon;
    button.title = title;
    button.addEventListener('click', (event) => {
      // Without this the click would fall through to the tile and copy the
      // image as well.
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  _thumbnailOf(source) {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = Math.max(1, Math.round((source.height / source.width) * THUMBNAIL_WIDTH));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  _updateScreenshotButton() {
    this.screenshotButton.classList.toggle('is-hidden', !this._mainTile());
  }

  _updatePaintButton() {
    const mainTile = this._mainTile();
    this.paintButton.classList.toggle('is-hidden', !mainTile);
    this.paintButton.disabled = !mainTile || !mainTile.paintChannelOpen;
    if (!mainTile && this.paintModeActive) this._setPaintMode(false);
  }

  handlePaintMessage(peerId, streamId, message) {
    // On a relayed message `peer` names the viewer who actually drew it; peerId
    // is only the channel it arrived on (the sharer). Falling back to peerId
    // covers the direct viewer -> sharer hop, which carries no `peer` field.
    const originPeerId = message.peer ?? peerId;
    this._paintPeerIds.add(originPeerId);
    this._renderPaint(originPeerId, streamId, message);
  }

  _renderPaint(originPeerId, streamId, message) {
    for (const overlay of this._paintOverlays(streamId)) {
      if (message.type === 'cursor') overlay.setCursor(originPeerId, message.x, message.y);
      else if (message.type === 'cursor-leave') overlay.removeCursor(originPeerId);
      else if (message.type === 'stroke-start') overlay.startStroke(originPeerId, message.id, message.x, message.y);
      else if (message.type === 'stroke-point') overlay.addStrokePoint(originPeerId, message.id, message.x, message.y);
      else if (message.type === 'stroke-end') overlay.endStroke(originPeerId, message.id);
    }
  }

  removePaintPeer(peerId) {
    // Deliberately NOT stream-scoped: a peer that dropped is gone from every
    // stream at once, so wipe it from both overlays regardless of what they
    // are currently showing.
    this._paintPeerIds.delete(peerId);
    for (const overlay of [this.paintOverlay, this.pipOverlay]) overlay.removePeer(peerId);
  }

  _paintOverlays(streamId) {
    // Only overlays currently showing THIS stream render anything -- an
    // overlay nobody is watching (self-view not promoted to Main, PiP never
    // opened) must not be fed cursor/stroke state, or its internal Maps grow
    // forever since pruning only happens inside the attached overlay's own
    // requestAnimationFrame loop (see PaintOverlay._ensureLoop, which is a
    // no-op while detached).
    return [this.paintOverlay, this.pipOverlay].filter((overlay) => overlay.handles(streamId));
  }

  _updateStageOverlay() {
    // The stage overlay follows whatever stream is currently main -- the own
    // feed when it's promoted (sharer watching viewers point at their screen)
    // or a remote feed (viewer seeing everyone's strokes on the shared
    // screen). Receiving is deliberately independent of paint mode: passive
    // watchers should see what is being pointed at.
    const mainTile = this.mainKey !== null ? this.tiles.get(this.mainKey) : null;
    const streamId = mainTile?.streamId ?? null;
    if (streamId !== null && this.paintOverlay.handles(streamId)) return;

    if (this.paintOverlay.isAttached()) {
      // Clear any stale per-peer cursor/stroke state before detaching, so a
      // later re-attach starts clean instead of momentarily redrawing a peer's
      // last-known position from before this detach (PaintOverlay.detach()
      // itself doesn't clear its maps, and cursors in particular never expire
      // on their own). Iterate _paintPeerIds rather than this.tiles: a pure
      // viewer (never shares media back to us) sends paint messages but never
      // gets a video tile, so it wouldn't be found by scanning tiles.
      for (const peerId of this._paintPeerIds) this.paintOverlay.removePeer(peerId);
      this.paintOverlay.detach();
    }
    if (streamId !== null) this.paintOverlay.attach(this.stageVideo, this.stageEl, streamId);
  }

  async _togglePip(stream, streamId) {
    if (this._pipWindow) {
      this._pipWindow.close();
      return;
    }
    const pipWindow = await documentPictureInPicture.requestWindow({ width: 320, height: 180 });
    this._pipWindow = pipWindow;
    // A Document PiP window is a brand-new Document that does NOT inherit the
    // opener's <link> stylesheets (this is standard, documented behavior of
    // the API, not specific to this app) -- so `.paint-overlay`'s real rule
    // (position:absolute; inset:0; pointer-events:none; see css/stage.css)
    // never applies here unless copied in manually. Without it the overlay
    // canvas is laid out in normal flow instead of absolutely stacked over
    // the video, and since PaintOverlay._draw() resizes the canvas to match
    // its container's rect on every animation frame, the canvas's own
    // in-flow height feeds back into the body's content height each tick --
    // a runaway growth loop confirmed via Playwright (canvas height grew
    // from ~180 to 16000+ px within half a second of drawing).
    const style = pipWindow.document.createElement('style');
    style.textContent = '.paint-overlay { position: absolute; inset: 0; pointer-events: none; }';
    pipWindow.document.head.append(style);
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.cssText = 'width:100%;height:100%;display:block;object-fit:contain;';
    pipWindow.document.body.style.cssText = 'margin:0;background:#000;position:relative;';
    pipWindow.document.body.append(video);
    this.pipOverlay.attach(video, pipWindow.document.body, streamId);
    pipWindow.addEventListener('pagehide', () => {
      this.pipOverlay.detach();
      this._pipWindow = null;
    });
  }

  _normalizedPaintPoint(event) {
    const rect = this.stageVideo.getBoundingClientRect();
    const contentRect = computeVideoContentRect(this.stageVideo, rect);
    return pointToNormalized(event.clientX - rect.left, event.clientY - rect.top, contentRect);
  }

  _handlePaintMouseMove(event) {
    const { x, y } = this._normalizedPaintPoint(event);
    this._emitPaintEvent(makeCursor(x, y));
    if (this._activePaintStrokeId !== null) this._emitPaintEvent(makeStrokePoint(this._activePaintStrokeId, x, y));
  }

  _handlePaintMouseDown(event) {
    const { x, y } = this._normalizedPaintPoint(event);
    this._activePaintStrokeId = generateStrokeId();
    this._emitPaintEvent(makeStrokeStart(this._activePaintStrokeId, x, y));
  }

  _endPaintStroke() {
    if (this._activePaintStrokeId === null) return;
    this._emitPaintEvent(makeStrokeEnd(this._activePaintStrokeId));
    this._activePaintStrokeId = null;
  }

  _emitPaintEvent(message) {
    const mainTile = this.tiles.get(this.mainKey);
    if (!mainTile || mainTile.peerId === undefined) return;
    this._onPaintPointerEvent(mainTile.peerId, mainTile.streamId, message);
    // Render our own strokes locally rather than waiting for them to come back
    // off the wire: drawing has to feel immediate. The sharer excludes the
    // author when relaying (see PeerManager.broadcastPaint), so this doesn't
    // double up.
    if (this.localPeerId) this._renderPaint(this.localPeerId, mainTile.streamId, message);
  }

  _setTile(key, stream, label, { hasError = false, autoPromote = true, peerId, streamId } = {}) {
    // If the paint DataChannel already reported 'open' for this peer/stream
    // before this tile existed, seed the tile as open now instead of
    // defaulting to undefined (see setPaintChannelOpen).
    const paintChannelOpen = this._pendingPaintChannelOpen.delete(key) ? true : undefined;
    this.tiles.set(key, { stream, label, hasError, peerId, streamId, paintChannelOpen });
    if (autoPromote && this.mainKey === null) {
      this._setMainKey(key);
      this._handleMouseActivity();
    }
    this._render();
  }

  _removeTile(key) {
    if (!this.tiles.has(key)) return;
    this.tiles.delete(key);
    if (key === SELF_KEY) this.selfPrevMainKey = null;
    if (this.mainKey === key) {
      const [nextKey] = this.tiles.keys();
      this._setMainKey(nextKey ?? null);
      this._resetZoom();
    }
    this._render();
  }

  _setMainKey(key) {
    // End any in-flight stroke against the CURRENT (old) mainKey before
    // switching, so a mid-drag stroke-end is addressed to the peer who was
    // actually receiving it, not to whichever tile becomes main next.
    if (this.paintModeActive) this._setPaintMode(false);
    this.mainKey = key;
  }

  _handleThumbnailClick(key) {
    if (key === SELF_KEY && key === this.mainKey) {
      this._demoteSelf();
    } else {
      this._promote(key);
    }
  }

  _promote(key) {
    if (!this.tiles.has(key) || key === this.mainKey) return;
    if (key === SELF_KEY) {
      // Remember what was showing before, so a second click on the self
      // thumbnail can hand the main slot back instead of leaving it empty.
      this.selfPrevMainKey = this.mainKey;
    } else if (this.mainKey === SELF_KEY) {
      this.selfPrevMainKey = null;
    }
    this._setMainKey(key);
    this._resetZoom();
    this._render();
  }

  _demoteSelf() {
    if (this.mainKey !== SELF_KEY) return;
    const fallback = this.selfPrevMainKey;
    this._setMainKey(fallback !== null && this.tiles.has(fallback) ? fallback : null);
    this.selfPrevMainKey = null;
    this._resetZoom();
    this._render();
  }

  _resetZoom() {
    this.isZoomed = false;
    this.stageVideo.classList.remove('is-zoomed');
    this.stageVideo.style.objectPosition = '';
    this.zoomButton.innerHTML = icons.zoomEnter;
    this.zoomButton.title = this.t('zoomEnter');
  }

  _handlePan(event) {
    if (!this.isZoomed) return;
    const rect = this.stageEl.getBoundingClientRect();
    const percentX = ((event.clientX - rect.left) / rect.width) * 100;
    const percentY = ((event.clientY - rect.top) / rect.height) * 100;
    const clampedX = Math.min(100, Math.max(0, percentX));
    const clampedY = Math.min(100, Math.max(0, percentY));
    this.stageVideo.style.objectPosition = `${clampedX}% ${clampedY}%`;
  }

  _handleMouseActivity() {
    this.overlayEl.classList.remove('is-hidden');
    clearTimeout(this.idleTimer);
    if (this.mainKey === null || this._pointerOverFilmStrip) return;
    this.idleTimer = setTimeout(() => {
      this.overlayEl.classList.add('is-hidden');
    }, IDLE_HIDE_DELAY_MS);
  }

  _render() {
    this.stageEl.classList.toggle('is-empty', this.mainKey === null);
    this._updateStageOverlay();
    if (this.mainKey !== null) {
      const main = this.tiles.get(this.mainKey);
      this.stageVideo.style.display = '';
      this.stageVideo.srcObject = main.stream;
      this.stageEmpty.style.display = 'none';
      this.stageLabelEl.textContent = main.hasError ? main.label : '';
      this.stageLabelEl.style.display = main.hasError ? '' : 'none';
    } else {
      this.stageVideo.style.display = 'none';
      this.stageVideo.srcObject = null;
      this.stageEmpty.style.display = '';
      this.stageLabelEl.style.display = 'none';
      this.overlayEl.classList.remove('is-hidden');
    }

    this.thumbnailRail.replaceChildren();
    for (const [key, tile] of this.tiles) {
      // The self tile always keeps a thumbnail, even while it's main, so
      // clicking it again can hand the main slot back (see _demoteSelf).
      if (key === this.mainKey && key !== SELF_KEY) continue;
      const container = document.createElement('div');
      container.className = 'video-tile thumbnail';
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = tile.stream;
      const label = document.createElement('div');
      label.className = 'video-tile-label';
      label.textContent = tile.label;
      container.append(video, label);
      if (key === SELF_KEY && typeof documentPictureInPicture !== 'undefined') {
        const pipButton = document.createElement('button');
        pipButton.className = 'video-tile-pip-button';
        pipButton.innerHTML = icons.pip;
        pipButton.title = this.t('pipLabel');
        pipButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this._togglePip(tile.stream, tile.streamId);
        });
        container.append(pipButton);
      }
      container.addEventListener('click', () => this._handleThumbnailClick(key));
      this.thumbnailRail.append(container);
    }
    this._updatePaintButton();
    this._updateScreenshotButton();
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
