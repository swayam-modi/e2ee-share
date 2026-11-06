import { PROTOCOL_VERSION } from '../protocol/index';

/**
 * Core version based on the shared protocol version.
 */
export const CORE_VERSION = PROTOCOL_VERSION;

/**
 * Placeholder initialization function for @e2ee-share/core.
 */
export function initCore(): { version: number } {
  return { version: CORE_VERSION };
}

// Re-export Crypto Module APIs
export * from './crypto/random';
export * from './crypto/kdf';
export * from './crypto/mac';
export * from './crypto/rsa';
export * from './crypto/aead';
export * from './crypto/fingerprint';
export * from './crypto/_frame-types';
export * from './crypto/_buffer';

// Re-export Signaling APIs
export * from './signaling/client';
export * from './signaling/envelope';

// Re-export Session APIs
export * from './session/types';
export * from './session/sender-session';
export * from './session/receiver-session';

// Re-export RTC APIs
export * from './rtc/peer';
export * from './rtc/channel';

// Re-export Transfer APIs
export * from './transfer/control';
export * from './transfer/sinks/sink';
export * from './transfer/sinks/blob-sink';
export * from './transfer/sinks/fs-access-sink';
export type { FileOfferInfo } from './transfer/receiver';

