import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { RoomStore } from '../rooms/room-store.js';
import { hashSenderToken } from '../rooms/room.js';

export function registerRoomRoutes(
  app: FastifyInstance,
  roomStore: RoomStore,
  config: Config
): void {
  app.post(
    '/api/rooms',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (_request, reply) => {
      if (roomStore.count() >= config.MAX_ROOMS) {
        return reply.code(503).send({ error: 'Server at capacity' });
      }

      const roomId = crypto.randomBytes(16).toString('base64url');
      const senderToken = crypto.randomBytes(32).toString('base64url');
      const senderTokenHash = hashSenderToken(senderToken);

      const now = Date.now();
      const expiresAt = now + config.ROOM_TTL_MAX_SEC * 1000;

      roomStore.create(roomId, senderTokenHash, now, expiresAt);

      return reply.code(201).send({
        roomId,
        senderToken,
        expiresAt,
      });
    }
  );
}
