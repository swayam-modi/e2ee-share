/**
 * DataChannel binary frame constants and re-exports from @e2ee-share/protocol.
 */

export * from '@e2ee-share/protocol';

export const HEADER_SIZE = 11;
export const TAG_SIZE = 16;
export const NONCE_SIZE = 12;
export const AAD_SIZE = 12;
export const FRAME_VERSION = 0x01;
export const MAX_CONTROL_PLAINTEXT_SIZE = 16000;
