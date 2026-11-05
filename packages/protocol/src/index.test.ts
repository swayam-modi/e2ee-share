import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION, pingSchema } from './index';

describe('protocol package', () => {
  it('should export PROTOCOL_VERSION equal to 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('should validate ping messages using zod schema', () => {
    const valid = pingSchema.safeParse({ t: 'ping', timestamp: 12345 });
    expect(valid.success).toBe(true);

    const invalid = pingSchema.safeParse({ t: 'pong', timestamp: 12345 });
    expect(valid.success ? valid.data.timestamp : 0).toBe(12345);
    expect(invalid.success).toBe(false);
  });
});
