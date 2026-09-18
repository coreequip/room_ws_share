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

// Sent by a viewer whose stream broke: only the sharer holds the media track,
// so only the sharer can build a fresh connection for it.
export function makeRestart(to, streamId) {
  return { type: 'share-restart', to, stream_id: streamId };
}

// Broadcast to the whole room: who this client is, and whether it is sharing.
// `hello` marks the announcement a client makes on entering the room -- the
// others answer it with their own presence, which is how a newcomer learns
// about everyone who was already there.
export function makePresence({ name, browser, os, sharing }, { hello = false } = {}) {
  return { type: 'presence', name, browser, os, sharing, hello };
}

export function isAddressedTo(message, clientId) {
  return !!message && message.to === clientId;
}

export function isSignalingMessage(message) {
  return !!message && ['share-offer', 'share-answer', 'share-ice', 'share-stop', 'share-restart', 'presence'].includes(message.type);
}
