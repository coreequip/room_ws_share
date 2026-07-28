import { icons } from './icons.js?v=3ca587';

const SELF_KEY = 'self:local';
const IDLE_HIDE_DELAY_MS = 2500;
const TOAST_DURATION_MS = 3000;
const SPARKLINE_WIDTH = 60;
const SPARKLINE_HEIGHT = 16;
const SPARKLINE_MAX_SAMPLES = 20;
const SPARKLINE_SMOOTHING = 0.3;

export class Ui {
  constructor({ root, t, onShareClick, onCopyLinkClick, onFullscreenClick, onZoomClick, onInfoClick, onInfoModalClose }) {
    this.root = root;
    this.t = t;
    this.tiles = new Map(); // key -> { stream, label }
    this.mainKey = null;
    this.selfPrevMainKey = null; // mainKey to restore when the self tile is un-promoted
    this.idleTimer = null;
    this.isZoomed = false;
    this.toastTimer = null;
    this.bitrateSamples = [];

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
    this.infoButton = root.querySelector('[data-role="info-button"]');
    this.infoModalBackdrop = root.querySelector('[data-role="info-modal-backdrop"]');
    this.infoModalTitleEl = root.querySelector('[data-role="info-modal-title"]');
    this.infoModalBody = root.querySelector('[data-role="info-modal-body"]');
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
    this.infoButton.innerHTML = icons.info;
    this.infoButton.title = this.t('infoLabel');
    this.infoModalTitleEl.textContent = this.t('infoLabel');
    this.infoModalCloseButton.title = this.t('infoClose');
    this.memberWidgetCountEl.textContent = '–';
    this.memberWidgetStatusEl.textContent = this.t('memberWidgetNoShare');
    this.statusEl.textContent = this.t('statusConnecting');

    this.shareButton.addEventListener('click', onShareClick);
    this.copyLinkButton.addEventListener('click', onCopyLinkClick);
    this.fullscreenButton.addEventListener('click', onFullscreenClick);
    this.zoomButton.addEventListener('click', onZoomClick);
    this.infoButton.addEventListener('click', onInfoClick);
    this.infoModalCloseButton.addEventListener('click', onInfoModalClose);
    this.infoModalBackdrop.addEventListener('click', (event) => {
      if (event.target === this.infoModalBackdrop) onInfoModalClose();
    });

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

  showLocalPreview(stream) {
    this._setTile(SELF_KEY, stream, this.t('youLabel'), { autoPromote: false });
  }

  removeLocalPreview() {
    this._removeTile(SELF_KEY);
  }

  addRemoteTrack(peerId, streamId, mediaStream) {
    this._setTile(`${peerId}:${streamId}`, mediaStream, peerId.slice(0, 8));
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

  _setTile(key, stream, label, { hasError = false, autoPromote = true } = {}) {
    this.tiles.set(key, { stream, label, hasError });
    if (autoPromote && this.mainKey === null) {
      this.mainKey = key;
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
      this.mainKey = nextKey ?? null;
      this._resetZoom();
    }
    this._render();
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
    this.mainKey = key;
    this._resetZoom();
    this._render();
  }

  _demoteSelf() {
    if (this.mainKey !== SELF_KEY) return;
    const fallback = this.selfPrevMainKey;
    this.mainKey = fallback !== null && this.tiles.has(fallback) ? fallback : null;
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
    if (this.mainKey === null) return;
    this.idleTimer = setTimeout(() => {
      this.overlayEl.classList.add('is-hidden');
    }, IDLE_HIDE_DELAY_MS);
  }

  _render() {
    this.stageEl.classList.toggle('is-empty', this.mainKey === null);
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
      container.addEventListener('click', () => this._handleThumbnailClick(key));
      this.thumbnailRail.append(container);
    }
  }
}
