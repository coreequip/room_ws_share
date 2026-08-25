export const config = {
  roomwsUrl: new URLSearchParams(location.search).get('roomws') || 'wss://live.room.ws',
  // ?? rather than ||, so that an explicit "?turn=" switches the relay off for
  // testing without falling back to the default endpoint.
  turnCredentialsUrl: new URLSearchParams(location.search).get('turn') ?? 'https://live.room.ws/turn',
  stunServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};
