/**
 * Sender session state machine and handshake implementation.
 * Implements Sections 5.5 and 8.8 of the specification.
 */

import {
  ProtocolError,
  ErrorCodes,
  type ServerMessage,
  type Envelope,
  DIRECTION_SENDER,
} from '../../protocol/index';
import { randomBytes, toBase64Url, fromBase64Url } from '../crypto/random';
import { deriveAuthKey } from '../crypto/kdf';
import { importSpki, wrapSessionKey } from '../crypto/rsa';
import { fingerprint } from '../crypto/fingerprint';
import { toBufferSource } from '../crypto/_buffer';
import { SignalingClient, type WebSocketConstructor } from '../signaling/client';
import { createEnvelopeManager, type EnvelopeManager } from '../signaling/envelope';
import { createPeer, type Peer } from '../rtc/peer';
import { createChannel, type Channel } from '../rtc/channel';
import { sendControl } from '../transfer/control';
import { FileSender } from '../transfer/sender';
import type { SenderState, SessionEvents } from './types';

export interface SenderSessionOptions {
  serverUrl: string;
  /**
   * WebSocket URL for the signaling server.
   * When provided, overrides the URL derived from `serverUrl`.
   * Use this when `serverUrl` is empty (same-origin REST proxy) but the
   * WebSocket server is on a different port.
   */
  wsUrl?: string;
  secret: Uint8Array;
  WebSocketCtor?: typeof WebSocket | WebSocketConstructor;
  RTCPeerConnectionCtor?: typeof RTCPeerConnection;
  forceRelay?: boolean;
}

const VALID_SENDER_TRANSITIONS: Record<SenderState, readonly SenderState[]> = {
  idle: ['creatingRoom', 'failed', 'cancelled'],
  creatingRoom: ['waitingForReceiver', 'failed', 'cancelled'],
  waitingForReceiver: ['awaitingApproval', 'failed', 'cancelled'],
  awaitingApproval: ['keyExchange', 'failed', 'cancelled'],
  keyExchange: ['rtcConnecting', 'ready', 'failed', 'cancelled'],
  rtcConnecting: ['ready', 'failed', 'cancelled'],
  ready: ['transferring', 'done', 'failed', 'cancelled'],
  transferring: ['done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
};

export class SenderSession {
  private readonly options: SenderSessionOptions;
  private readonly secret: Uint8Array;
  private readonly envelopeManager: EnvelopeManager;

  private currentState: SenderState = 'idle';
  private client: SignalingClient | null = null;
  private authKey: CryptoKey | null = null;
  private sessionKey: CryptoKey | null = null;
  private receiverPublicKey: CryptoKey | null = null;
  private roomId: string | null = null;
  private senderToken: string | null = null;

  private peer: Peer | null = null;
  private channel: Channel | null = null;
  private controlSeqOut = 0;
  private initRtcPromise: Promise<void> | null = null;

  private isApproved = false;
  private isClosed = false;
  private activeSender: FileSender | null = null;
  private fetchAbortController: AbortController | null = null;

  private readonly listeners = new Map<
    keyof SessionEvents<SenderState>,
    Set<SessionEvents<SenderState>[keyof SessionEvents<SenderState>]>
  >();

  constructor(options: SenderSessionOptions) {
    if (options.secret.byteLength !== 32) {
      throw new Error(`Invalid secret length: expected 32 bytes, got ${options.secret.byteLength}`);
    }
    this.options = options;
    this.secret = new Uint8Array(options.secret);
    this.envelopeManager = createEnvelopeManager();
  }

  get state(): SenderState {
    return this.currentState;
  }

  on<K extends keyof SessionEvents<SenderState>>(
    event: K,
    handler: SessionEvents<SenderState>[K],
  ): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler as SessionEvents<SenderState>[keyof SessionEvents<SenderState>]);
    return () => {
      handlers?.delete(handler as SessionEvents<SenderState>[keyof SessionEvents<SenderState>]);
    };
  }

  /**
   * Create room, build share link, and join signaling room.
   * Transitions: idle → creatingRoom → waitingForReceiver.
   */
  async start(): Promise<{ shareUrl: string; expiresAt: number }> {
    if (this.currentState !== 'idle') {
      throw new Error(`Cannot start sender session from state: ${this.currentState}`);
    }

    this.setState('creatingRoom');

    try {
      const normalizedServerUrl = this.options.serverUrl.replace(/\/+$/, '');

      // 1. POST /api/rooms
      this.fetchAbortController = new AbortController();
      const res = await fetch(`${normalizedServerUrl}/api/rooms`, {
        method: 'POST',
        signal: this.fetchAbortController.signal,
      });
      this.fetchAbortController = null;

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new ProtocolError(
          ErrorCodes.INVALID_MESSAGE,
          `Failed to create room: ${res.status} ${errText}`,
        );
      }

      const roomData = (await res.json()) as {
        roomId: string;
        senderToken: string;
        expiresAt: number;
      };

      this.roomId = roomData.roomId;
      this.senderToken = roomData.senderToken;

      // 2. Derive HMAC auth key from fragment secret (Section 5.4)
      this.authKey = await deriveAuthKey(this.secret, this.roomId);

      // 3. Build share URL (secret remains in fragment only)
      let origin: string;
      if (typeof window !== 'undefined' && window.location?.origin) {
        origin = window.location.origin;
      } else {
        try {
          origin = new URL(normalizedServerUrl).origin;
        } catch {
          origin = 'http://localhost';
        }
      }
      const shareUrl = `${origin}/r/${this.roomId}#${toBase64Url(this.secret)}`;

      // 4. Transition to waitingForReceiver
      this.setState('waitingForReceiver');

      // 5. Connect WebSocket
      const resolvedWsUrl = this.options.wsUrl
        ? this.options.wsUrl.replace(/\/+$/, '') + (this.options.wsUrl.includes('/ws') ? '' : '/ws')
        : this.buildWsUrl(normalizedServerUrl);
      this.client = new SignalingClient({
        url: resolvedWsUrl,
        WebSocketCtor: this.options.WebSocketCtor,
        onMessage: (msg) => {
          void this.handleServerMessage(msg);
        },
        onClose: (_code, _reason) => {
          this.handleSocketClose();
        },
        onError: (_err) => {
          // Socket errors lead to close event
        },
      });

      // 6. Join room as sender
      this.client.send({
        kind: 'join',
        roomId: this.roomId,
        role: 'sender',
        senderToken: this.senderToken,
      });

      return {
        shareUrl,
        expiresAt: roomData.expiresAt,
      };
    } catch (err) {
      this.fetchAbortController = null;
      // AbortError means cancel() was called — the session is already closed, nothing to do.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProtocolError(ErrorCodes.TRANSFER_CANCELLED, 'Room creation cancelled');
      }
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.CRYPTO_FAILED, (err as Error).message);
      this.failAndClose(protocolErr);
      throw protocolErr;
    }
  }

  /**
   * Called by UI after user clicks Approve.
   * Transitions: awaitingApproval → keyExchange.
   */
  async approveReceiver(): Promise<void> {
    if (this.isClosed) {
      throw new Error('Session is closed');
    }
    this.isApproved = true;

    if (this.currentState !== 'awaitingApproval' && this.currentState !== 'waitingForReceiver') {
      throw new Error(`Cannot approve receiver in state: ${this.currentState}`);
    }

    if (this.receiverPublicKey) {
      await this.executeKeyExchange();
    }
  }

  /**
   * Send files — streams all files via FileSender.
   * Transitions: ready → transferring → done.
   */
  sendFiles(files: File[]): void {
    if (this.currentState !== 'ready') {
      throw new Error(`Cannot send files in state: ${this.currentState}`);
    }
    if (!this.channel || !this.sessionKey) {
      throw new Error('Channel or session key not available');
    }

    this.setState('transferring');

    this.activeSender = new FileSender({
      files,
      key: this.sessionKey,
      channel: this.channel,
      onProgress: (p) => this.emit('progress', p),
      // Continue the outgoing control seq from where 'hello' left off (seq 0).
      initialControlSeq: this.controlSeqOut,
    });

    void this.activeSender.run().then(
      () => {
        this.activeSender = null;
        if (!this.isClosed) {
          this.setState('done');
          this.emit('done');
          // Mark as closed immediately so cancel() / reset() don't throw an
          // invalid state transition, but defer the actual PeerConnection
          // teardown so the 'bye' DataChannel frame can drain to the receiver
          // before the connection is torn down.
          this.isClosed = true;
          setTimeout(() => {
            if (this.channel) {
              try {
                this.channel.close();
              } catch {
                /* ignore */
              }
              this.channel = null;
            }
            if (this.peer) {
              try {
                this.peer.close();
              } catch {
                /* ignore */
              }
              this.peer = null;
            }
            this.sessionKey = null;
            this.receiverPublicKey = null;
            this.authKey = null;
          }, 300);
        }
      },
      (err: unknown) => {
        this.activeSender = null;
        if (!this.isClosed) {
          const protocolErr =
            err instanceof ProtocolError
              ? err
              : new ProtocolError(
                  ErrorCodes.CHANNEL_CLOSED,
                  err instanceof Error ? err.message : String(err),
                );
          this.failAndClose(protocolErr);
        }
      },
    );
  }

  /**
   * Cancel at any time. Transitions to cancelled.
   */
  cancel(_reason?: string): void {
    if (this.isClosed) return;
    if (this.activeSender) {
      this.activeSender.cancel(_reason);
      this.activeSender = null;
    }
    try {
      this.client?.send({ kind: 'bye' });
    } catch {
      // Ignore
    }
    this.setState('cancelled');
    this.close();
  }

  /**
   * Close all resources and zero key material.
   */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    // Abort any in-flight fetch so orphaned room creations don't race against
    // a fresh session when cancel() is called before the response arrives.
    if (this.fetchAbortController) {
      this.fetchAbortController.abort();
      this.fetchAbortController = null;
    }

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
    this.receiverPublicKey = null;
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

  private setState(newState: SenderState): void {
    if (this.currentState === newState) return;

    const allowed = VALID_SENDER_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid sender state transition from '${this.currentState}' to '${newState}'`,
      );
    }

    this.currentState = newState;
    this.emit('stateChange', newState);
  }

  private emit<K extends keyof SessionEvents<SenderState>>(
    event: K,
    ...args: Parameters<SessionEvents<SenderState>[K]>
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
    if (this.currentState !== 'failed' && this.currentState !== 'cancelled') {
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
        // Peer may be present; await their pubkey signal before requesting approval
        break;
      }
      case 'peer-joined': {
        // Peer arrived; await their pubkey signal before requesting approval
        break;
      }
      case 'peer-left': {
        const err = new ProtocolError(ErrorCodes.PEER_LEFT, 'Peer left the room');
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
      verified = await this.envelopeManager.verify(this.authKey, this.roomId, 'receiver', envelope);
    } catch (err) {
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.AUTH_FAILED, 'Signal verification failed');
      this.failAndClose(protocolErr);
      return;
    }

    switch (verified.type) {
      case 'pubkey': {
        try {
          const spkiBytes = fromBase64Url(verified.body);
          const fp = await fingerprint(spkiBytes);
          this.receiverPublicKey = await importSpki(spkiBytes);
          this.emit('fingerprint', fp);

          if (this.currentState === 'waitingForReceiver') {
            this.setState('awaitingApproval');
          }

          if (this.isApproved) {
            await this.executeKeyExchange();
          }
        } catch (err) {
          const protocolErr =
            err instanceof ProtocolError
              ? err
              : new ProtocolError(
                  ErrorCodes.CRYPTO_FAILED,
                  'Failed to process receiver public key',
                );
          this.failAndClose(protocolErr);
        }
        break;
      }
      case 'key-ack': {
        if (this.currentState === 'keyExchange') {
          if (
            !this.options.RTCPeerConnectionCtor &&
            typeof globalThis.RTCPeerConnection === 'undefined'
          ) {
            this.setState('ready');
            break;
          }
          this.setState('rtcConnecting');
          await this.startRtcSender();
        }
        break;
      }
      case 'sdp-answer': {
        if (this.initRtcPromise) {
          await this.initRtcPromise;
        }
        const peer = this.peer as Peer | null;
        if (peer) {
          await peer.acceptAnswer(verified.body);
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

  private async sendEnvelope(
    type: 'pubkey' | 'wrapped-key' | 'key-ack' | 'sdp-offer' | 'sdp-answer' | 'ice',
    body: string,
  ): Promise<void> {
    if (!this.authKey || !this.roomId || !this.client) {
      throw new ProtocolError(ErrorCodes.AUTH_FAILED, 'Cannot send envelope: session not ready');
    }
    const envelope = await this.envelopeManager.sign(
      this.authKey,
      this.roomId,
      'sender',
      type,
      body,
    );
    this.client.send({
      kind: 'signal',
      envelope,
    });
  }

  private async startRtcSender(): Promise<void> {
    const init = async () => {
      const normalizedServerUrl = this.options.serverUrl.replace(/\/+$/, '');
      const res = await fetch(`${normalizedServerUrl}/api/ice`);
      if (!res.ok) {
        throw new ProtocolError(
          ErrorCodes.ICE_FAILED,
          `Failed to fetch ICE servers: ${res.status}`,
        );
      }
      const { iceServers } = (await res.json()) as { iceServers: RTCIceServer[] };

      this.peer = createPeer({
        iceServers,
        role: 'sender',
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
            DIRECTION_SENDER,
            this.controlSeqOut++,
            { t: 'hello', v: 1, role: 'sender' },
          );
          this.setState('ready');
          try {
            this.client?.send({ kind: 'bye' });
          } catch {
            // Ignore
          }
        } catch (err) {
          const protocolErr =
            err instanceof ProtocolError
              ? err
              : new ProtocolError(
                  ErrorCodes.CRYPTO_FAILED,
                  `Failed on channelOpen: ${err instanceof Error ? err.message : String(err)}`,
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
            new ProtocolError(ErrorCodes.ICE_FAILED, 'WebRTC connection state failed'),
          );
        }
      });

      this.peer.on('error', (err) => {
        this.failAndClose(err);
      });

      const offerSdp = await this.peer.createOffer();
      await this.sendEnvelope('sdp-offer', offerSdp);
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

  private async executeKeyExchange(): Promise<void> {
    if (!this.receiverPublicKey || !this.authKey || !this.roomId || !this.client) {
      throw new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Key exchange preconditions not met');
    }

    this.setState('keyExchange');

    try {
      const rawSessionKey = randomBytes(32);

      // RSA-OAEP wrap with receiver's public key
      const wrapped = await wrapSessionKey(rawSessionKey, this.receiverPublicKey);

      // Import raw session key as non-extractable AES-GCM key
      this.sessionKey = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawSessionKey),
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable
        ['encrypt', 'decrypt'],
      );

      // Zero out the raw session key buffer
      rawSessionKey.fill(0);

      // Sign and send wrapped-key envelope
      const wrappedBody = toBase64Url(wrapped);
      await this.sendEnvelope('wrapped-key', wrappedBody);
    } catch (err) {
      const protocolErr =
        err instanceof ProtocolError
          ? err
          : new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Failed to wrap or send session key');
      this.failAndClose(protocolErr);
      throw protocolErr;
    }
  }

  private handleSocketClose(): void {
    if (this.isClosed) return;
    // Once rtcConnecting has started, the signaling socket is no longer
    // essential — the DataChannel will carry all further communication.
    // Don't fail the session if the server closes the socket (e.g. because
    // the other peer sent its bye first and the server cleaned up the room).
    if (
      this.currentState !== 'rtcConnecting' &&
      this.currentState !== 'ready' &&
      this.currentState !== 'transferring' &&
      this.currentState !== 'done' &&
      this.currentState !== 'failed' &&
      this.currentState !== 'cancelled'
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
