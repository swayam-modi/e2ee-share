/**
 * Control message sending and receiving over encrypted DataChannel frames.
 * Implements Sections 5.7 and 5.8 of the specification.
 */

import {
  type Control,
  controlSchema,
  CONTROL_FILE_INDEX,
  CONTROL_MAX_PLAINTEXT,
  ErrorCodes,
  FRAME_TYPE_CONTROL,
  type FrameHeader,
  PROTOCOL_VERSION,
  ProtocolError,
} from '../../protocol/index';
import type { Channel } from '../rtc/channel';
import { decryptFrame, encryptFrame } from '../crypto/aead';

/**
 * Send a Control message as an encrypted CONTROL frame.
 * Uses fileIndex = CONTROL_FILE_INDEX, type = FRAME_TYPE_CONTROL.
 */
export async function sendControl(
  channel: Channel,
  key: CryptoKey,
  direction: number,
  seq: number,
  msg: Control
): Promise<void> {
  const validatedMsg = controlSchema.parse(msg);
  const jsonStr = JSON.stringify(validatedMsg);
  const plaintext = new TextEncoder().encode(jsonStr);

  if (plaintext.byteLength > CONTROL_MAX_PLAINTEXT) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Control message plaintext exceeds maximum size of ${CONTROL_MAX_PLAINTEXT} bytes: ${plaintext.byteLength}`
    );
  }

  const header: FrameHeader = {
    version: PROTOCOL_VERSION,
    type: FRAME_TYPE_CONTROL,
    flags: 0,
    fileIndex: CONTROL_FILE_INDEX,
    seq,
  };

  let frame: Uint8Array;
  try {
    frame = await encryptFrame(key, direction, header, plaintext);
  } catch (err) {
    throw new ProtocolError(
      ErrorCodes.CRYPTO_FAILED,
      `Failed to encrypt CONTROL frame: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  await channel.send(frame);
}

/**
 * Parse and validate a raw ArrayBuffer as a CONTROL frame.
 * Returns the decrypted Control message (validated via controlSchema).
 * Throws ProtocolError on any failure.
 */
export async function receiveControl(
  key: CryptoKey,
  direction: number,
  expectedSeq: number,
  data: ArrayBuffer
): Promise<{ msg: Control; seq: number }> {
  let decrypted: { header: FrameHeader; plaintext: Uint8Array };
  try {
    decrypted = await decryptFrame(key, direction, new Uint8Array(data));
  } catch (err) {
    throw new ProtocolError(
      ErrorCodes.CRYPTO_FAILED,
      `Failed to decrypt CONTROL frame: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (decrypted.header.type !== FRAME_TYPE_CONTROL) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Expected CONTROL frame type (${FRAME_TYPE_CONTROL}), received ${decrypted.header.type}`
    );
  }

  if (decrypted.header.fileIndex !== CONTROL_FILE_INDEX) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Expected CONTROL fileIndex (${CONTROL_FILE_INDEX}), received ${decrypted.header.fileIndex}`
    );
  }

  if (decrypted.header.seq !== expectedSeq) {
    throw new ProtocolError(
      ErrorCodes.INTEGRITY_FAILED,
      `Expected CONTROL sequence number ${expectedSeq}, received ${decrypted.header.seq}`
    );
  }

  let json: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(decrypted.plaintext);
    json = JSON.parse(text);
  } catch (err) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Failed to parse CONTROL frame payload as valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const result = controlSchema.safeParse(json);
  if (!result.success) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Invalid CONTROL message schema: ${result.error.message}`
    );
  }

  return {
    msg: result.data,
    seq: decrypted.header.seq,
  };
}
