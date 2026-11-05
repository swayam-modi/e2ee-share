import { z } from 'zod';

/**
 * Protocol version constant.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Placeholder schema for protocol messages.
 */
export const pingSchema = z.object({
  t: z.literal('ping'),
  timestamp: z.number(),
});

export type PingMessage = z.infer<typeof pingSchema>;
