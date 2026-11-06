/**
 * Envelope HMAC-SHA-256 signing and constant-time verification.
 * Implements Section 5.4 of the specification.
 */

import { toBase64Url, fromBase64Url } from './random.js';
import { toBufferSource } from './_buffer.js';

export interface EnvelopeFields {
  roomId: string;
  fromRole: string;
  seq: number;
  type: string;
  body: string;
}

function canonicalEnvelopeMessage(fields: EnvelopeFields): Uint8Array {
  const canonical = `${fields.roomId}|${fields.fromRole}|${fields.seq}|${fields.type}|${fields.body}`;
  return new TextEncoder().encode(canonical);
}

/**
 * Computes HMAC-SHA-256 over the canonical envelope fields.
 * message = UTF-8(`${roomId}|${fromRole}|${seq}|${type}|${body}`)
 * Returns base64url MAC.
 */
export async function signEnvelope(
  authKey: CryptoKey,
  fields: EnvelopeFields
): Promise<string> {
  const message = canonicalEnvelopeMessage(fields);
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    authKey,
    toBufferSource(message)
  );
  return toBase64Url(new Uint8Array(signature));
}

/**
 * Constant-time MAC verification using subtle.verify.
 * Returns true if valid.
 */
export async function verifyEnvelope(
  authKey: CryptoKey,
  fields: EnvelopeFields,
  mac: string
): Promise<boolean> {
  let macBytes: Uint8Array;
  try {
    macBytes = fromBase64Url(mac);
  } catch {
    return false;
  }

  const message = canonicalEnvelopeMessage(fields);
  try {
    return await globalThis.crypto.subtle.verify(
      'HMAC',
      authKey,
      toBufferSource(macBytes),
      toBufferSource(message)
    );
  } catch {
    return false;
  }
}
