import { loadConfig } from './config.js';
import { buildApp } from './app.js';

export { buildApp, type AppInstance } from './app.js';
export { loadConfig, type Config } from './config.js';

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    const address = await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info({ event: 'server_started', address, port: config.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  void startServer();
}
