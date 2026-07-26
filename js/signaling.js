import { makeOffer, makeAnswer, makeIce, makeStop, isAddressedTo, isSignalingMessage } from './signaling-protocol.js?v=f51148';

export class Signaling {
  constructor(room, clientId) {
    this.room = room;
    this.clientId = clientId;
    this.listeners = { offer: [], answer: [], ice: [], stop: [], members: [], memberJoin: [], memberLeave: [] };

    room.on('message', (message, envelope) => {
      if (!isSignalingMessage(message)) return;
      if (message.type !== 'share-stop' && !isAddressedTo(message, this.clientId)) return;

      const from = envelope.client_id;
      if (message.type === 'share-offer') this._emit('offer', { from, streamId: message.stream_id, sdp: message.sdp });
      else if (message.type === 'share-answer') this._emit('answer', { from, streamId: message.stream_id, sdp: message.sdp });
      else if (message.type === 'share-ice') this._emit('ice', { from, streamId: message.stream_id, candidate: message.candidate });
      else if (message.type === 'share-stop') this._emit('stop', { from, streamId: message.stream_id });
    });

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

  sendStop(streamId) {
    this.room.drone.publish({ room: this.room.name, message: makeStop(streamId), no_echo: true });
  }
}
