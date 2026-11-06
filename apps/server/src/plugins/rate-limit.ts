import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Config } from '../config.js';

export async function registerRateLimitPlugin(
  app: FastifyInstance,
  _config: Config
): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
  });
}
