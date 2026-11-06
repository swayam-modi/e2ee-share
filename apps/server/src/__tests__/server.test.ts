import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AppInstance } from '../app.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  ErrorCodes,
  type ServerMessage,
  type Envelope,
} from '@e2ee-share/protocol';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitForMessage<T = ServerMessage>(ws: WebSocket, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString('utf8')) as T);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString('utf8') });
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Signaling Server', () => {
  let app: AppInstance;
  let wsUrl: string;
  const activeSockets: WebSocket[] = [];

  const createSocket = async (): Promise<WebSocket> => {
    const ws = new WebSocket(wsUrl);
    activeSockets.push(ws);
    await waitForOpen(ws);
    return ws;
  };

  beforeEach(async () => {
    const config = loadConfig({
      LOG_LEVEL: 'fatal',
      STUN_URLS: 'stun:stun.example.com:19302',
      TURN_URLS: 'turn:turn.example.com:3478',
      TURN_SECRET: 'test-turn-secret-key-12345',
      ROOM_TTL_UNJOINED_SEC: 600,
      ROOM_TTL_MAX_SEC: 3600,
    });
    app = await buildApp(config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    activeSockets.length = 0;
    await app.close();
  });

  it('1. Room lifecycle: create, join sender, join receiver -> LOCKED, third socket rejected', async () => {
    // 1. Create room
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
    });
    expect(createRes.statusCode).toBe(201);
    const { roomId, senderToken } = JSON.parse(createRes.body);
    expect(roomId).toBeTruthy();
    expect(senderToken).toBeTruthy();

    // 2. Join sender
    const senderWs = await createSocket();
    senderWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'sender',
        senderToken,
      })
    );

    const senderJoined = await waitForMessage(senderWs);
    expect(senderJoined).toEqual({
      kind: 'joined',
      role: 'sender',
      peerPresent: false,
    });

    const roomAfterSender = app.roomStore.get(roomId);
    expect(roomAfterSender?.state).toBe('WAITING_RECEIVER');

    // 3. Join receiver
    const receiverWs = await createSocket();
    const senderPeerJoinedPromise = waitForMessage(senderWs);

    receiverWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'receiver',
      })
    );

    const receiverJoined = await waitForMessage(receiverWs);
    expect(receiverJoined).toEqual({
      kind: 'joined',
      role: 'receiver',
      peerPresent: true,
    });

    const senderPeerJoined = await senderPeerJoinedPromise;
    expect(senderPeerJoined).toEqual({
      kind: 'peer-joined',
    });

    // Room is now locked
    const roomAfterReceiver = app.roomStore.get(roomId);
    expect(roomAfterReceiver?.state).toBe('LOCKED');

    // 4. Third socket rejected
    const thirdWs = await createSocket();
    thirdWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'receiver',
      })
    );

    const thirdError = await waitForMessage(thirdWs);
    expect(thirdError).toEqual({
      kind: 'error',
      code: ErrorCodes.ROOM_LOCKED,
      message: 'Room is locked',
    });
  });

  it('2. TTL expiry: a room with past expiresAt is swept', async () => {
    const roomId = 'expired-room-id';
    const senderTokenHash = 'some-dummy-hash';
    const now = Date.now();
    const pastExpiresAt = now - 5000;

    app.roomStore.create(roomId, senderTokenHash, now - 10000, pastExpiresAt);
    expect(app.roomStore.get(roomId)).toBeDefined();

    // Run sweeper
    app.roomStore.sweep(now);
    expect(app.roomStore.get(roomId)).toBeUndefined();

    // Attempting to join swept room yields ROOM_NOT_FOUND
    const ws = await createSocket();
    ws.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'receiver',
      })
    );

    const errorMsg = await waitForMessage(ws);
    expect(errorMsg).toEqual({
      kind: 'error',
      code: ErrorCodes.ROOM_NOT_FOUND,
      message: 'Room not found or expired',
    });
  });

  it('3. Wrong senderToken -> error INVALID_TOKEN', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
    });
    const { roomId } = JSON.parse(createRes.body);

    const senderWs = await createSocket();
    senderWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'sender',
        senderToken: 'wrong-sender-token',
      })
    );

    const errorMsg = await waitForMessage(senderWs);
    expect(errorMsg).toEqual({
      kind: 'error',
      code: ErrorCodes.INVALID_TOKEN,
      message: 'Invalid sender token',
    });

    const closeInfo = await waitForClose(senderWs);
    expect(closeInfo).toBeDefined();
  });

  it('4. bye cleans up the room', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
    });
    const { roomId, senderToken } = JSON.parse(createRes.body);

    const senderWs = await createSocket();
    senderWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'sender',
        senderToken,
      })
    );
    await waitForMessage(senderWs);

    const receiverWs = await createSocket();
    receiverWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'receiver',
      })
    );
    await waitForMessage(receiverWs);
    await waitForMessage(senderWs); // peer-joined

    expect(app.roomStore.get(roomId)).toBeDefined();

    // Sender sends bye
    senderWs.send(JSON.stringify({ kind: 'bye' }));

    // Both sockets close and room is deleted
    await Promise.all([waitForClose(senderWs), waitForClose(receiverWs)]);
    expect(app.roomStore.get(roomId)).toBeUndefined();
  });

  it('5. Relay is verbatim: whatever the sender puts in signal.envelope, the receiver gets exactly', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
    });
    const { roomId, senderToken } = JSON.parse(createRes.body);

    const senderWs = await createSocket();
    senderWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'sender',
        senderToken,
      })
    );
    await waitForMessage(senderWs);

    const receiverWs = await createSocket();
    receiverWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'receiver',
      })
    );
    await waitForMessage(receiverWs);
    await waitForMessage(senderWs); // peer-joined

    const envelope: Envelope = {
      seq: 42,
      type: 'pubkey',
      body: 'test-verbatim-key-payload-string-with-symbols-!@#$%^&*()',
      mac: 'test-verbatim-mac-value-1234567890',
    };

    const receiverSignalPromise = waitForMessage(receiverWs);
    senderWs.send(
      JSON.stringify({
        kind: 'signal',
        envelope,
      })
    );

    const relayedMsg = await receiverSignalPromise;
    expect(relayedMsg).toEqual({
      kind: 'signal',
      envelope,
    });
  });

  it('6. Oversized message (>64 KiB) -> rejected with INVALID_MESSAGE', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
    });
    const { roomId, senderToken } = JSON.parse(createRes.body);

    const senderWs = await createSocket();
    senderWs.send(
      JSON.stringify({
        kind: 'join',
        roomId,
        role: 'sender',
        senderToken,
      })
    );
    await waitForMessage(senderWs);

    // Build payload larger than 64 KiB (65536 bytes)
    const largeBody = 'A'.repeat(66 * 1024);
    const oversized = JSON.stringify({
      kind: 'signal',
      envelope: {
        seq: 1,
        type: 'pubkey',
        body: largeBody,
        mac: 'some-mac',
      },
    });

    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(64 * 1024);

    senderWs.send(oversized);
    const errorMsg = await waitForMessage(senderWs);
    expect(errorMsg).toEqual({
      kind: 'error',
      code: ErrorCodes.INVALID_MESSAGE,
      message: 'Message exceeds 64 KiB limit',
    });
  });

  it('7. /api/ice credential: username format and HMAC validation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ice',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.iceServers).toBeInstanceOf(Array);
    expect(data.iceServers.length).toBe(2);

    // Stun check
    expect(data.iceServers[0].urls).toBe('stun:stun.example.com:19302');

    // Turn check
    const turnServer = data.iceServers[1];
    expect(turnServer.urls).toBe('turn:turn.example.com:3478');
    expect(typeof turnServer.username).toBe('string');
    expect(typeof turnServer.credential).toBe('string');

    // Username format: "<expiryUnixSeconds>:<16 hex chars>"
    const match = /^(\d+):([0-9a-f]{16})$/.exec(turnServer.username);
    expect(match).not.toBeNull();

    const expirySec = Number(match![1]);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(expirySec).toBeGreaterThan(nowSec + 3000); // ~3600 seconds in future
    expect(expirySec).toBeLessThanOrEqual(nowSec + 3600 + 10);

    // Verify HMAC-SHA1 credential
    const expectedCredential = crypto
      .createHmac('sha1', 'test-turn-secret-key-12345')
      .update(turnServer.username)
      .digest('base64');

    expect(turnServer.credential).toBe(expectedCredential);
  });

  it('8. /healthz returns { status: "ok" }', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  it('should verify security headers on HTTP responses', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
    });

    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
