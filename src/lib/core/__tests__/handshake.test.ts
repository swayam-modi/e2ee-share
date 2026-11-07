/**
 * Phase 3 — Authenticated Handshake tests.
 *
 * Integration tests use a minimal in-process WebSocket relay server built
 * directly from the `ws` npm package. This avoids any dependency on the
 * application server layer while still exercising the real signaling path.
 */
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ErrorCodes,
  ProtocolError,
  type FrameHeader,
  FRAME_TYPE_DATA,
  FRAME_FLAG_FINAL,
} from '../../protocol/index';
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
} from '../index';

// ── Minimal relay server ──────────────────────────────────────────────────────

interface TestRoom {
  senderTokenHash: string;
  senderWs: WsWebSocket | null;
  receiverWs: WsWebSocket | null;
}

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

function createTestServer(): Promise<TestServer> {
  const rooms = new Map<string, TestRoom>();

  const httpServer = createServer((req, res) => {
    req.resume(); // drain body — not needed for our endpoints
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/rooms') {
        const roomId = crypto.randomBytes(16).toString('base64url');
        const token = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        rooms.set(roomId, { senderTokenHash: tokenHash, senderWs: null, receiverWs: null });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ roomId, senderToken: token, expiresAt: Date.now() + 600_000 }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WsWebSocket) => {
    let role: 'sender' | 'receiver' | undefined;
    let roomId: string | undefined;

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          kind: string;
          roomId?: string;
          role?: 'sender' | 'receiver';
          senderToken?: string;
          envelope?: unknown;
        };

        if (msg.kind === 'join' && msg.roomId) {
          const room = rooms.get(msg.roomId);
          if (!room) {
            ws.send(
              JSON.stringify({ kind: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found' }),
            );
            ws.close();
            return;
          }
          role = msg.role;
          roomId = msg.roomId;
          if (role === 'sender') room.senderWs = ws;
          else room.receiverWs = ws;

          const peer = role === 'sender' ? room.receiverWs : room.senderWs;
          ws.send(JSON.stringify({ kind: 'joined', role, peerPresent: !!peer }));
          if (peer?.readyState === 1) {
            peer.send(JSON.stringify({ kind: 'peer-joined' }));
          }
          return;
        }

        if (msg.kind === 'signal' && roomId) {
          const room = rooms.get(roomId);
          const peer = role === 'sender' ? room?.receiverWs : room?.senderWs;
          if (peer?.readyState === 1) peer.send(JSON.stringify(msg));
          return;
        }

        if (msg.kind === 'bye' && roomId) {
          rooms.delete(roomId);
          ws.close();
        }
      } catch {
        /* ignore parse errors */
      }
    });

    ws.on('close', () => {
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const peer = role === 'sender' ? room.receiverWs : room.senderWs;
      if (peer?.readyState === 1) {
        peer.send(JSON.stringify({ kind: 'peer-left' }));
        peer.close();
      }
      rooms.delete(roomId);
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const { port } = httpServer.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function waitForState<S extends SenderState | ReceiverState>(
  session: { state: S; on: (ev: 'stateChange', handler: (s: S) => void) => () => void },
  targetState: S,
  timeoutMs = 5000,
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
 * Wraps the browser-side WebSocket so it intercepts incoming 'pubkey' signals
 * and replaces the envelope body with an attacker-generated public key while
 * leaving the original MAC intact — simulating a MITM key-swap attack.
 */
class TamperingWebSocket {
  private readonly inner: WebSocket;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason?: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.inner = new globalThis.WebSocket(url, protocols);
    this.inner.onopen = (e) => this.onopen?.(e);
    this.inner.onclose = (e) => this.onclose?.(e);
    this.inner.onerror = (e) => this.onerror?.(e);

    this.inner.onmessage = async (e: { data: unknown }) => {
      try {
        const text =
          typeof e.data === 'string'
            ? e.data
            : e.data instanceof ArrayBuffer
              ? new TextDecoder().decode(e.data)
              : ArrayBuffer.isView(e.data)
                ? new TextDecoder().decode(e.data as ArrayBufferView)
                : null;

        if (text) {
          const parsed = JSON.parse(text) as {
            kind?: string;
            envelope?: { type?: string; body?: string };
          };

          if (parsed.kind === 'signal' && parsed.envelope?.type === 'pubkey') {
            const attackerKp = await generateReceiverKeyPair();
            const attackerSpki = await exportSpki(attackerKp.publicKey);
            this.onmessage?.({
              data: JSON.stringify({
                ...parsed,
                envelope: { ...parsed.envelope, body: toBase64Url(attackerSpki) },
              }),
            });
            return;
          }
        }
      } catch {
        /* pass through on any parse/crypto error */
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 3 — Authenticated Handshake', () => {
  let server: TestServer;
  let serverUrl: string;

  beforeEach(async () => {
    server = await createTestServer();
    serverUrl = server.url;
  });

  afterEach(async () => {
    await server.close();
  });

  // ── Integration Test: Happy Path ────────────────────────────────────────────

  describe('Integration Test: Happy Path', () => {
    it('successfully completes handshake and derives identical session keys on sender and receiver', async () => {
      const secret = randomBytes(32);
      const sender = new SenderSession({ serverUrl, secret });

      const { shareUrl, expiresAt } = await sender.start();
      expect(sender.state).toBe('waitingForReceiver');
      expect(expiresAt).toBeGreaterThan(Date.now());

      const urlObj = new URL(shareUrl);
      const roomId = urlObj.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/)![1]!;

      const receiver = new ReceiverSession({ serverUrl, roomId, secret });

      let senderFp = '';
      let receiverFp = '';
      sender.on('fingerprint', (fp) => {
        senderFp = fp;
      });
      receiver.on('fingerprint', (fp) => {
        receiverFp = fp;
      });

      const senderReady = waitForState(sender, 'ready');
      const receiverReady = waitForState(receiver, 'ready');

      await receiver.start();
      await waitForState(sender, 'awaitingApproval');

      expect(senderFp).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(receiverFp).toBe(senderFp);

      await sender.approveReceiver();
      await Promise.all([senderReady, receiverReady]);

      expect(sender.state).toBe('ready');
      expect(receiver.state).toBe('ready');

      const senderKey = sender.getSessionKeyForTesting();
      const receiverKey = receiver.getSessionKeyForTesting();
      expect(senderKey).not.toBeNull();
      expect(receiverKey).not.toBeNull();

      const plaintext = new TextEncoder().encode('E2EE Handshake Payload: Confidential file data!');
      const header: FrameHeader = {
        version: 0x01,
        type: FRAME_TYPE_DATA,
        flags: FRAME_FLAG_FINAL,
        fileIndex: 0,
        seq: 0,
      };

      const senderFrame = await encryptFrame(senderKey!, 0x01, header, plaintext);
      const decryptedByRx = await decryptFrame(receiverKey!, 0x01, senderFrame);
      expect(new TextDecoder().decode(decryptedByRx.plaintext)).toBe(
        'E2EE Handshake Payload: Confidential file data!',
      );
      expect(decryptedByRx.header).toEqual(header);

      const reply = new TextEncoder().encode('Receiver verification response!');
      const rxFrame = await encryptFrame(receiverKey!, 0x02, header, reply);
      const decryptedByTx = await decryptFrame(senderKey!, 0x02, rxFrame);
      expect(new TextDecoder().decode(decryptedByTx.plaintext)).toBe(
        'Receiver verification response!',
      );

      sender.close();
      receiver.close();
    });
  });

  // ── Negative Test: MITM key swap ───────────────────────────────────────────

  describe('Negative Test: Malicious Server Swaps Public Key', () => {
    it('aborts with AUTH_FAILED when an adversarial proxy modifies the public key', async () => {
      const secret = randomBytes(32);

      const sender = new SenderSession({
        serverUrl,
        secret,
        WebSocketCtor: TamperingWebSocket as unknown as typeof WebSocket,
      });

      const { shareUrl } = await sender.start();
      const roomId = new URL(shareUrl).pathname.split('/r/')[1]!;

      const receiver = new ReceiverSession({ serverUrl, roomId, secret });

      let emittedError: ProtocolError | null = null;
      const errorPromise = new Promise<ProtocolError>((resolve) => {
        sender.on('error', (err) => {
          emittedError = err;
          resolve(err);
        });
      });

      await receiver.start();
      const error = await errorPromise;

      expect(error.code).toBe(ErrorCodes.AUTH_FAILED);
      // TypeScript 5.9+ narrows the let-initialised-null variable to `null` after
      // await because the callback assignment can't be statically verified; cast
      // it back to the declared type so the optional-chain resolves correctly.
      expect((emittedError as ProtocolError | null)?.code).toBe(ErrorCodes.AUTH_FAILED);
      expect(sender.state).toBe('failed');

      sender.close();
      receiver.close();
    });
  });

  // ── EnvelopeManager Unit Tests (no server needed) ──────────────────────────

  describe('EnvelopeManager Unit Tests', () => {
    it('signs and verifies valid envelope successfully', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const rxMgr = createEnvelopeManager();

      const env0 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'payload-0');
      expect(env0.seq).toBe(0);
      await rxMgr.verify(authKey, 'test-room-42', 'sender', env0);

      const env1 = await senderMgr.sign(
        authKey,
        'test-room-42',
        'sender',
        'wrapped-key',
        'payload-1',
      );
      expect(env1.seq).toBe(1);
      await rxMgr.verify(authKey, 'test-room-42', 'sender', env1);
    });

    it('rejects replayed envelope (same sequence number) with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const rxMgr = createEnvelopeManager();
      const env = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'payload');
      await rxMgr.verify(authKey, 'test-room-42', 'sender', env);
      await expect(rxMgr.verify(authKey, 'test-room-42', 'sender', env)).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
    });

    it('rejects out of order envelope (seq goes backwards) with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const rxMgr = createEnvelopeManager();
      const env0 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'msg-0');
      const env1 = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'key-ack', 'msg-1');
      await rxMgr.verify(authKey, 'test-room-42', 'sender', env1);
      await expect(rxMgr.verify(authKey, 'test-room-42', 'sender', env0)).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
    });

    it('rejects modified body after signing with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const rxMgr = createEnvelopeManager();
      const env = await senderMgr.sign(
        authKey,
        'test-room-42',
        'sender',
        'pubkey',
        'legitimate-body',
      );
      await expect(
        rxMgr.verify(authKey, 'test-room-42', 'sender', { ...env, body: 'tampered-body' }),
      ).rejects.toMatchObject({ code: ErrorCodes.AUTH_FAILED });
    });

    it('rejects modified type, role, or roomId with AUTH_FAILED', async () => {
      const authKey = await deriveAuthKey(randomBytes(32), 'test-room-42');
      const senderMgr = createEnvelopeManager();
      const rxMgr1 = createEnvelopeManager();
      const rxMgr2 = createEnvelopeManager();
      const rxMgr3 = createEnvelopeManager();
      const env = await senderMgr.sign(authKey, 'test-room-42', 'sender', 'pubkey', 'body');

      await expect(
        rxMgr1.verify(authKey, 'test-room-42', 'sender', { ...env, type: 'ice' }),
      ).rejects.toMatchObject({ code: ErrorCodes.AUTH_FAILED });
      await expect(rxMgr2.verify(authKey, 'test-room-42', 'receiver', env)).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
      await expect(rxMgr3.verify(authKey, 'different-room', 'sender', env)).rejects.toMatchObject({
        code: ErrorCodes.AUTH_FAILED,
      });
    });
  });

  // ── SignalingClient Unit Tests ─────────────────────────────────────────────

  describe('SignalingClient Unit Tests', () => {
    it('buffers messages sent during CONNECTING and flushes on open', async () => {
      const { port } = new URL(serverUrl);
      const wsUrl = `ws://127.0.0.1:${port}/ws`;

      let receivedJoined = false;
      const client = new SignalingClient({
        url: wsUrl,
        onMessage: (msg) => {
          if (msg.kind === 'joined') receivedJoined = true;
        },
        onClose: () => {},
      });

      const senderSecret = randomBytes(32);
      const senderInst = new SenderSession({ serverUrl, secret: senderSecret });
      const { shareUrl } = await senderInst.start();
      const roomId = new URL(shareUrl).pathname.split('/r/')[1]!;

      // Send join while socket may still be CONNECTING
      client.send({ kind: 'join', roomId, role: 'receiver' });

      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          if (receivedJoined) {
            clearInterval(id);
            resolve();
          }
        }, 50);
      });

      expect(receivedJoined).toBe(true);
      expect(client.state).toBe('open');
      client.close();
      senderInst.close();
    });

    it('silently ignores malformed or invalid messages from server', () => {
      let messageHandled = false;
      const client = new SignalingClient({
        url: 'ws://127.0.0.1:9999/dummy',
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
      mock.readyState = 1;
      mock.onopen();

      expect(closedCode).toBe(0);
      vi.advanceTimersByTime(5001);
      expect(closedCode).toBe(4008);
      expect(closedReason).toBe('Join timeout');

      client.close();
      vi.useRealTimers();
    });
  });

  // ── Session Edge Cases ─────────────────────────────────────────────────────

  describe('Session Edge Cases', () => {
    it('throws when initialized with secret that is not 32 bytes', () => {
      expect(() => new SenderSession({ serverUrl, secret: new Uint8Array(16) })).toThrow(
        /Invalid secret length/,
      );
      expect(
        () => new ReceiverSession({ serverUrl, roomId: 'room-1', secret: new Uint8Array(64) }),
      ).toThrow(/Invalid secret length/);
    });

    it('throws when illegal state transitions are attempted', async () => {
      const sender = new SenderSession({ serverUrl, secret: randomBytes(32) });
      await expect(sender.approveReceiver()).rejects.toThrow(
        /Cannot approve receiver in state: idle/,
      );
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
