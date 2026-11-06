import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import type { Config } from '../config.js';

export async function registerSecurityPlugins(
  app: FastifyInstance,
  config: Config
): Promise<void> {
  let wsOrigin = 'ws: wss:';
  try {
    const parsed = new URL(config.PUBLIC_URL);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    wsOrigin = `${wsProto}//${parsed.host}`;
  } catch {
    // fallback to generic ws: wss:
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", wsOrigin, 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: {
      policy: 'no-referrer',
    },
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
    }
  });
}
