const strings = {
  de: {
    shareStart: 'Bildschirm teilen (S)',
    shareStop: 'Teilen stoppen (S)',
    copyLink: 'Link kopieren (C)',
    copyLinkCopied: 'Link kopiert!',
    fullscreenEnter: 'Vollbild (F)',
    fullscreenExit: 'Vollbild beenden (F)',
    zoomEnter: 'Zoom (Z)',
    zoomExit: 'Zoom beenden (Z)',
    statusConnecting: 'Verbinde…',
    statusWaitingForShare: 'Warte auf Bildschirmfreigabe…',
    statusConnectError: (error) => `Verbindung fehlgeschlagen: ${error}`,
    shareDenied: 'Bildschirmfreigabe abgebrochen oder verweigert.',
    tileConnectionFailed: 'Verbindung fehlgeschlagen',
    youLabel: 'Du',
    infoLabel: 'Verbindungsinfo (I)',
    infoClose: 'Schließen',
    infoNoConnections: 'Keine aktive Verbindung.',
    infoDirectionSending: (peerId) => `Du teilst mit ${peerId}`,
    infoDirectionReceiving: (peerId) => `${peerId} teilt mit dir`,
    infoFieldState: 'Verbindungsstatus',
    infoFieldCodec: 'Codec',
    infoFieldResolution: 'Auflösung',
    infoFieldFramerate: 'Framerate',
    infoFieldBitrate: 'Bitrate',
    infoFieldPacketLoss: 'Paketverlust',
    infoFieldRtt: 'Round-Trip-Zeit',
    infoFieldCandidateType: 'Verbindungsart',
    infoFieldQualityLimitation: 'Qualitätslimit',
    infoQualityNone: 'Keine',
    infoQualityCpu: 'CPU',
    infoQualityBandwidth: 'Bandbreite',
    infoQualityOther: 'Sonstige',
    memberCountText: (count) => `${count} Benutzer`,
    memberWidgetNoShare: 'Keine Freigabe',
    memberWidgetBitrate: (kbps) => `${kbps} kbps`,
    memberJoined: (peerId) => `${peerId} ist beigetreten`,
    memberLeft: (peerId) => `${peerId} hat den Raum verlassen`,
  },
  en: {
    shareStart: 'Share screen (S)',
    shareStop: 'Stop sharing (S)',
    copyLink: 'Copy link (C)',
    copyLinkCopied: 'Link copied!',
    fullscreenEnter: 'Fullscreen (F)',
    fullscreenExit: 'Exit fullscreen (F)',
    zoomEnter: 'Zoom (Z)',
    zoomExit: 'Exit zoom (Z)',
    statusConnecting: 'Connecting…',
    statusWaitingForShare: 'Waiting for someone to share…',
    statusConnectError: (error) => `Connection failed: ${error}`,
    shareDenied: 'Screen sharing was cancelled or denied.',
    tileConnectionFailed: 'Connection failed',
    youLabel: 'You',
    infoLabel: 'Connection info (I)',
    infoClose: 'Close',
    infoNoConnections: 'No active connection.',
    infoDirectionSending: (peerId) => `You're sharing with ${peerId}`,
    infoDirectionReceiving: (peerId) => `${peerId} is sharing with you`,
    infoFieldState: 'Connection state',
    infoFieldCodec: 'Codec',
    infoFieldResolution: 'Resolution',
    infoFieldFramerate: 'Frame rate',
    infoFieldBitrate: 'Bitrate',
    infoFieldPacketLoss: 'Packet loss',
    infoFieldRtt: 'Round-trip time',
    infoFieldCandidateType: 'Connection type',
    infoFieldQualityLimitation: 'Quality limitation',
    infoQualityNone: 'None',
    infoQualityCpu: 'CPU',
    infoQualityBandwidth: 'Bandwidth',
    infoQualityOther: 'Other',
    memberCountText: (count) => `${count} user${count === 1 ? '' : 's'}`,
    memberWidgetNoShare: 'No active share',
    memberWidgetBitrate: (kbps) => `${kbps} kbps`,
    memberJoined: (peerId) => `${peerId} joined`,
    memberLeft: (peerId) => `${peerId} left the room`,
  },
};

export function detectLocale(languages = (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [])) {
  for (const lang of languages) {
    const primary = lang.slice(0, 2).toLowerCase();
    if (primary in strings) return primary;
  }
  return 'en';
}

export function createTranslator(locale) {
  const dict = strings[locale] || strings.en;
  return function t(key, ...args) {
    const entry = dict[key] ?? strings.en[key];
    return typeof entry === 'function' ? entry(...args) : entry;
  };
}
