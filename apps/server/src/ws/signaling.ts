import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  ErrorCodes,
  type ErrorCode,
  clientMessageSchema,
  type ServerMessage,
  MAX_WS_MESSAGE_BYTES,
  WS_JOIN_TIMEOUT_MS,
} from '@e2ee-share/protocol';
import type { RoomStore } from '../rooms/room-store.js';
import { verifySenderToken } from '../rooms/room.js';

function hashRoomId(roomId: string): string {
  return crypto.createHash('sha256').update(roomId, 'utf8').digest('hex').slice(0, 8);
}

function sendServerMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === 1 /* WebSocket.OPEN */) {
    socket.send(JSON.stringify(message));
  }
}

function sendErrorAndClose(socket: WebSocket, code: ErrorCode, message: string): void {
  sendServerMessage(socket, {
    kind: 'error',
    code,
    message,
  });
  socket.close();
}

/**
 * Registers the WebSocket signaling handler on /ws.
 */
export function registerSignalingWs(app: FastifyInstance, roomStore: RoomStore): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    let currentRoomId: string | undefined;
    let currentRole: 'sender' | 'receiver' | undefined;
    let hasJoined = false;

    // Per-socket message rate limit: max 100 messages per 10 seconds
    const MAX_MESSAGES_PER_WINDOW = 100;
    const RATE_LIMIT_WINDOW_MS = 10_000;
    const messageTimestamps: number[] = [];

    // 5-second join timeout
    const joinTimeout = setTimeout(() => {
      if (!hasJoined) {
        req.log.warn({
          event: 'join_timeout',
          error: ErrorCodes.INVALID_MESSAGE,
        });
        sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'Join timeout');
      }
    }, WS_JOIN_TIMEOUT_MS);

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      // 1. Per-socket rate limit
      const now = Date.now();
      while (messageTimestamps.length > 0 && messageTimestamps[0]! <= now - RATE_LIMIT_WINDOW_MS) {
        messageTimestamps.shift();
      }
      if (messageTimestamps.length >= MAX_MESSAGES_PER_WINDOW) {
        req.log.warn({
          event: 'rate_limited',
          roomHash: currentRoomId ? hashRoomId(currentRoomId) : undefined,
          error: ErrorCodes.RATE_LIMITED,
        });
        sendErrorAndClose(socket, ErrorCodes.RATE_LIMITED, 'Message rate limit exceeded');
        return;
      }
      messageTimestamps.push(now);

      // 2. Max message size limit (64 KiB)
      const byteLength = Buffer.isBuffer(raw)
        ? raw.length
        : Array.isArray(raw)
          ? raw.reduce((sum, b) => sum + b.length, 0)
          : raw.byteLength;

      if (byteLength > MAX_WS_MESSAGE_BYTES) {
        req.log.warn({
          event: 'oversized_message',
          roomHash: currentRoomId ? hashRoomId(currentRoomId) : undefined,
          error: ErrorCodes.INVALID_MESSAGE,
        });
        sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'Message exceeds 64 KiB limit');
        return;
      }

      // 3. Parse JSON
      let text: string;
      try {
        text = raw.toString('utf8');
      } catch {
        sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'Invalid UTF-8');
        return;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'Malformed JSON');
        return;
      }

      // 4. Validate with zod
      const parsed = clientMessageSchema.safeParse(parsedJson);
      if (!parsed.success) {
        req.log.warn({
          event: 'invalid_message',
          roomHash: currentRoomId ? hashRoomId(currentRoomId) : undefined,
          error: ErrorCodes.INVALID_MESSAGE,
        });
        sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'Invalid message structure');
        return;
      }

      const clientMsg = parsed.data;

      // Handle unjoined state: first message MUST be join
      if (!hasJoined) {
        if (clientMsg.kind !== 'join') {
          req.log.warn({
            event: 'expected_join',
            error: ErrorCodes.INVALID_MESSAGE,
          });
          sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'First message must be join');
          return;
        }

        const { roomId, role, senderToken } = clientMsg;
        const room = roomStore.get(roomId);

        if (!room || room.expiresAt <= Date.now() || room.state === 'CLOSED') {
          req.log.warn({
            event: 'room_not_found',
            roomHash: hashRoomId(roomId),
            error: ErrorCodes.ROOM_NOT_FOUND,
          });
          sendErrorAndClose(socket, ErrorCodes.ROOM_NOT_FOUND, 'Room not found or expired');
          return;
        }

        if (room.state === 'LOCKED') {
          req.log.warn({
            event: 'room_locked',
            roomHash: hashRoomId(roomId),
            error: ErrorCodes.ROOM_LOCKED,
          });
          sendErrorAndClose(socket, ErrorCodes.ROOM_LOCKED, 'Room is locked');
          return;
        }

        if (role === 'sender') {
          if (!senderToken) {
            req.log.warn({
              event: 'missing_token',
              roomHash: hashRoomId(roomId),
              error: ErrorCodes.INVALID_TOKEN,
            });
            sendErrorAndClose(socket, ErrorCodes.INVALID_TOKEN, 'Sender token required');
            return;
          }

          if (!verifySenderToken(senderToken, room.senderTokenHash)) {
            req.log.warn({
              event: 'invalid_token',
              roomHash: hashRoomId(roomId),
              error: ErrorCodes.INVALID_TOKEN,
            });
            sendErrorAndClose(socket, ErrorCodes.INVALID_TOKEN, 'Invalid sender token');
            return;
          }

          if (room.sender && room.sender.readyState === 1 /* OPEN */) {
            req.log.warn({
              event: 'sender_already_joined',
              roomHash: hashRoomId(roomId),
              error: ErrorCodes.ROOM_LOCKED,
            });
            sendErrorAndClose(socket, ErrorCodes.ROOM_LOCKED, 'Sender already joined');
            return;
          }

          room.sender = socket;
        } else {
          // role === 'receiver'
          if (room.receiver && room.receiver.readyState === 1 /* OPEN */) {
            req.log.warn({
              event: 'receiver_already_joined',
              roomHash: hashRoomId(roomId),
              error: ErrorCodes.ROOM_LOCKED,
            });
            sendErrorAndClose(socket, ErrorCodes.ROOM_LOCKED, 'Receiver already joined');
            return;
          }

          room.receiver = socket;
        }

        clearTimeout(joinTimeout);
        hasJoined = true;
        currentRoomId = roomId;
        currentRole = role;

        const peer = role === 'sender' ? room.receiver : room.sender;
        const peerPresent = Boolean(peer && peer.readyState === 1 /* OPEN */);

        if (room.sender && room.receiver) {
          room.state = 'LOCKED';
        } else if (room.sender) {
          room.state = 'WAITING_RECEIVER';
        } else {
          room.state = 'WAITING_SENDER';
        }

        req.log.info({
          event: 'joined',
          roomHash: hashRoomId(roomId),
          role,
          peerPresent,
        });

        sendServerMessage(socket, {
          kind: 'joined',
          role,
          peerPresent,
        });

        if (peerPresent && peer) {
          sendServerMessage(peer, {
            kind: 'peer-joined',
          });
        }
        return;
      }

      // Handle joined state
      if (clientMsg.kind === 'join') {
        req.log.warn({
          event: 'duplicate_join',
          roomHash: currentRoomId ? hashRoomId(currentRoomId) : undefined,
          error: ErrorCodes.INVALID_MESSAGE,
        });
        sendErrorAndClose(socket, ErrorCodes.INVALID_MESSAGE, 'Already joined');
        return;
      }

      if (clientMsg.kind === 'signal') {
        if (!currentRoomId || !currentRole) return;
        const room = roomStore.get(currentRoomId);
        if (!room) return;

        const peer = currentRole === 'sender' ? room.receiver : room.sender;
        if (peer && peer.readyState === 1 /* OPEN */) {
          sendServerMessage(peer, {
            kind: 'signal',
            envelope: clientMsg.envelope,
          });
        }
        return;
      }

      if (clientMsg.kind === 'bye') {
        req.log.info({
          event: 'bye',
          roomHash: currentRoomId ? hashRoomId(currentRoomId) : undefined,
        });

        if (currentRoomId) {
          const room = roomStore.get(currentRoomId);
          if (room) {
            room.state = 'CLOSED';
            roomStore.delete(currentRoomId);
            const otherPeer = currentRole === 'sender' ? room.receiver : room.sender;
            if (otherPeer && otherPeer.readyState === 1 /* OPEN */) {
              otherPeer.close();
            }
          }
        }
        socket.close();
        return;
      }
    });

    const cleanup = () => {
      clearTimeout(joinTimeout);
      if (!currentRoomId || !currentRole) return;
      const room = roomStore.get(currentRoomId);
      if (!room) return;

      if (room.state === 'CLOSED') return;

      req.log.info({
        event: 'peer_left',
        roomHash: hashRoomId(currentRoomId),
        role: currentRole,
      });

      room.state = 'CLOSED';
      roomStore.delete(currentRoomId);

      const otherPeer = currentRole === 'sender' ? room.receiver : room.sender;
      if (otherPeer && otherPeer.readyState === 1 /* OPEN */) {
        sendServerMessage(otherPeer, { kind: 'peer-left' });
        otherPeer.close();
      }
    };

    socket.on('close', cleanup);
    socket.on('error', (err) => {
      req.log.warn({
        event: 'socket_error',
        roomHash: currentRoomId ? hashRoomId(currentRoomId) : undefined,
        error: err.message,
      });
      cleanup();
    });
  });
}
