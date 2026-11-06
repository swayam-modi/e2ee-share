export const ErrorCodes = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_EXPIRED: 'ROOM_EXPIRED',
  ROOM_LOCKED: 'ROOM_LOCKED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  RATE_LIMITED: 'RATE_LIMITED',
  PEER_LEFT: 'PEER_LEFT',
  AUTH_FAILED: 'AUTH_FAILED',
  CRYPTO_FAILED: 'CRYPTO_FAILED',
  ICE_FAILED: 'ICE_FAILED',
  CHANNEL_CLOSED: 'CHANNEL_CLOSED',
  TRANSFER_CANCELLED: 'TRANSFER_CANCELLED',
  INTEGRITY_FAILED: 'INTEGRITY_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ProtocolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProtocolError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
