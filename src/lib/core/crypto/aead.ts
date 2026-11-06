/**
 * AES-256-GCM encryption and decryption for DataChannel binary frames.
 * Implements Section 5.7 of the specification.
 */

import {
  type FrameHeader,
  FRAME_HEADER_SIZE,
  CONTROL_MAX_PLAINTEXT,
  encodeHeader,
  decodeHeader,
  buildNonce,
  buildAAD,
} from '../../protocol/index';
import { TAG_SIZE } from './_frame-types';
import { toBufferSource } from './_buffer';

export const MAX_ALLOWED_FRAME_SIZE = FRAME_HEADER_SIZE + TAG_SIZE + CONTROL_MAX_PLAINTEXT; // 16,027 bytes

/**
 * Encrypts plaintext into a full DataChannel frame:
 * Result = encodeHeader(header) || AES-GCM-256(plaintext) with 128-bit tag.
 * The 11-byte header and 1-byte direction are authenticated as AAD (12 bytes).
 */
export async function encryptFrame(
  key: CryptoKey,
  direction: number,
  header: FrameHeader,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const headerBytes = encodeHeader(header);
  const nonce = buildNonce(direction, header.fileIndex, header.seq);
  const aad = buildAAD(headerBytes, direction);

  const ciphertextWithTag = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(aad),
      tagLength: 128,
    },
    key,
    toBufferSource(plaintext)
  );

  const frame = new Uint8Array(FRAME_HEADER_SIZE + ciphertextWithTag.byteLength);
  frame.set(headerBytes, 0);
  frame.set(new Uint8Array(ciphertextWithTag), FRAME_HEADER_SIZE);
  return frame;
}

/**
 * Decrypts a full DataChannel frame buffer.
 * Validates version=0x01, known type (CONTROL or DATA), and ciphertext size.
 * Returns decoded header and decrypted plaintext.
 */
export async function decryptFrame(
  key: CryptoKey,
  direction: number,
  frame: Uint8Array
): Promise<{ header: FrameHeader; plaintext: Uint8Array }> {
  if (frame.byteLength < FRAME_HEADER_SIZE + TAG_SIZE) {
    throw new Error(`Frame too short: ${frame.byteLength} bytes (minimum is ${FRAME_HEADER_SIZE + TAG_SIZE})`);
  }

  if (frame.byteLength > MAX_ALLOWED_FRAME_SIZE) {
    throw new Error(`Frame exceeds maximum size: ${frame.byteLength} > ${MAX_ALLOWED_FRAME_SIZE}`);
  }

  const headerBytes = frame.subarray(0, FRAME_HEADER_SIZE);
  const header = decodeHeader(headerBytes);

  const nonce = buildNonce(direction, header.fileIndex, header.seq);
  const aad = buildAAD(headerBytes, direction);
  const ciphertextWithTag = frame.subarray(FRAME_HEADER_SIZE);

  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(aad),
      tagLength: 128,
    },
    key,
    toBufferSource(ciphertextWithTag)
  );

  return {
    header,
    plaintext: new Uint8Array(decrypted),
  };
}
