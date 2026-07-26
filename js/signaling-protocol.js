export function generateStreamId(clientId) {
  return `${clientId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function makeOffer(to, streamId, sdp) {
  return { type: 'share-offer', to, stream_id: streamId, sdp };
}

export function makeAnswer(to, streamId, sdp) {
  return { type: 'share-answer', to, stream_id: streamId, sdp };
}

export function makeIce(to, streamId, candidate) {
  return { type: 'share-ice', to, stream_id: streamId, candidate };
}

export function makeStop(streamId) {
  return { type: 'share-stop', stream_id: streamId };
}

export function isAddressedTo(message, clientId) {
  return !!message && message.to === clientId;
}

export function isSignalingMessage(message) {
  return !!message && ['share-offer', 'share-answer', 'share-ice', 'share-stop'].includes(message.type);
}
