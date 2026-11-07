/**
 * Ephemeral RSA-OAEP key pair generation, SPKI export/import, and session key wrapping.
 * Implements Section 5.6 of the specification.
 */

import { toBufferSource } from './_buffer';

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 3072,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
  hash: 'SHA-256',
};

/**
 * Generates an ephemeral RSA-OAEP 3072-bit key pair for the receiver.
 */
export async function generateReceiverKeyPair(): Promise<CryptoKeyPair> {
  return await globalThis.crypto.subtle.generateKey(
    RSA_PARAMS,
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Exports the receiver's RSA-OAEP public key in SubjectPublicKeyInfo (SPKI) format.
 */
export async function exportSpki(pub: CryptoKey): Promise<Uint8Array> {
  const spki = await globalThis.crypto.subtle.exportKey('spki', pub);
  return new Uint8Array(spki);
}

/**
 * Imports an RSA-OAEP public key from SubjectPublicKeyInfo (SPKI) bytes.
 */
export async function importSpki(bytes: Uint8Array): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    'spki',
    toBufferSource(bytes),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt']
  );
}

/**
 * RSA-OAEP encrypts the raw 32-byte session key.
 * Returns the ciphertext as a Uint8Array.
 */
export async function wrapSessionKey(rawKey: Uint8Array, receiverPub: CryptoKey): Promise<Uint8Array> {
  if (rawKey.byteLength !== 32) {
    throw new Error(`Invalid session key length: expected 32 bytes, got ${rawKey.byteLength}`);
  }

  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    receiverPub,
    toBufferSource(rawKey)
  );
  return new Uint8Array(ciphertext);
}

/**
 * RSA-OAEP decrypts the wrapped session key, then imports it as a non-extractable AES-GCM key.
 * Intermediate raw byte buffers are zeroed out before returning.
 * Returns a non-extractable CryptoKey usable for AES-256-GCM.
 */
export async function unwrapSessionKey(wrapped: Uint8Array, receiverPriv: CryptoKey): Promise<CryptoKey> {
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    receiverPriv,
    toBufferSource(wrapped)
  );

  const rawKey = new Uint8Array(decrypted);
  try {
    if (rawKey.byteLength !== 32) {
      throw new Error(`Invalid session key length after unwrap: expected 32 bytes, got ${rawKey.byteLength}`);
    }

    return await globalThis.crypto.subtle.importKey(
      'raw',
      toBufferSource(rawKey),
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt']
    );
  } finally {
    rawKey.fill(0);
  }
}
