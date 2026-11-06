import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ErrorCodes,
  ProtocolError,
  type FrameHeader,
  FRAME_TYPE_DATA,
  FRAME_FLAG_FINAL,
} from '@e2ee-share/protocol';
import {
  randomBytes,
  toBase64Url,
  deriveAuthKey,
  generateReceiverKeyPair,
  exportSpki,
  encryptFrame,
  decryptFrame,
  createEnvelopeManager,
  SignalingClient,
  SenderSession,
  ReceiverSession,
  type SenderState,
  type ReceiverState,
} from '../index.js';

interface TestAppInstance {
  listen: (opts: { port: number; host: string }) => Promise<string>;
  server: { address: () => AddressInfo | string | null };
  close: () => Promise<void>;
}

interface ServerModule {
  buildApp: (config: Record<string, unknown>) => Promise<TestAppInstance>;
  loadConfig: (overrides?: Record<string, unknown>) => Record<string, unknown>;
}

function waitForState<S extends SenderState | ReceiverState>(
  session: { state: S; on: (ev: 'stateChange', handler: (s: S) => void) => () => void },
  targetState: S,
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.state === targetState) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout waiting for state '${targetState}', currently '${session.state}'`));
    }, timeoutMs);

    const unsubscribe = session.on('stateChange', (newState) => {
      if (newState === targetState) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * Malicious WebSocket proxy for testing public key tampering.
 * Intercepts incoming 'pubkey' signal and swaps the public key in envelope.body
 * while keeping the original envelope.mac.
 */
class TamperingWebSocket {
  private readonly inner: WebSocket;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason?: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.inner = new globalThis.WebSocket(url, protocols);

    this.inner.onopen = (e) => {
      this.onopen?.(e);
    };

    this.inner.onclose = (e) => {
      this.onclose?.(e);
    };

    this.inner.onerror = (e) => {
      this.onerror?.(e);
    };

    this.inner.onmessage = async (e: { data: unknown }) => {
      try {
        let text: string;
        if (typeof e.data === 'string') {
          text = e.data;
        } else if (e.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(e.data);
        } else if (ArrayBuffer.isView(e.data)) {
          text = new TextDecoder().decode(e.data);
        } else {
          this.onmessage?.(e);
          return;
        }

        const parsed = JSON.parse(text) as {
          kind?: string;
          envelope?: { type?: string; body?: string };
        };

        if (parsed.kind === 'signal' && parsed.envelope?.type === 'pubkey') {
          // Attacker generates their own keypair and swaps the public key in the envelope body
          const attackerKeyPair = await generateReceiverKeyPair();
          const attackerSpki = await exportSpki(attackerKeyPair.publicKey);
          const forgedBody = toBase64Url(attackerSpki);

          const tampered = {
            ...parsed,
            envelope: {
              ...parsed.envelope,
              body: forgedBody, // Tampered body with original MAC!
            },
          };
          this.onmessage?.({ data: JSON.stringify(tampered) });
          return;
        }
      } catch {
        // Pass through on parsing failure
      }
      this.onmessage?.(e);
    };
  }

  get readyState(): number {
    return this.inner.readyState;
  }

  send(data: string): void {
    this.inner.send(data);
  }

  close(code?: number, reason?: string): void {
    this.inner.close(code, reason);
  }
}

describe('Phase 3 — Authenticated Handshake', () => {
  let app: TestAppInstance;
  let serverUrl: string;

  beforeEach(async () => {
    const serverModule = (await (import('@e2ee-share/server' as string) as Promise<ServerModule>));
    const config = serverModule.loadConfig({
      LOG_LEVEL: 'fatal',
      STUN_URLS: 'stun:stun.example.com:19302',
      TURN_URLS: 'turn:turn.example.com:3478',
      TURN_SECRET: 'test-turn-secret-key-12345',
      ROOM_TTL_UNJOINED_SEC: 600,
      ROOM_TTL_MAX_SEC: 3600,
    });
    app = await serverModule.buildApp(config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Integration Test: Happy Path', () => {
    it('successfully completes handshake and derives identical session keys on sender and receiver', async () => {
      const secret = randomBytes(32);
      const sender = new SenderSession({
        serverUrl,
        secret,
      });

      // 1. Start sender session (creates room, transitions: idle -> creatingRoom -> waitingForReceiver)
      const { shareUrl, expiresAt } = await sender.start();
      expect(sender.state).toBe('waitingForReceiver');
      expect(expiresAt).toBeGreaterThan(Date.now());

      // 2. Extract roomId from shareUrl
      const urlObj = new URL(shareUrl);
      const roomIdMatch = urlObj.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
      expect(roomIdMatch).not.toBeNull();
      const roomId = roomIdMatch![1]!;

      // 3. Create receiver session with the same roomId and secret
      const receiver = new ReceiverSession({
        serverUrl,
        roomId,
        secret,
      });

      let senderFp = '';
      let receiverFp = '';
      sender.on('fingerprint', (fp) => {
        senderFp = fp;
      });
      receiver.on('fingerprint', (fp) => {
        receiverFp = fp;
      });

      const senderReadyPromise = waitForState(sender, 'ready');
      const receiverReadyPromise = waitForState(receiver, 'ready');

      // 4. Start receiver session (transitions: idle -> preparingKeys -> joining -> waitingForKey)
      await receiver.start();

      // 5. Wait for sender to receive public key and transition to awaitingApproval
      await waitForState(sender, 'awaitingApproval');

      // 6. Verify fingerprint format (4 groups of 4 hex chars) and match on both sides
      expect(senderFp).toBeTruthy();
      expect(senderFp).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(receiverFp).toBe(senderFp);

      // 7. Sender approves receiver (transitions: awaitingApproval -> keyExchange)
      await sender.approveReceiver();

      // 8. Both sessions must reach 'ready' state after key exchange
      await Promise.all([senderReadyPromise, receiverReadyPromise]);
      expect(sender.state).toBe('ready');
      expect(receiver.state).toBe('ready');

      // 9. Verify session keys are identical by encrypting on one side and decrypting on the other
      const senderKey = sender.getSessionKeyForTesting();
      const receiverKey = receiver.getSessionKeyForTesting();
      expect(senderKey).not.toBeNull();
      expect(receiverKey).not.toBeNull();

      // Test Frame 1: Sender -> Receiver (direction 0x01)
      const testPlaintext = new TextEncoder().encode('E2EE Handshake Payload: Confidential file data!');
      const header: FrameHeader = {
        version: 0x01,
        type: FRAME_TYPE_DATA,
        flags: FRAME_FLAG_FINAL,
        fileIndex: 0,
        seq: 0,
      };

      const frameFromSender = await encryptFrame(senderKey!, 0x01, header, testPlaintext);
      const decryptedByReceiver = await decryptFrame(receiverKey!, 0x01, frameFromSender);
      expect(new TextDecoder().decode(decryptedByReceiver.plaintext)).toBe(
        'E2EE Handshake Payload: Confidential file data!'
      );
      expect(decryptedByReceiver.header).toEqual(header);

      // Test Frame 2: Receiver -> Sender (direction 0x02)
      const replyPlaintext = new TextEncoder().encode('Receiver verification response!');
      const replyHeader: FrameHeader = {
        version: 0x01,
        type: FRAME_TYPE_DATA,
        flags: FRAME_FLAG_FINAL,
        fileIndex: 0,
        seq: 0,
      };

      const frameFromReceiver = await encryptFrame(receiverKey!, 0x02, replyHeader, replyPlaintext);
      const decryptedBySender = await decryptFrame(senderKey!, 0x02, frameFromReceiver);
      expect(new TextDecoder().decode(decryptedBySender.plaintext)).toBe(
        'Receiver verification response!'
      );
      expect(decryptedBySender.header).toEqual(replyHeader);

      sender.close();
      receiver.close();
    });
  });

  describe('Negative Test: Malicious Server Swaps Public Key', () => {
    it('aborts with AUTH_FAILED when an adversarial proxy modifies the public key', async () => {
      const secret = randomBytes(32);

      // Sender connects through the tampering WebSocket proxy
      const sender = new SenderSession({
        serverUrl,
        secret,
        WebSocketCtor: TamperingWebSocket as unknown as typeof WebSocket,
      });

      const { shareUrl } = await sender.start();
      const urlObj = new URL(shareUrl);
      const roomId = urlObj.pathname.split('/r/')[1]!;

      const receiver = new ReceiverSession({
        serverUrl,
        roomId,
        secret,
      });

      let emittedError: ProtocolError | null = null;
      const errorPromise = new Promise<ProtocolError>((resolve) => {
        sender.on('error', (err) => {
          emittedError = err;
          resolve(err);
        });
      });

      // Start receiver which will send the legitimate pubkey
      await receiver.start();

      // Sender proxy intercepts pubkey, modifies body, forwards to sender
      const error = await errorPromise;

      expect(error.code).toBe(ErrorCodes.AUTH_FAILED);
      expect((emittedError as ProtocolError | null)?.code).toBe(ErrorCodes.AUTH_FAILED);
      expect(sender.state).toBe('failed');

      sender.close();
      receiver.close();
    });
  });

  describe('EnvelopeManager Unit Tests', () => {
    it('signs and verifies valid envelope successfully', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const receiverMgr = createEnvelopeManager();

      const env0 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'payload-0');
      expect(env0.seq).toBe(0);
      expect(env0.type).toBe('pubkey');
      expect(env0.body).toBe('payload-0');
      expect(env0.mac).toBeTruthy();

      const verified0 = await receiverMgr.verify(authKey, 'test-room-42', 'sender', env0);
      expect(verified0).toEqual(env0);

      const env1 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'wrapped-key', 'payload-1');
      expect(env1.seq).toBe(1);

      const verified1 = await receiverMgr.verify(authKey, 'test-room-42', 'sender', env1);
      expect(verified1).toEqual(env1);
    });

    it('rejects replayed envelope (same sequence number) with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const receiverMgr = createEnvelopeManager();

      const env = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'payload');
      await receiverMgr.verify(authKey, 'test-room-42', 'sender', env);

      // Replay identical envelope
      await expect(
        receiverMgr.verify(authKey, 'test-room-42', 'sender', env)
      ).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
    });

    it('rejects out of order envelope (seq goes backwards) with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const receiverMgr = createEnvelopeManager();

      const env0 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'msg-0');
      const env1 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'key-ack', 'msg-1');

      // Receiver receives env1 first
      await receiverMgr.verify(authKey, 'test-room-42', 'sender', env1);

      // Receiver then receives env0 (older seq)
      await expect(
        receiverMgr.verify(authKey, 'test-room-42', 'sender', env0)
      ).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
    });

    it('rejects modified body after signing with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const receiverMgr = createEnvelopeManager();

      const env = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'legitimate-body');
      const modifiedEnv = { ...env, body: 'tampered-body' };

      await expect(
        receiverMgr.verify(authKey, 'test-room-42', 'sender', modifiedEnv)
      ).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
    });

    it('rejects modified type, role, or roomId with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const receiverMgr = createEnvelopeManager();

      const env = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'body');

      // Tampered type
      await expect(
        receiverMgr.verify(authKey, 'test-room-42', 'sender', { ...env, type: 'ice' })
      ).rejects.toMatchObject({ code: ErrorCodes.AUTH_FAILED });

      // Tampered role
      await expect(
        receiverMgr.verify(authKey, 'test-room-42', 'receiver', env)
      ).rejects.toMatchObject({ code: ErrorCodes.AUTH_FAILED });

      // Tampered roomId
      await expect(
        receiverMgr.verify(authKey, 'different-room', 'sender', env)
      ).rejects.toMatchObject({ code: ErrorCodes.AUTH_FAILED });
    });
  });

  describe('SignalingClient Unit Tests', () => {
    it('buffers messages sent during CONNECTING and flushes on open', async () => {
      const address = app.server.address() as AddressInfo;
      const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

      let receivedJoined = false;
      const client = new SignalingClient({
        url: wsUrl,
        onMessage: (msg) => {
          if (msg.kind === 'joined') {
            receivedJoined = true;
          }
        },
        onClose: () => {},
      });

      // Create a real room first to join
      const secret = randomBytes(32);
      const sender = new SenderSession({ serverUrl, secret });
      const { shareUrl } = await sender.start();
      const roomId = new URL(shareUrl).pathname.split('/r/')[1]!;

      // Send join immediately while socket is in CONNECTING state
      client.send({
        kind: 'join',
        roomId,
        role: 'receiver',
      });

      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (receivedJoined) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });

      expect(receivedJoined).toBe(true);
      expect(client.state).toBe('open');

      client.close();
      sender.close();
    });

    it('silently ignores malformed or invalid messages from server', () => {
      let messageHandled = false;
      const client = new SignalingClient({
        url: `ws://127.0.0.1:9999/dummy`,
        onMessage: () => {
          messageHandled = true;
        },
        onClose: () => {},
        WebSocketCtor: class MockWs {
          readyState = 1;
          onopen: (() => void) | null = null;
          onmessage: ((e: { data: unknown }) => void) | null = null;
          onclose: (() => void) | null = null;
          onerror: (() => void) | null = null;
          send() {}
          close() {}
        } as unknown as typeof WebSocket,
      });

      // Feed malformed JSON and schema-invalid messages directly to onmessage
      const mock = (client as unknown as { ws: { onmessage: (e: { data: unknown }) => void } }).ws;
      mock.onmessage({ data: 'not a json' });
      mock.onmessage({ data: '{"unknownField": 123}' });
      mock.onmessage({ data: '{"kind": "non-existent-kind"}' });

      expect(messageHandled).toBe(false);
      client.close();
    });

    it('enforces 5-second join timeout if join is not sent on open', () => {
      vi.useFakeTimers();
      let closedCode = 0;
      let closedReason = '';

      const client = new SignalingClient({
        url: 'ws://127.0.0.1:9999/dummy',
        onMessage: () => {},
        onClose: (code, reason) => {
          closedCode = code;
          closedReason = reason;
        },
        WebSocketCtor: class MockWs {
          readyState = 0;
          onopen: (() => void) | null = null;
          onmessage: null = null;
          onclose: ((e: { code: number; reason: string }) => void) | null = null;
          onerror: null = null;
          send() {}
          close(c = 1000, r = '') {
            this.readyState = 3;
            this.onclose?.({ code: c, reason: r });
          }
        } as unknown as typeof WebSocket,
      });

      const mock = (client as unknown as { ws: { onopen: () => void; readyState: number } }).ws;
      mock.readyState = 1; // open
      mock.onopen(); // Triggers join timeout timer

      expect(closedCode).toBe(0);

      // Fast-forward past 5 seconds
      vi.advanceTimersByTime(5001);

      expect(closedCode).toBe(4008);
      expect(closedReason).toBe('Join timeout');

      client.close();
      vi.useRealTimers();
    });
  });

  describe('Session Edge Cases', () => {
    it('throws when initialized with secret that is not 32 bytes', () => {
      expect(() => {
        new SenderSession({
          serverUrl,
          secret: new Uint8Array(16),
        });
      }).toThrow(/Invalid secret length/);

      expect(() => {
        new ReceiverSession({
          serverUrl,
          roomId: 'room-1',
          secret: new Uint8Array(64),
        });
      }).toThrow(/Invalid secret length/);
    });

    it('throws when illegal state transitions are attempted', async () => {
      const secret = randomBytes(32);
      const sender = new SenderSession({ serverUrl, secret });

      // Cannot approve before starting
      await expect(sender.approveReceiver()).rejects.toThrow(/Cannot approve receiver in state: idle/);

      // Cannot sendFiles before ready
      expect(() => sender.sendFiles([])).toThrow(/Cannot send files in state: idle/);
    });

    it('handles cancellation and closes resources gracefully', async () => {
      const secret = randomBytes(32);
      const sender = new SenderSession({ serverUrl, secret });
      const { shareUrl } = await sender.start();
      const roomId = new URL(shareUrl).pathname.split('/r/')[1]!;

      expect(sender.state).toBe('waitingForReceiver');
      sender.cancel('User cancelled');
      expect(sender.state).toBe('cancelled');

      const receiver = new ReceiverSession({ serverUrl, roomId, secret });
      await receiver.start();
      receiver.reject();
      expect(receiver.state).toBe('failed');
    });
  });
});
