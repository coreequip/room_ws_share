export class PeerManager {
  constructor({ stunServers, signaling, onRemoteTrack, onConnectionStateChange }) {
    this.stunServers = stunServers;
    this.signaling = signaling;
    this.onRemoteTrack = onRemoteTrack;
    this.onConnectionStateChange = onConnectionStateChange;
    this.connections = new Map(); // peerId -> Map<streamId, RTCPeerConnection>
    this.pendingCandidates = new Map(); // `${peerId}:${streamId}` -> RTCIceCandidateInit[]
    this.statsHistory = new Map(); // `${peerId}:${streamId}` -> { bytes, timestamp } for bitrate deltas

    signaling.on('offer', ({ from, streamId, sdp }) => this._handleOffer(from, streamId, sdp));
    signaling.on('answer', ({ from, streamId, sdp }) => this._handleAnswer(from, streamId, sdp));
    signaling.on('ice', ({ from, streamId, candidate }) => this._handleIce(from, streamId, candidate));
    signaling.on('stop', ({ streamId }) => this._handleStop(streamId));
    signaling.on('memberLeave', (peerId) => this._handlePeerLeave(peerId));
  }

  async startSharing(stream, streamId) {
    const targets = this.signaling.members.filter((id) => id !== this.signaling.clientId);
    await Promise.all(targets.map((peerId) => this._createOutgoing(peerId, streamId, stream)));
  }

  async addLateJoiner(peerId, streamId, stream) {
    await this._createOutgoing(peerId, streamId, stream);
  }

  stopSharing(streamId) {
    this._handleStop(streamId);
    this.signaling.sendStop(streamId);
  }

  async _createOutgoing(peerId, streamId, stream) {
    const pc = this._createConnection(peerId, streamId);
    stream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') {
        this._preferResolutionOverFramerate(sender);
        this._preferSharpCodec(pc, sender);
      }
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendOffer(peerId, streamId, pc.localDescription);
  }

  _preferResolutionOverFramerate(sender) {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings.forEach((encoding) => {
      encoding.degradationPreference = 'maintain-resolution';
    });
    sender.setParameters(params).catch((err) => console.error('PeerManager: failed to set encoding parameters', err));
  }

  _preferSharpCodec(pc, sender) {
    if (typeof RTCRtpReceiver === 'undefined' || !RTCRtpReceiver.getCapabilities) return;
    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    if (!transceiver || !('setCodecPreferences' in transceiver)) return;
    const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs;
    if (!codecs) return;

    const av1 = [];
    const highProfile = [];
    const otherVp9 = [];
    const rest = [];
    for (const codec of codecs) {
      const mime = codec.mimeType.toLowerCase();
      const isVp9 = mime === 'video/vp9';
      if (mime === 'video/av1') av1.push(codec);
      else if (isVp9 && codec.sdpFmtpLine?.includes('profile-id=2')) highProfile.push(codec);
      else if (isVp9) otherVp9.push(codec);
      else rest.push(codec);
    }
    transceiver.setCodecPreferences([...av1, ...highProfile, ...otherVp9, ...rest]);
  }

  async _handleOffer(from, streamId, sdp) {
    const pc = this._createConnection(from, streamId);
    try {
      await pc.setRemoteDescription(sdp);
      await this._flushCandidates(from, streamId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendAnswer(from, streamId, pc.localDescription);
    } catch (err) {
      console.error('PeerManager: failed to handle offer', err);
      this._cleanupConnection(from, streamId);
    }
  }

  async _handleAnswer(from, streamId, sdp) {
    const pc = this._getConnection(from, streamId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(sdp);
      await this._flushCandidates(from, streamId, pc);
    } catch (err) {
      console.error('PeerManager: failed to handle answer', err);
      this._cleanupConnection(from, streamId);
    }
  }

  async _handleIce(from, streamId, candidate) {
    const pc = this._getConnection(from, streamId);
    if (!pc || !pc.remoteDescription) {
      const key = `${from}:${streamId}`;
      const queue = this.pendingCandidates.get(key) || [];
      queue.push(candidate);
      this.pendingCandidates.set(key, queue);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('PeerManager: failed to add ICE candidate', err);
      this._cleanupConnection(from, streamId);
    }
  }

  async _flushCandidates(peerId, streamId, pc) {
    const key = `${peerId}:${streamId}`;
    const queue = this.pendingCandidates.get(key) || [];
    this.pendingCandidates.delete(key);
    for (const candidate of queue) {
      await pc.addIceCandidate(candidate);
    }
  }

  _handleStop(streamId) {
    for (const [peerId, streams] of this.connections.entries()) {
      if (streams.has(streamId)) this._cleanupConnection(peerId, streamId);
    }
  }

  _handlePeerLeave(peerId) {
    const streams = this.connections.get(peerId);
    if (!streams) return;
    for (const [streamId, pc] of streams.entries()) {
      pc.close();
      this.onConnectionStateChange(peerId, streamId, 'closed');
    }
    const prefix = `${peerId}:`;
    for (const key of this.pendingCandidates.keys()) {
      if (key.startsWith(prefix)) this.pendingCandidates.delete(key);
    }
    for (const key of this.statsHistory.keys()) {
      if (key.startsWith(prefix)) this.statsHistory.delete(key);
    }
    this.connections.delete(peerId);
  }

  _cleanupConnection(peerId, streamId) {
    const streams = this.connections.get(peerId);
    if (streams) {
      const pc = streams.get(streamId);
      if (pc) {
        pc.close();
        this.onConnectionStateChange(peerId, streamId, 'closed');
      }
      streams.delete(streamId);
    }
    this.pendingCandidates.delete(`${peerId}:${streamId}`);
    this.statsHistory.delete(`${peerId}:${streamId}`);
  }

  _createConnection(peerId, streamId) {
    const existingStreams = this.connections.get(peerId);
    if (existingStreams && existingStreams.has(streamId)) {
      existingStreams.get(streamId).close();
    }
    const pc = new RTCPeerConnection({ iceServers: this.stunServers });
    if (!this.connections.has(peerId)) this.connections.set(peerId, new Map());
    this.connections.get(peerId).set(streamId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) this.signaling.sendIce(peerId, streamId, event.candidate);
    };
    pc.ontrack = (event) => this.onRemoteTrack(peerId, streamId, event.streams[0]);
    pc.onconnectionstatechange = () => this.onConnectionStateChange(peerId, streamId, pc.connectionState);

    return pc;
  }

  _getConnection(peerId, streamId) {
    const streams = this.connections.get(peerId);
    return streams ? streams.get(streamId) : undefined;
  }

  async getConnectionStats() {
    const results = [];
    for (const [peerId, streams] of this.connections.entries()) {
      for (const [streamId, pc] of streams.entries()) {
        results.push(await this._summarizeStats(peerId, streamId, pc));
      }
    }
    return results;
  }

  async _summarizeStats(peerId, streamId, pc) {
    const report = await pc.getStats();
    const summary = { peerId, streamId, connectionState: pc.connectionState };
    let codecId = null;
    let localCandidateId = null;
    let remoteCandidateId = null;
    let bytes = null;
    let timestamp = null;

    for (const stat of report.values()) {
      if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
        summary.direction = 'outbound';
        summary.frameWidth = stat.frameWidth;
        summary.frameHeight = stat.frameHeight;
        summary.framesPerSecond = stat.framesPerSecond;
        summary.qualityLimitationReason = stat.qualityLimitationReason;
        codecId = stat.codecId;
        bytes = stat.bytesSent;
        timestamp = stat.timestamp;
      } else if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
        summary.direction = 'inbound';
        summary.frameWidth = stat.frameWidth;
        summary.frameHeight = stat.frameHeight;
        summary.framesPerSecond = stat.framesPerSecond;
        summary.packetsLost = stat.packetsLost;
        summary.packetsReceived = stat.packetsReceived;
        codecId = stat.codecId;
        bytes = stat.bytesReceived;
        timestamp = stat.timestamp;
      } else if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
        summary.currentRoundTripTime = stat.currentRoundTripTime;
        localCandidateId = stat.localCandidateId;
        remoteCandidateId = stat.remoteCandidateId;
      }
    }

    if (codecId && report.has(codecId)) {
      const codec = report.get(codecId);
      summary.codec = codec.mimeType;
      summary.codecParams = codec.sdpFmtpLine;
    }
    if (localCandidateId && report.has(localCandidateId)) {
      summary.localCandidateType = report.get(localCandidateId).candidateType;
    }
    if (remoteCandidateId && report.has(remoteCandidateId)) {
      summary.remoteCandidateType = report.get(remoteCandidateId).candidateType;
    }

    const key = `${peerId}:${streamId}`;
    if (bytes !== null && timestamp !== null) {
      const previous = this.statsHistory.get(key);
      if (previous) {
        const deltaBytes = bytes - previous.bytes;
        const deltaMs = timestamp - previous.timestamp;
        if (deltaMs > 0) summary.bitrateKbps = Math.max(0, Math.round((deltaBytes * 8) / deltaMs));
      }
      this.statsHistory.set(key, { bytes, timestamp });
    }

    return summary;
  }
}
