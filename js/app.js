import { config } from './config.js?v=773889';
import { detectLocale, createTranslator } from './i18n.js?v=9d4eb5';
import { generateRoomId, getRoomIdFromLocation, roomIdToHash } from './room-id.js?v=b0533e';
import { Signaling } from './signaling.js?v=f3d39f';
import { PeerManager } from './peers.js?v=b4e802';
import { IceServerProvider } from './turn.js?v=ef7229';
import { Ui } from './ui.js?v=a815c9';
import { makeCursorLeave } from './paint-protocol.js?v=c25ffc';
import { EventLog, StreamHealthTracker, formatDiagnosticsReport, formatClock } from './diagnostics.js?v=95abf2';
import { RecoveryPolicy } from './recovery.js?v=9d2586';
import { ScreenshotStore, screenshotFileName } from './screenshot.js?v=88e50e';

const COPY_FEEDBACK_MS = 2000;
const STATS_POLL_MS = 1000;
const EVENT_DISPLAY_LIMIT = 15;
// Values that mean something went wrong, highlighted in the event list so the
// interesting line is findable at a glance.
const BAD_EVENT_VALUES = new Set(['disconnected', 'failed', 'closed', 'stalled', 'silent', 'muted', 'offline', 'hidden', 'ended', 'error']);

function resolveRoomId() {
  const existing = getRoomIdFromLocation(location.hash);
  if (existing) return existing;
  const generated = generateRoomId();
  history.replaceState(null, '', roomIdToHash(generated));
  return generated;
}

function main() {
  const locale = detectLocale();
  document.documentElement.lang = locale;
  const t = createTranslator(locale);

  const roomId = resolveRoomId();
  let localStream = null;
  let localStreamId = null;
  let sharingBusy = false;
  let peers;
  let signaling;
  let connectionFailed = false;
  let initialized = false;
  let statsInterval = null;
  let infoModalVisible = false;
  let lastStats = [];
  // Purely observational: the log records what happened, nothing acts on it.
  const eventLog = new EventLog();
  const streamHealth = new StreamHealthTracker();
  const recovery = new RecoveryPolicy();
  const screenshots = new ScreenshotStore();
  const mutedTracks = new Set(); // `${peerId}:${streamId}` of remote tracks that report no incoming media
  let recoveryCount = 0;
  const shortId = (id) => (id ? String(id).slice(0, 8) : '?');

  const ui = new Ui({
    root: document,
    t,
    onShareClick: () => toggleSharing(),
    onCopyLinkClick: () => copyLink(),
    onFullscreenClick: () => ui.toggleFullscreen(),
    onZoomClick: () => ui.toggleZoom(),
    onPaintClick: () => ui.togglePaintMode(),
    onPaintPointerEvent: (peerId, streamId, message) => peers.sendPaint(peerId, streamId, message),
    onScreenshotClick: () => captureScreenshot(),
    onScreenshotCopy: (item) => copyScreenshot(item),
    onScreenshotDownload: (item) => downloadScreenshot(item),
    onScreenshotRemove: (item) => removeScreenshot(item),
    onInfoClick: () => toggleInfoModal(),
    onInfoCopyClick: () => copyDiagnostics(),
    onInfoModalClose: () => closeInfoModal(),
  });
  ui.setConnecting(true);
  ui.setShareBusy(true);
  ui.setInfoBusy(true);

  document.addEventListener('visibilitychange', () => eventLog.add('tab', { value: document.visibilityState }));
  window.addEventListener('online', () => eventLog.add('network', { value: 'online' }));
  window.addEventListener('offline', () => eventLog.add('network', { value: 'offline' }));

  // Object URLs stay claimed until they are revoked; the browser tears the page
  // down anyway, but this keeps the store honest about owning them.
  window.addEventListener('pagehide', () => screenshots.clear());

  document.addEventListener('keydown', (event) => {
    // Cmd/Ctrl/Alt combinations belong to the browser. Without this guard
    // Cmd+C, Cmd+F and Cmd+P fire the local shortcuts as well.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      if (event.shiftKey) captureScreenshot();
      else toggleSharing();
      return;
    }
    if (key === 'c') copyLink();
    if (key === 'f') ui.toggleFullscreen();
    if (key === 'z') ui.toggleZoom();
    if (key === 'p') ui.togglePaintMode();
    if (key === 'i') toggleInfoModal();
    if (key === ' ') {
      // Space belongs to a focused button first -- taking it away would break
      // keyboard operation of the toolbar. Otherwise it is ours, and the
      // default has to go or the page scrolls underneath the stage.
      if (ui.isZoomed && document.activeElement?.tagName !== 'BUTTON') {
        event.preventDefault();
        ui.togglePanPause();
      }
    }
    if (key === 'escape') {
      // A mouse click focuses the button in some browsers; pressing Escape
      // right after can make that stale focus suddenly render as
      // :focus-visible. Escape never activates a button, so blurring here
      // is always safe (unlike doing this for every key, which could
      // interfere with Enter/Space activating a genuinely keyboard-focused
      // button).
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
      ui.hideLightbox();
      closeInfoModal();
    }
  });

  async function captureScreenshot() {
    const shot = await ui.captureScreenshot();
    if (!shot) {
      ui.showToast(t('screenshotFailed'));
      return;
    }
    const item = screenshots.add({
      url: URL.createObjectURL(shot.blob),
      thumbnailUrl: URL.createObjectURL(shot.thumbnail),
      fileName: screenshotFileName(Date.now()),
      blob: shot.blob,
    });
    ui.setScreenshots(screenshots.items());
    copyScreenshot(item);
  }

  async function copyScreenshot(item) {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('clipboard images unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': item.blob })]);
      ui.showToast(t('screenshotCopied'));
    } catch {
      // Older browsers and denied permissions end up here -- the film strip is
      // the fallback, the image is not lost.
      ui.showToast(t('screenshotStored'));
    }
  }

  function downloadScreenshot(item) {
    const link = document.createElement('a');
    link.href = item.url;
    link.download = item.fileName;
    link.click();
  }

  function removeScreenshot(item) {
    screenshots.remove(item.url);
    ui.setScreenshots(screenshots.items());
  }

  function copyLink() {
    navigator.clipboard.writeText(location.href);
    ui.setStatus(t('copyLinkCopied'));
    setTimeout(() => {
      if (!connectionFailed) ui.setStatus(t('statusWaitingForShare'));
    }, COPY_FEEDBACK_MS);
  }

  const drone = new RoomWS('roomshare', { url: config.roomwsUrl });

  drone.on('open', (error) => {
    ui.setConnecting(false);
    eventLog.add('signaling', { value: error ? 'error' : 'open' });
    if (error) {
      connectionFailed = true;
      ui.setStatus(t('statusConnectError', error));
      return;
    }
    connectionFailed = false;
    if (signaling) signaling.clientId = drone.clientId;
    ui.setLocalPeerId(drone.clientId);
    if (initialized) {
      ui.setStatus(t('statusWaitingForShare'));
      return;
    }
    initialized = true;
    ui.setShareBusy(false);
    ui.setInfoBusy(false);

    const room = drone.subscribe(roomId);
    signaling = new Signaling(room, drone.clientId);
    const iceServers = new IceServerProvider({
      url: config.turnCredentialsUrl,
      fallback: config.stunServers,
    });
    peers = new PeerManager({
      resolveIceServers: () => iceServers.get(),
      signaling,
      onRemoteTrack: (peerId, streamId, stream) => ui.addRemoteTrack(peerId, streamId, stream),
      onConnectionStateChange: (peerId, streamId, state) => {
        eventLog.add('connection', { peer: shortId(peerId), stream: shortId(streamId), value: state });
        if (state === 'failed') ui.showConnectionFailed(peerId, streamId);
        // 'disconnected' is transient -- WebRTC recovers from it on its own,
        // and if it doesn't, runRecovery() rebuilds the connection. Keeping the
        // tile means the last frame freezes instead of the stream vanishing,
        // and the rebuilt track replaces it. Only 'closed' is final: it is
        // raised deliberately on share-stop, peer leave and cleanup.
        if (state === 'closed') {
          mutedTracks.delete(`${peerId}:${streamId}`);
          ui.removeTile(peerId, streamId);
          ui.removePaintPeer(peerId);
          // A viewer that closed its tab never got to send its own
          // cursor-leave, and the other viewers have no connection to it to
          // notice. As the hub, tell them on its behalf -- otherwise its
          // cursor sticks on their overlay forever (cursors never fade).
          if (streamId === localStreamId) peers.broadcastPaint(streamId, peerId, makeCursorLeave());
        }
      },
      onTrackMuteChange: (peerId, streamId, muted) => {
        const key = `${peerId}:${streamId}`;
        if (muted) mutedTracks.add(key);
        else mutedTracks.delete(key);
        eventLog.add('remote-video', { peer: shortId(peerId), stream: shortId(streamId), value: muted ? 'muted' : 'unmuted' });
      },
      onPaintMessage: (peerId, streamId, message) => {
        ui.handlePaintMessage(peerId, streamId, message);
        // Only the sharer of this stream relays: viewers have no DataChannel
        // to each other, so the sharer is the hub that lets every viewer see
        // what the others are drawing. On a viewer, streamId never matches
        // localStreamId, so broadcastPaint is not reached.
        if (streamId === localStreamId) peers.broadcastPaint(streamId, peerId, message);
      },
      onPaintChannelStateChange: (peerId, streamId, state) => ui.setPaintChannelOpen(peerId, streamId, state === 'open'),
    });

    signaling.on('members', (members) => ui.setMemberCount(members.length));

    // A viewer whose picture broke asks us to offer the stream again. That is
    // exactly what happens when it presses F5 -- it rejoins, and we send it a
    // fresh offer -- only without the reload. The cooldown in the policy keeps
    // several viewers asking at once from rebuilding more than once.
    signaling.on('restart', ({ from, streamId }) => {
      if (!localStream || streamId !== localStreamId) return;
      if (!recovery.allow(from, streamId)) return;
      recoveryCount += 1;
      eventLog.add('recovery', { peer: shortId(from), value: 'rebuilt-on-request' });
      peers.addLateJoiner(from, localStreamId, localStream);
    });

    signaling.on('memberJoin', (peerId) => {
      eventLog.add('member', { peer: shortId(peerId), value: 'join' });
      if (localStream && localStreamId) {
        peers.addLateJoiner(peerId, localStreamId, localStream);
      }
      ui.setMemberCount(signaling.members.length);
      ui.showToast(t('memberJoined', peerId.slice(0, 8)));
    });

    signaling.on('memberLeave', (peerId) => {
      eventLog.add('member', { peer: shortId(peerId), value: 'leave' });
      ui.setMemberCount(signaling.members.length);
      ui.showToast(t('memberLeft', peerId.slice(0, 8)));
    });

    startStatsLoop();
    ui.setStatus(t('statusWaitingForShare'));
  });

  async function toggleSharing() {
    if (sharingBusy) return;
    if (localStream) {
      stopSharing();
      return;
    }
    sharingBusy = true;
    ui.setShareBusy(true);
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      ui.setStatus(t('shareDenied'));
      sharingBusy = false;
      ui.setShareBusy(false);
      return;
    }
    localStreamId = `${drone.clientId}-${Date.now()}`;
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.contentHint = 'text';
    // The capture itself can stall or be revoked by the OS without the peer
    // connections noticing -- on the sharing side these are the events that
    // explain a picture that stopped updating for everyone at once.
    videoTrack.addEventListener('mute', () => eventLog.add('local-video', { value: 'muted' }));
    videoTrack.addEventListener('unmute', () => eventLog.add('local-video', { value: 'unmuted' }));
    videoTrack.addEventListener('ended', () => {
      eventLog.add('local-video', { value: 'ended' });
      stopSharing();
    });
    eventLog.add('share', { stream: shortId(localStreamId), value: 'started' });
    ui.showLocalPreview(localStream, localStreamId);
    ui.setSharing(true);
    sharingBusy = false;
    ui.setShareBusy(false);
    await peers.startSharing(localStream, localStreamId);
  }

  function stopSharing() {
    if (!localStream) return;
    eventLog.add('share', { stream: shortId(localStreamId), value: 'stopped' });
    localStream.getTracks().forEach((track) => track.stop());
    peers.stopSharing(localStreamId);
    ui.removeLocalPreview();
    ui.setSharing(false);
    localStream = null;
    localStreamId = null;
  }

  function toggleInfoModal() {
    infoModalVisible = !infoModalVisible;
    if (infoModalVisible) {
      ui.setInfoContent(renderInfoHtml(lastStats, eventLog.entries(), recoveryCount, t));
      ui.showInfoModal();
    } else {
      ui.hideInfoModal();
    }
  }

  function closeInfoModal() {
    infoModalVisible = false;
    ui.hideInfoModal();
  }

  function startStatsLoop() {
    if (statsInterval) return;
    pollStats();
    statsInterval = setInterval(pollStats, STATS_POLL_MS);
  }

  async function pollStats() {
    lastStats = peers ? await peers.getConnectionStats() : [];
    for (const change of streamHealth.update(lastStats)) {
      eventLog.add(change.direction === 'outbound' ? 'sending' : 'receiving', { peer: shortId(change.peerId), value: change.to });
    }
    runRecovery();
    if (lastStats.length === 0) {
      ui.setShareActivity(null);
    } else {
      const totalBitrateKbps = lastStats.reduce((sum, entry) => sum + (entry.bitrateKbps || 0), 0);
      ui.setShareActivity(totalBitrateKbps);
    }
    if (infoModalVisible) ui.setInfoContent(renderInfoHtml(lastStats, eventLog.entries(), recoveryCount, t));
  }

  // Only the side holding the media track can offer a connection, so a sharer
  // rebuilds directly while a viewer has to ask the sharer to do it.
  function runRecovery() {
    if (!peers || !signaling) return;
    const entries = lastStats.map((entry) => ({
      peerId: entry.peerId,
      streamId: entry.streamId,
      healthy: entry.connectionState === 'connected'
        && streamHealth.stateOf(entry.peerId, entry.streamId) === 'ok'
        && !mutedTracks.has(`${entry.peerId}:${entry.streamId}`),
    }));

    for (const { peerId, streamId } of recovery.update(entries)) {
      recoveryCount += 1;
      if (streamId === localStreamId && localStream) {
        eventLog.add('recovery', { peer: shortId(peerId), value: 'rebuilt' });
        peers.addLateJoiner(peerId, localStreamId, localStream);
      } else {
        eventLog.add('recovery', { peer: shortId(peerId), value: 'requested' });
        signaling.sendRestart(peerId, streamId);
      }
    }
  }

  function copyDiagnostics() {
    const report = formatDiagnosticsReport({
      events: eventLog.entries(),
      stats: lastStats,
      generatedAt: Date.now(),
      userAgent: navigator.userAgent,
      recoveries: recoveryCount,
    });
    navigator.clipboard.writeText(report);
    ui.setInfoCopied(true);
    setTimeout(() => ui.setInfoCopied(false), COPY_FEEDBACK_MS);
  }
}

function renderInfoHtml(stats, events, recoveries, t) {
  const summary = `<p class="info-recoveries">${escapeHtml(t('infoRecoveries', recoveries))}</p>`;
  const connections = stats.length === 0
    ? `<p>${escapeHtml(t('infoNoConnections'))}</p>`
    : stats.map((entry) => renderConnectionInfo(entry, t)).join('');
  return summary + connections + renderEventsHtml(events, t);
}

// Newest first: the panel re-renders every second, which resets the scroll
// position, so whatever just happened has to be the line at the top.
function renderEventsHtml(events, t) {
  const heading = `<h3>${escapeHtml(t('infoEventsTitle'))}</h3>`;
  if (events.length === 0) {
    return `<div class="info-events">${heading}<p>${escapeHtml(t('infoNoEvents'))}</p></div>`;
  }
  const rows = events
    .slice(-EVENT_DISPLAY_LIMIT)
    .reverse()
    .map((event) => {
      const detail = Object.entries(event.detail).map(([key, value]) => `${key}=${value}`).join(' ');
      const isBad = BAD_EVENT_VALUES.has(event.detail.value);
      return `<div class="info-event${isBad ? ' is-bad' : ''}"><span class="info-event-time">${escapeHtml(formatClock(event.at))}</span><span>${escapeHtml(`${event.kind} ${detail}`.trim())}</span></div>`;
    })
    .join('');
  return `<div class="info-events">${heading}<div class="info-event-list">${rows}</div></div>`;
}

function renderConnectionInfo(entry, t) {
  const title = entry.direction === 'outbound'
    ? t('infoDirectionSending', entry.peerId.slice(0, 8))
    : t('infoDirectionReceiving', entry.peerId.slice(0, 8));

  const rows = [[t('infoFieldState'), entry.connectionState]];

  if (entry.codec) {
    rows.push([t('infoFieldCodec'), entry.codecParams ? `${entry.codec} (${entry.codecParams})` : entry.codec]);
  }
  if (entry.frameWidth && entry.frameHeight) {
    rows.push([t('infoFieldResolution'), `${entry.frameWidth}×${entry.frameHeight}`]);
  }
  if (entry.framesPerSecond !== undefined) {
    rows.push([t('infoFieldFramerate'), `${Math.round(entry.framesPerSecond)} fps`]);
  }
  if (entry.bitrateKbps !== undefined) {
    rows.push([t('infoFieldBitrate'), `${entry.bitrateKbps} kbps`]);
  }
  if (entry.packetsLost !== undefined && entry.packetsReceived !== undefined) {
    const total = entry.packetsLost + entry.packetsReceived;
    const lossPercent = total > 0 ? ((entry.packetsLost / total) * 100).toFixed(1) : '0.0';
    rows.push([t('infoFieldPacketLoss'), `${lossPercent}% (${entry.packetsLost})`]);
  }
  if (entry.currentRoundTripTime !== undefined) {
    rows.push([t('infoFieldRtt'), `${Math.round(entry.currentRoundTripTime * 1000)} ms`]);
  }
  if (entry.localCandidateType || entry.remoteCandidateType) {
    rows.push([t('infoFieldCandidateType'), `${entry.localCandidateType ?? '?'} / ${entry.remoteCandidateType ?? '?'}`]);
  }
  if (entry.qualityLimitationReason) {
    rows.push([t('infoFieldQualityLimitation'), qualityLimitationLabel(entry.qualityLimitationReason, t)]);
  }

  const rowsHtml = rows
    .map(([label, value]) => `<div class="info-row"><span class="info-row-label">${escapeHtml(label)}</span><span>${escapeHtml(String(value))}</span></div>`)
    .join('');

  return `<div class="info-connection"><h3>${escapeHtml(title)}</h3>${rowsHtml}</div>`;
}

function qualityLimitationLabel(reason, t) {
  if (reason === 'cpu') return t('infoQualityCpu');
  if (reason === 'bandwidth') return t('infoQualityBandwidth');
  if (reason === 'none') return t('infoQualityNone');
  return t('infoQualityOther');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main();
