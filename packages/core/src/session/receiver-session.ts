/**
 * Receiver session state machine and handshake implementation.
 * Implements Sections 5.5 and 8.8 of the specification.
 */

import {
  ProtocolError,
  ErrorCodes,
  type ServerMessage,
  type Envelope,
  DIRECTION_RECEIVER,
} from '@e2ee-share/protocol';
import { toBase64Url, fromBase64Url } from '../crypto/random.js';
import { deriveAuthKey } from '../crypto/kdf.js';
import {
  generateReceiverKeyPair,
  exportSpki,
  unwrapSessionKey,
} from '../crypto/rsa.js';
import { fingerprint } from '../crypto/fingerprint.js';
import { SignalingClient, type WebSocketConstructor } from '../signaling/client.js';
import { createEnvelopeManager, type EnvelopeManager } from '../signaling/envelope.js';
import { createPeer, type Peer } from '../rtc/peer.js';
import { createChannel, type Channel } from '../rtc/channel.js';
import { sendControl } from '../transfer/control.js';
import { FileReceiver, type FileOfferInfo } from '../transfer/receiver.js';
import type { FileSink } from '../transfer/sinks/sink.js';
import type { ReceiverState, SessionEvents } from './types.js';

export interface ReceiverSessionOptions {
  roomId: string;
  secret: Uint8Array;
  serverUrl: string;
  WebSocketCtor?: typeof WebSocket | WebSocketConstructor;
  RTCPeerConnectionCtor?: typeof RTCPeerConnection;
  forceRelay?: boolean;
  /**
   * Called when a file-offer arrives. Return a FileSink to accept,
   * or null to reject. If omitted, all offers are rejected.
   */
  onFileOffer?: (offer: FileOfferInfo) => Promise<FileSink | null>;
}

const VALID_RECEIVER_TRANSITIONS: Record<ReceiverState, readonly ReceiverState[]> = {
  idle: ['preparingKeys', 'failed'],
  preparingKeys: ['joining', 'failed'],
  joining: ['waitingForKey', 'failed'],
  waitingForKey: ['rtcConnecting', 'ready', 'failed'],
  rtcConnecting: ['ready', 'failed'],
  ready: ['receiving', 'done', 'failed'],
  receiving: ['done', 'failed'],
  done: [],
  failed: [],
};

export class ReceiverSession {
  private readonly options: ReceiverSessionOptions;
  private readonly roomId: string;
  private readonly secret: Uint8Array;
  private readonly envelopeManager: EnvelopeManager;
  private readonly keyPairPromise: Promise<CryptoKeyPair>;

  private currentState: ReceiverState = 'idle';
  private keyPair: CryptoKeyPair | null = null;
  private client: SignalingClient | null = null;
  private authKey: CryptoKey | null = null;
  private sessionKey: CryptoKey | null = null;

  private peer: Peer | null = null;
  private channel: Channel | null = null;
  private controlSeqOut = 0;
  private initRtcPromise: Promise<void> | null = null;

  private isClosed = false;

  /** Pending file-offer callbacks keyed by fileIndex. */
  private pendingOffers = new Map<
    number,
    { resolve: (sink: FileSink | null) => void }
  >();

  private readonly listeners = new Map<
    keyof SessionEvents<ReceiverState>,
    Set<SessionEvents<ReceiverState>[keyof SessionEvents<ReceiverState>]>
  >();

  constructor(options: ReceiverSessionOptions) {
    if (options.secret.byteLength !== 32) {
      throw new Error(`Invalid secret length: expected 32 bytes, got ${options.secret.byteLength}`);
    }
    this.options = options;
    this.roomId = options.roomId;
    this.secret = new Uint8Array(options.secret);
    this.envelopeManager = createEnvelopeManager();

    // Start RSA-OAEP key pair generation immediately in constructor for speed (Section 5.6 & 8.1)
    this.keyPairPromise = generateReceiverKeyPair();
  }

  get state(): ReceiverState {
    return this.currentState;
  }

  on<K extends keyof SessionEvents<ReceiverState>>(
    event: K,
    handler: SessionEvents<ReceiverState>[K]
  ): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler as SessionEvents<ReceiverState>[keyof SessionEvents<ReceiverState>]);
    return () => {
      handlers?.delete(handler as SessionEvents<ReceiverState>[keyof SessionEvents<ReceiverState>]);
    };
  }

  /**
   * Start: prepare keys, join room, and send public key.
   * Transitions: idle → preparingKeys → joining → waitingForKey.
   */
  async start(): Promise<void> {
    if (this.currentState !== 'idle') {
      throw new Error(`Cannot start receiver session from state: ${this.currentState}`);
    }

    // 1. Preparing keys
    this.setState('preparingKeys');

    try {
      this.keyPair = await this.keyPairPromise;
      this.authKey = await deriveAuthKey(this.secret, this.roomId);
    } catch (err) {
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Failed to prepare receiver keys');
      this.failAndClose(protocolErr);
      throw protocolErr;
    }

    // 2. Joining
    this.setState('joining');

    const normalizedServerUrl = this.options.serverUrl.replace(/\/+$/, '');
    const wsUrl = this.buildWsUrl(normalizedServerUrl);

    this.client = new SignalingClient({
      url: wsUrl,
      WebSocketCtor: this.options.WebSocketCtor,
      onMessage: (msg) => {
        void this.handleServerMessage(msg);
      },
      onClose: (_code, _reason) => {
        this.handleSocketClose();
      },
      onError: (_err) => {
        // Socket errors lead to close
      },
    });

    // 3. Send join message
    this.client.send({
      kind: 'join',
      roomId: this.roomId,
      role: 'receiver',
    });
  }

  /**
   * Reject the connection.
   */
  reject(): void {
    if (this.isClosed) return;
    try {
      this.client?.send({ kind: 'bye' });
    } catch {
      // Ignore
    }
    this.setState('failed');
    this.close();
  }

  /**
   * Accept a pending file offer by providing a FileSink.
   * Call from the `fileOffer` event handler.
   */
  acceptOffer(fileIndex: number, sink: FileSink): void {
    const pending = this.pendingOffers.get(fileIndex);
    if (pending) {
      this.pendingOffers.delete(fileIndex);
      pending.resolve(sink);
    }
  }

  /**
   * Reject a pending file offer.
   */
  rejectOffer(fileIndex: number): void {
    const pending = this.pendingOffers.get(fileIndex);
    if (pending) {
      this.pendingOffers.delete(fileIndex);
      pending.resolve(null);
    }
  }

  /**
   * Close all resources and zero key material.
   */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.client) {
      try {
        this.client.close();
      } catch {
        // Ignore
      }
      this.client = null;
    }

    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // Ignore
      }
      this.channel = null;
    }

    if (this.peer) {
      try {
        this.peer.close();
      } catch {
        // Ignore
      }
      this.peer = null;
    }

    this.sessionKey = null;
    this.keyPair = null;
    this.authKey = null;
    this.secret.fill(0);
  }

  /**
   * Get the active DataChannel (if established).
   */
  getChannel(): Channel | null {
    return this.channel;
  }

  /**
   * Get the active Peer instance (if created).
   */
  getPeer(): Peer | null {
    return this.peer;
  }

  /**
   * Test-only method to retrieve the session key.
   * Only accessible in test environment (NODE_ENV === 'test').
   */
  getSessionKeyForTesting(): CryptoKey | null {
    if (process.env['NODE_ENV'] !== 'test') {
      throw new Error('getSessionKeyForTesting is only available in test environment');
    }
    return this.sessionKey;
  }

  private setState(newState: ReceiverState): void {
    if (this.currentState === newState) return;

    const allowed = VALID_RECEIVER_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid receiver state transition from '${this.currentState}' to '${newState}'`
      );
    }

    this.currentState = newState;
    this.emit('stateChange', newState);
  }

  private emit<K extends keyof SessionEvents<ReceiverState>>(
    event: K,
    ...args: Parameters<SessionEvents<ReceiverState>[K]>
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch {
        // Suppress listener error
      }
    }
  }

  private failAndClose(err: ProtocolError): void {
    if (this.isClosed) return;
    if (this.currentState !== 'failed') {
      this.currentState = 'failed';
      this.emit('stateChange', 'failed');
    }
    this.emit('error', err);
    this.close();
  }

  private async handleServerMessage(msg: ServerMessage): Promise<void> {
    if (this.isClosed) return;

    switch (msg.kind) {
      case 'joined': {
        // Successfully joined room; send public key to sender
        await this.sendPublicKey();
        break;
      }
      case 'peer-left': {
        const err = new ProtocolError(ErrorCodes.PEER_LEFT, 'Sender left the room');
        this.failAndClose(err);
        break;
      }
      case 'error': {
        const err = new ProtocolError(msg.code, msg.message);
        this.failAndClose(err);
        break;
      }
      case 'signal': {
        await this.handlePeerSignal(msg.envelope);
        break;
      }
      case 'peer-joined': {
        // Sender arrived after receiver
        break;
      }
    }
  }

  private async sendPublicKey(): Promise<void> {
    if (!this.keyPair || !this.authKey || !this.client) {
      const err = new ProtocolError(
        ErrorCodes.CRYPTO_FAILED,
        'Cannot send public key: session not initialized'
      );
      this.failAndClose(err);
      return;
    }

    try {
      // 1. Export SPKI bytes
      const spkiBytes = await exportSpki(this.keyPair.publicKey);

      // 2. Compute fingerprint and emit event
      const fp = await fingerprint(spkiBytes);
      this.emit('fingerprint', fp);

      // 3. Sign envelope with base64url SPKI
      const body = toBase64Url(spkiBytes);
      await this.sendEnvelope('pubkey', body);

      this.setState('waitingForKey');
    } catch (err) {
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Failed to send public key');
      this.failAndClose(protocolErr);
    }
  }

  private async sendEnvelope(
    type: 'pubkey' | 'wrapped-key' | 'key-ack' | 'sdp-offer' | 'sdp-answer' | 'ice',
    body: string
  ): Promise<void> {
    if (!this.authKey || !this.roomId || !this.client) {
      throw new ProtocolError(ErrorCodes.AUTH_FAILED, 'Cannot send envelope: session not ready');
    }
    const envelope = await this.envelopeManager.sign(
      this.authKey,
      this.roomId,
      'receiver',
      type,
      body
    );
    this.client.send({
      kind: 'signal',
      envelope,
    });
  }

  private async startRtcReceiver(): Promise<void> {
    const init = async () => {
      const normalizedServerUrl = this.options.serverUrl.replace(/\/+$/, '');
      const res = await fetch(`${normalizedServerUrl}/api/ice`);
      if (!res.ok) {
        throw new ProtocolError(
          ErrorCodes.ICE_FAILED,
          `Failed to fetch ICE servers: ${res.status}`
        );
      }
      const { iceServers } = (await res.json()) as { iceServers: RTCIceServer[] };

      this.peer = createPeer({
        iceServers,
        role: 'receiver',
        forceRelay: this.options.forceRelay,
        RTCPeerConnectionCtor: this.options.RTCPeerConnectionCtor,
      });

      this.peer.on('iceCandidate', async (candidate) => {
        try {
          await this.sendEnvelope('ice', JSON.stringify(candidate));
        } catch {
          // Ignore if closing
        }
      });

      this.peer.on('channelOpen', async (dc) => {
        try {
          this.channel = createChannel(dc);
          await sendControl(
            this.channel,
            this.sessionKey!,
            DIRECTION_RECEIVER,
            this.controlSeqOut++,
            { t: 'hello', v: 1, role: 'receiver' }
          );
          this.setState('ready');
          try {
            this.client?.send({ kind: 'bye' });
          } catch {
            // Ignore
          }

          // Start the FileReceiver now that we're ready
          const fileReceiver = new FileReceiver({
            key: this.sessionKey!,
            channel: this.channel,
            onFileOffer: async (offer) => {
              const handler = this.options.onFileOffer;
              if (handler) {
                return handler(offer);
              }
              // No handler registered — emit event and wait for response
              return new Promise<FileSink | null>((resolve) => {
                this.pendingOffers.set(offer.fileIndex, { resolve });
                this.emit('fileOffer' as keyof SessionEvents<ReceiverState>, offer as never);
              });
            },
            onProgress: (p) => this.emit('progress', p),
            onComplete: (_fileIndex) => {
              // No-op per file; session transitions to done when bye arrives
            },
            onError: (err) => {
              this.failAndClose(err);
            },
          });

          void fileReceiver.run().then(
            () => {
              if (!this.isClosed) {
                this.setState('done');
                this.emit('done');
              }
            },
            (err: unknown) => {
              if (!this.isClosed) {
                const protocolErr =
                  err instanceof ProtocolError
                    ? err
                    : new ProtocolError(
                        ErrorCodes.CHANNEL_CLOSED,
                        err instanceof Error ? err.message : String(err)
                      );
                this.failAndClose(protocolErr);
              }
            }
          );
        } catch (err) {
          const protocolErr =
            err instanceof ProtocolError
              ? err
              : new ProtocolError(
                  ErrorCodes.CRYPTO_FAILED,
                  `Failed on channelOpen: ${err instanceof Error ? err.message : String(err)}`
                );
          this.failAndClose(protocolErr);
        }
      });

      this.peer.on('channelClose', () => {
        this.channel = null;
      });

      this.peer.on('connectionStateChange', (state) => {
        if (state === 'failed') {
          this.failAndClose(
            new ProtocolError(ErrorCodes.ICE_FAILED, 'WebRTC connection state failed')
          );
        }
      });

      this.peer.on('error', (err) => {
        this.failAndClose(err);
      });
    };

    this.initRtcPromise = init();
    try {
      await this.initRtcPromise;
    } catch (err) {
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.ICE_FAILED, `RTC initialization failed: ${String(err)}`);
      this.failAndClose(protocolErr);
    }
  }

  private async handlePeerSignal(envelope: Envelope): Promise<void> {
    if (!this.authKey || !this.roomId) {
      const err = new ProtocolError(ErrorCodes.AUTH_FAILED, 'Session not initialized');
      this.failAndClose(err);
      return;
    }

    let verified: Envelope;
    try {
      verified = await this.envelopeManager.verify(
        this.authKey,
        this.roomId,
        'sender',
        envelope
      );
    } catch (err) {
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.AUTH_FAILED, 'Signal verification failed');
      this.failAndClose(protocolErr);
      return;
    }

    switch (verified.type) {
      case 'wrapped-key': {
        if (!this.keyPair || !this.client) {
          const err = new ProtocolError(
            ErrorCodes.CRYPTO_FAILED,
            'Private key not available for unwrapping'
          );
          this.failAndClose(err);
          return;
        }

        try {
          const wrappedBytes = fromBase64Url(verified.body);
          this.sessionKey = await unwrapSessionKey(wrappedBytes, this.keyPair.privateKey);

          // Zero out wrapped bytes buffer as specified in Section 5.6
          wrappedBytes.fill(0);

          // Send key-ack envelope (empty body proves decryption in authenticated context)
          await this.sendEnvelope('key-ack', '');

          if (!this.options.RTCPeerConnectionCtor && typeof globalThis.RTCPeerConnection === 'undefined') {
            this.setState('ready');
          } else {
            this.setState('rtcConnecting');
            await this.startRtcReceiver();
          }
        } catch (err) {
          const protocolErr =
            err instanceof ProtocolError
              ? err
              : new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Failed to unwrap session key');
          this.failAndClose(protocolErr);
        }
        break;
      }
      case 'sdp-offer': {
        if (this.initRtcPromise) {
          await this.initRtcPromise;
        }
        const peer = this.peer as Peer | null;
        if (peer) {
          const answerSdp = await peer.acceptOffer(verified.body);
          await this.sendEnvelope('sdp-answer', answerSdp);
        }
        break;
      }
      case 'ice': {
        const candidate = JSON.parse(verified.body) as RTCIceCandidateInit;
        if (this.initRtcPromise) {
          await this.initRtcPromise;
        }
        const peer = this.peer as Peer | null;
        if (peer) {
          await peer.addIceCandidate(candidate);
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  private handleSocketClose(): void {
    if (this.isClosed) return;
    if (
      this.currentState !== 'ready' &&
      this.currentState !== 'receiving' &&
      this.currentState !== 'done' &&
      this.currentState !== 'failed'
    ) {
      const err = new ProtocolError(ErrorCodes.CHANNEL_CLOSED, 'Signaling channel closed');
      this.failAndClose(err);
    }
  }

  private buildWsUrl(serverUrl: string): string {
    if (serverUrl.startsWith('http://')) {
      return serverUrl.replace(/^http:\/\//, 'ws://') + '/ws';
    }
    if (serverUrl.startsWith('https://')) {
      return serverUrl.replace(/^https:\/\//, 'wss://') + '/ws';
    }
    if (serverUrl.startsWith('ws://') || serverUrl.startsWith('wss://')) {
      return serverUrl.endsWith('/ws') ? serverUrl : `${serverUrl}/ws`;
    }
    return `ws://${serverUrl}/ws`;
  }
}
