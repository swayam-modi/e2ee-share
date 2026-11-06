import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
  TURN_URLS: z.string().default(''),
  TURN_SECRET: z.string().optional(),
  ROOM_TTL_UNJOINED_SEC: z.coerce.number().default(600),
  ROOM_TTL_MAX_SEC: z.coerce.number().default(3600),
  MAX_ROOMS: z.coerce.number().default(10000),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides?: Record<string, unknown>): Config {
  return envSchema.parse({
    ...process.env,
    ...overrides,
  });
}
