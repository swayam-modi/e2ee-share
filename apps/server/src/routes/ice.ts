import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function registerIceRoutes(app: FastifyInstance, config: Config): void {
  app.get(
    '/api/ice',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (_request, reply) => {
      const stunUrls = config.STUN_URLS.includes(',')
        ? config.STUN_URLS.split(',').map((s) => s.trim()).filter(Boolean)
        : config.STUN_URLS;

      const iceServers: IceServerConfig[] = [{ urls: stunUrls }];

      if (config.TURN_URLS && config.TURN_SECRET) {
        const turnUrls = config.TURN_URLS.includes(',')
          ? config.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean)
          : config.TURN_URLS;

        const expiryUnixSeconds = Math.floor(Date.now() / 1000) + 3600;
        const username = `${expiryUnixSeconds}:${crypto.randomBytes(8).toString('hex')}`;
        const credential = crypto
          .createHmac('sha1', config.TURN_SECRET)
          .update(username)
          .digest('base64');

        iceServers.push({
          urls: turnUrls,
          username,
          credential,
        });
      }

      return reply.send({ iceServers });
    }
  );
}
