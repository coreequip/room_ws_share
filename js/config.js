export const config = {
  roomwsUrl: new URLSearchParams(location.search).get('roomws') || 'wss://live.room.ws',
  stunServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};
