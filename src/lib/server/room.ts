import crypto from 'node:crypto';
import type { WebSocket } from 'ws';

export type RoomState = 'WAITING_SENDER' | 'WAITING_RECEIVER' | 'LOCKED' | 'CLOSED';

export interface Room {
  id: string;
  senderTokenHash: string; // SHA-256 hash as hex
  state: RoomState;
  sender?: WebSocket;
  receiver?: WebSocket;
  createdAt: number;
  expiresAt: number;
}

/**
 * Computes SHA-256 hash of a sender token as a hex string.
 */
export function hashSenderToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time verification of a sender token against its stored hash.
 */
export function verifySenderToken(token: string, storedHash: string): boolean {
  const computedHash = hashSenderToken(token);
  const computedBuf = Buffer.from(computedHash, 'hex');
  const storedBuf = Buffer.from(storedHash, 'hex');

  if (computedBuf.length !== storedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuf, storedBuf);
}
