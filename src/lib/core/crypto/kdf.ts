/**
 * Key derivation functions using Web Crypto API HKDF-SHA-256.
 * Implements Section 5.4 of the specification.
 */

import { toBufferSource } from './_buffer';

const AUTH_KEY_INFO = new TextEncoder().encode('e2ee-share v1 auth');

/**
 * HKDF-SHA-256 to derive the envelope authentication key.
 * ikm = secret (32-byte Uint8Array)
 * salt = UTF-8 encoded roomId
 * info = UTF-8 "e2ee-share v1 auth"
 * length = 32 bytes (256 bits)
 * Returns a non-extractable HMAC-SHA-256 CryptoKey.
 */
export async function deriveAuthKey(secret: Uint8Array, roomId: string): Promise<CryptoKey> {
  if (secret.byteLength !== 32) {
    throw new Error(`Invalid secret length: expected 32 bytes, got ${secret.byteLength}`);
  }

  const ikmKey = await globalThis.crypto.subtle.importKey(
    'raw',
    toBufferSource(secret),
    'HKDF',
    false,
    ['deriveKey']
  );

  const salt = new TextEncoder().encode(roomId);

  return await globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(salt),
      info: toBufferSource(AUTH_KEY_INFO),
    },
    ikmKey,
    {
      name: 'HMAC',
      hash: 'SHA-256',
      length: 256,
    },
    false, // non-extractable
    ['sign', 'verify']
  );
}
