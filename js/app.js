import { config } from './config.js?v=04d282';
import { detectLocale, createTranslator } from './i18n.js?v=c240a9';
import { generateRoomId, getRoomIdFromLocation, roomIdToHash } from './room-id.js?v=b0533e';
import { Signaling } from './signaling.js?v=c727e9';
import { PeerManager } from './peers.js?v=ea0067';
import { Ui } from './ui.js?v=119b51';

const COPY_FEEDBACK_MS = 2000;
const STATS_POLL_MS = 1000;

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

  const ui = new Ui({
    root: document,
    t,
    onShareClick: () => toggleSharing(),
    onCopyLinkClick: () => copyLink(),
    onFullscreenClick: () => ui.toggleFullscreen(),
    onZoomClick: () => ui.toggleZoom(),
    onInfoClick: () => toggleInfoModal(),
    onInfoModalClose: () => closeInfoModal(),
  });
  ui.setConnecting(true);
  ui.setShareBusy(true);
  ui.setInfoBusy(true);

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 's') toggleSharing();
    if (key === 'c') copyLink();
    if (key === 'f') ui.toggleFullscreen();
    if (key === 'z') ui.toggleZoom();
    if (key === 'i') toggleInfoModal();
    if (key === 'escape') {
      // A mouse click focuses the button in some browsers; pressing Escape
      // right after can make that stale focus suddenly render as
      // :focus-visible. Escape never activates a button, so blurring here
      // is always safe (unlike doing this for every key, which could
      // interfere with Enter/Space activating a genuinely keyboard-focused
      // button).
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
      closeInfoModal();
    }
  });

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
    if (error) {
      connectionFailed = true;
      ui.setStatus(t('statusConnectError', error));
      return;
    }
    connectionFailed = false;
    if (signaling) signaling.clientId = drone.clientId;
    if (initialized) {
      ui.setStatus(t('statusWaitingForShare'));
      return;
    }
    initialized = true;
    ui.setShareBusy(false);
    ui.setInfoBusy(false);

    const room = drone.subscribe(roomId);
    signaling = new Signaling(room, drone.clientId);
    peers = new PeerManager({
      stunServers: config.stunServers,
      signaling,
      onRemoteTrack: (peerId, streamId, stream) => ui.addRemoteTrack(peerId, streamId, stream),
      onConnectionStateChange: (peerId, streamId, state) => {
        if (state === 'failed') ui.showConnectionFailed(peerId, streamId);
        if (state === 'closed' || state === 'disconnected') ui.removeTile(peerId, streamId);
      },
    });

    signaling.on('members', (members) => ui.setMemberCount(members.length));

    signaling.on('memberJoin', (peerId) => {
      if (localStream && localStreamId) {
        peers.addLateJoiner(peerId, localStreamId, localStream);
      }
      ui.setMemberCount(signaling.members.length);
      ui.showToast(t('memberJoined', peerId.slice(0, 8)));
    });

    signaling.on('memberLeave', (peerId) => {
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
    videoTrack.addEventListener('ended', () => stopSharing());
    ui.showLocalPreview(localStream);
    ui.setSharing(true);
    sharingBusy = false;
    ui.setShareBusy(false);
    await peers.startSharing(localStream, localStreamId);
  }

  function stopSharing() {
    if (!localStream) return;
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
      ui.setInfoContent(renderInfoHtml(lastStats, t));
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
    if (lastStats.length === 0) {
      ui.setShareActivity(null);
    } else {
      const totalBitrateKbps = lastStats.reduce((sum, entry) => sum + (entry.bitrateKbps || 0), 0);
      ui.setShareActivity(totalBitrateKbps);
    }
    if (infoModalVisible) ui.setInfoContent(renderInfoHtml(lastStats, t));
  }
}

function renderInfoHtml(stats, t) {
  if (stats.length === 0) return `<p>${escapeHtml(t('infoNoConnections'))}</p>`;
  return stats.map((entry) => renderConnectionInfo(entry, t)).join('');
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
