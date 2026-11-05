import Fastify, { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@e2ee-share/protocol';

export const SERVER_PROTOCOL_VERSION = PROTOCOL_VERSION;

/**
 * Creates and configures the Fastify server instance.
 */
export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: false,
  });

  server.get('/healthz', async () => {
    return { status: 'ok', protocolVersion: SERVER_PROTOCOL_VERSION };
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = buildServer();
  const port = Number(process.env['PORT'] ?? 3000);
  await server.listen({ port, host: '0.0.0.0' });
}
