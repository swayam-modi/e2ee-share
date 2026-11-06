import fs from 'node:fs';
import path from 'node:path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { ROOM_SWEEPER_INTERVAL_MS } from '@e2ee-share/protocol';

import type { Config } from './config.js';
import type { RoomStore } from './rooms/room-store.js';
import { MemoryRoomStore } from './rooms/memory-store.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { registerRateLimitPlugin } from './plugins/rate-limit.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerIceRoutes } from './routes/ice.js';
import { registerSignalingWs } from './ws/signaling.js';

export interface AppInstance extends FastifyInstance {
  roomStore: RoomStore;
}

/**
 * Builds and configures the Fastify server instance.
 */
export async function buildApp(
  config: Config,
  customRoomStore?: RoomStore
): Promise<AppInstance> {
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'fatal'
        ? false
        : {
            level: config.LOG_LEVEL,
          },
  }) as unknown as AppInstance;

  const roomStore = customRoomStore ?? new MemoryRoomStore();
  app.roomStore = roomStore;

  // 1. Security headers & CSP
  await registerSecurityPlugins(app, config);

  // 2. Global rate limiting
  await registerRateLimitPlugin(app, config);

  // 3. WebSocket support (allow up to 128 KiB at transport so 64 KiB app-level limit can send INVALID_MESSAGE)
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 128 * 1024,
    },
  });

  // 4. Routes
  registerHealthRoutes(app);
  registerRoomRoutes(app, roomStore, config);
  registerIceRoutes(app, config);
  registerSignalingWs(app, roomStore);

  // 5. Static file serving if apps/web/dist exists (production)
  try {
    const webDistPath = path.resolve(import.meta.dirname, '../../web/dist');
    if (fs.existsSync(webDistPath)) {
      const fastifyStatic = (await import('@fastify/static')).default;
      await app.register(fastifyStatic, {
        root: webDistPath,
        wildcard: false,
      });

      app.setNotFoundHandler((_request, reply) => {
        reply.sendFile('index.html');
      });
    }
  } catch {
    // web dist not present, skip static plugin
  }

  // 6. Sweeper interval for expired rooms
  const sweeperInterval = setInterval(() => {
    roomStore.sweep(Date.now());
  }, ROOM_SWEEPER_INTERVAL_MS);
  sweeperInterval.unref();

  app.addHook('onClose', async () => {
    clearInterval(sweeperInterval);
  });

  return app;
}
