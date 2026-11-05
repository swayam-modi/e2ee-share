import { describe, it, expect } from 'vitest';
import { buildServer, SERVER_PROTOCOL_VERSION } from './index';

describe('server package', () => {
  it('should export SERVER_PROTOCOL_VERSION matching protocol version', () => {
    expect(SERVER_PROTOCOL_VERSION).toBe(1);
  });

  it('should respond to /healthz endpoint', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      status: 'ok',
      protocolVersion: 1,
    });
  });
});
