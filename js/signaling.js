import { parsePresence } from './presence.js?v=c4a7d4';
import { makeOffer, makeAnswer, makeIce, makeStop, makeRestart, makePresence, isAddressedTo, isSignalingMessage } from './signaling-protocol.js?v=e4652b';

export class Signaling {
  constructor(room, clientId) {
    this.room = room;
    this.clientId = clientId;
    this.listeners = { offer: [], answer: [], ice: [], stop: [], restart: [], presence: [], open: [], members: [], memberJoin: [], memberLeave: [] };

    room.on('message', (message, envelope) => {
      if (!isSignalingMessage(message)) return;
      const from = envelope.client_id;
      if (message.type === 'presence') {
        const presence = parsePresence(message);
        if (presence && from !== this.clientId) this._emit('presence', { from, ...presence });
        return;
      }
      if (message.type !== 'share-stop' && !isAddressedTo(message, this.clientId)) return;

      if (message.type === 'share-offer') this._emit('offer', { from, streamId: message.stream_id, sdp: message.sdp });
      else if (message.type === 'share-answer') this._emit('answer', { from, streamId: message.stream_id, sdp: message.sdp });
      else if (message.type === 'share-ice') this._emit('ice', { from, streamId: message.stream_id, candidate: message.candidate });
      else if (message.type === 'share-stop') this._emit('stop', { from, streamId: message.stream_id });
      else if (message.type === 'share-restart') this._emit('restart', { from, streamId: message.stream_id });
    });

    // Fires on the first subscribe and again after every reconnect, which is
    // exactly when the room needs to hear who this client is.
    room.on('open', () => this._emit('open'));
    room.on('members', (members) => this._emit('members', members));
    room.on('member_join', (peerId) => this._emit('memberJoin', peerId));
    room.on('member_leave', (peerId) => this._emit('memberLeave', peerId));
  }

  get members() {
    return this.room.members;
  }

  on(event, callback) {
    this.listeners[event].push(callback);
  }

  _emit(event, payload) {
    this.listeners[event].forEach((cb) => cb(payload));
  }

  sendOffer(to, streamId, sdp) {
    this.room.drone.publish({ room: this.room.name, message: makeOffer(to, streamId, sdp), no_echo: true });
  }

  sendAnswer(to, streamId, sdp) {
    this.room.drone.publish({ room: this.room.name, message: makeAnswer(to, streamId, sdp), no_echo: true });
  }

  sendIce(to, streamId, candidate) {
    this.room.drone.publish({ room: this.room.name, message: makeIce(to, streamId, candidate), no_echo: true });
  }

  sendRestart(to, streamId) {
    this.room.drone.publish({ room: this.room.name, message: makeRestart(to, streamId), no_echo: true });
  }

  sendPresence(presence, options) {
    this.room.drone.publish({ room: this.room.name, message: makePresence(presence, options), no_echo: true });
  }

  sendStop(streamId) {
    this.room.drone.publish({ room: this.room.name, message: makeStop(streamId), no_echo: true });
  }
}
