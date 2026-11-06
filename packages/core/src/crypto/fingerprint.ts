/**
 * Short fingerprint calculation for public key out-of-band verification.
 * Implements Section 5.6 of the specification:
 * SHA-256(SPKI bytes), first 8 bytes, formatted as 4 groups of 4 uppercase hex chars.
 * Example: "9F2A-71BC-0D44-E8A3"
 */

import { toBufferSource } from './_buffer.js';

export async function fingerprint(spki: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', toBufferSource(spki));
  const hashBytes = new Uint8Array(hashBuffer, 0, 8);

  let hex = '';
  for (let i = 0; i < 8; i++) {
    const byte = hashBytes[i];
    if (byte !== undefined) {
      hex += byte.toString(16).padStart(2, '0').toUpperCase();
    }
  }

  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}
