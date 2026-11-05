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
