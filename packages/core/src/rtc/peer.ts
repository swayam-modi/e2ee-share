/**
 * Framework-agnostic RTCPeerConnection wrapper.
 * Implements Section 8.3 of the specification.
 */

import {
  ErrorCodes,
  ICE_CONNECT_TIMEOUT_MS,
  ProtocolError,
} from '@e2ee-share/protocol';

export interface PeerOptions {
  iceServers: RTCIceServer[];
  role: 'sender' | 'receiver';
  forceRelay?: boolean; // sets iceTransportPolicy: 'relay' for TURN testing
  RTCPeerConnectionCtor?: typeof RTCPeerConnection; // injection for tests
}

export interface PeerEvents {
  iceCandidate: (candidate: RTCIceCandidateInit) => void;
  channelOpen: (channel: RTCDataChannel) => void;
  channelClose: () => void;
  connectionStateChange: (state: RTCPeerConnectionState) => void;
  error: (err: ProtocolError) => void;
}

export interface Peer {
  createOffer(): Promise<string>;
  acceptOffer(sdp: string): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
  on<K extends keyof PeerEvents>(event: K, handler: PeerEvents[K]): () => void;
}

export function createPeer(options: PeerOptions): Peer {
  const Ctor = options.RTCPeerConnectionCtor ?? globalThis.RTCPeerConnection;
  if (!Ctor) {
    throw new ProtocolError(
      ErrorCodes.ICE_FAILED,
      'RTCPeerConnection is not available in the current environment'
    );
  }

  const rtcConfig: RTCConfiguration = {
    iceServers: options.iceServers,
    iceTransportPolicy: options.forceRelay ? 'relay' : 'all',
  };

  const pc = new Ctor(rtcConfig);
  let dataChannel: RTCDataChannel | null = null;
  let isClosed = false;
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  const listeners = new Map<
    keyof PeerEvents,
    Set<PeerEvents[keyof PeerEvents]>
  >();

  function emit<K extends keyof PeerEvents>(
    event: K,
    ...args: Parameters<PeerEvents[K]>
  ): void {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch {
        // Suppress listener errors
      }
    }
  }

  // 30-second connect timeout
  let connectTimeoutTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (isClosed) return;
    const currentState = pc.connectionState;
    if (currentState !== 'connected') {
      const err = new ProtocolError(
        ErrorCodes.ICE_FAILED,
        'WebRTC connection failed: timeout after 30 seconds without reaching connected state'
      );
      emit('connectionStateChange', 'failed');
      emit('error', err);
    }
  }, ICE_CONNECT_TIMEOUT_MS);

  function clearTimer(): void {
    if (connectTimeoutTimer !== null) {
      clearTimeout(connectTimeoutTimer);
      connectTimeoutTimer = null;
    }
  }

  function handleStateChange(): void {
    if (isClosed) return;
    const state = pc.connectionState;
    if (!state) return;

    emit('connectionStateChange', state);

    if (state === 'connected') {
      clearTimer();
    } else if (state === 'failed') {
      clearTimer();
      emit(
        'error',
        new ProtocolError(ErrorCodes.ICE_FAILED, 'WebRTC connection state failed')
      );
    }
  }

  // Hook connectionstatechange and iceconnectionstatechange
  if (typeof pc.addEventListener === 'function') {
    pc.addEventListener('connectionstatechange', handleStateChange);
  }
  const origOnConnectionStateChange = pc.onconnectionstatechange;
  pc.onconnectionstatechange = function (this: RTCPeerConnection, ev: Event) {
    handleStateChange();
    origOnConnectionStateChange?.call(this, ev);
  };

  // Trickle ICE: emit local candidates as they arrive
  const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (isClosed) return;
    if (event.candidate) {
      const candidateInit: RTCIceCandidateInit =
        typeof event.candidate.toJSON === 'function'
          ? event.candidate.toJSON()
          : {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              usernameFragment: event.candidate.usernameFragment,
            };
      emit('iceCandidate', candidateInit);
    }
  };

  if (typeof pc.addEventListener === 'function') {
    pc.addEventListener('icecandidate', handleIceCandidate as EventListener);
  }
  const origOnIceCandidate = pc.onicecandidate;
  pc.onicecandidate = function (this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) {
    handleIceCandidate(ev);
    origOnIceCandidate?.call(this, ev);
  };

  function setupChannel(dc: RTCDataChannel): void {
    dataChannel = dc;
    dc.binaryType = 'arraybuffer';

    const handleOpen = () => {
      if (isClosed) return;
      emit('channelOpen', dc);
    };

    const handleClose = () => {
      emit('channelClose');
    };

    if (dc.readyState === 'open') {
      queueMicrotask(handleOpen);
    } else {
      if (typeof dc.addEventListener === 'function') {
        dc.addEventListener('open', handleOpen);
        dc.addEventListener('close', handleClose);
      }
      const origOnOpen = dc.onopen;
      dc.onopen = function (this: RTCDataChannel, ev: Event) {
        handleOpen();
        origOnOpen?.call(this, ev);
      };
      const origOnClose = dc.onclose;
      dc.onclose = function (this: RTCDataChannel, ev: Event) {
        handleClose();
        origOnClose?.call(this, ev);
      };
    }
  }

  // Receiver gets the channel via ondatachannel
  if (options.role === 'receiver') {
    const handleDataChannel = (event: RTCDataChannelEvent) => {
      if (isClosed) return;
      setupChannel(event.channel);
    };

    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('datachannel', handleDataChannel as EventListener);
    }
    const origOnDataChannel = pc.ondatachannel;
    pc.ondatachannel = function (this: RTCPeerConnection, ev: RTCDataChannelEvent) {
      handleDataChannel(ev);
      origOnDataChannel?.call(this, ev);
    };
  }

  async function flushPendingCandidates(): Promise<void> {
    while (pendingRemoteCandidates.length > 0) {
      const candidate = pendingRemoteCandidates.shift()!;
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Non-fatal if single candidate cannot be added
      }
    }
  }

  return {
    async createOffer(): Promise<string> {
      if (isClosed) {
        throw new ProtocolError(ErrorCodes.ICE_FAILED, 'Peer connection is closed');
      }

      if (options.role === 'sender' && !dataChannel) {
        const dc = pc.createDataChannel('transfer', { ordered: true });
        setupChannel(dc);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      return offer.sdp ?? '';
    },

    async acceptOffer(sdp: string): Promise<string> {
      if (isClosed) {
        throw new ProtocolError(ErrorCodes.ICE_FAILED, 'Peer connection is closed');
      }

      await pc.setRemoteDescription({ type: 'offer', sdp });
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return answer.sdp ?? '';
    },

    async acceptAnswer(sdp: string): Promise<void> {
      if (isClosed) {
        throw new ProtocolError(ErrorCodes.ICE_FAILED, 'Peer connection is closed');
      }

      await pc.setRemoteDescription({ type: 'answer', sdp });
      await flushPendingCandidates();
    },

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
      if (isClosed) return;

      if (!pc.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        return;
      }

      await pc.addIceCandidate(candidate);
    },

    close(): void {
      if (isClosed) return;
      isClosed = true;
      clearTimer();

      if (dataChannel) {
        try {
          dataChannel.close();
        } catch {
          // Ignore
        }
        dataChannel = null;
      }

      try {
        pc.close();
      } catch {
        // Ignore
      }

      listeners.clear();
      pendingRemoteCandidates.length = 0;
    },

    on<K extends keyof PeerEvents>(event: K, handler: PeerEvents[K]): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as PeerEvents[keyof PeerEvents]);
      return () => {
        set?.delete(handler as PeerEvents[keyof PeerEvents]);
      };
    },
  };
}
