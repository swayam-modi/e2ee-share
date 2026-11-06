import { PROTOCOL_VERSION } from '@e2ee-share/protocol';

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
export * from './crypto/random.js';
export * from './crypto/kdf.js';
export * from './crypto/mac.js';
export * from './crypto/rsa.js';
export * from './crypto/aead.js';
export * from './crypto/fingerprint.js';
export * from './crypto/_frame-types.js';
export * from './crypto/_buffer.js';

// Re-export Signaling APIs
export * from './signaling/client.js';
export * from './signaling/envelope.js';

// Re-export Session APIs
export * from './session/types.js';
export * from './session/sender-session.js';
export * from './session/receiver-session.js';

// Re-export RTC APIs
export * from './rtc/peer.js';
export * from './rtc/channel.js';

// Re-export Transfer APIs
export * from './transfer/control.js';
export * from './transfer/sinks/sink.js';
export * from './transfer/sinks/blob-sink.js';
export * from './transfer/sinks/fs-access-sink.js';
export type { FileOfferInfo } from './transfer/receiver.js';

