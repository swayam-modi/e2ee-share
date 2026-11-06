import {
  FRAME_HEADER_SIZE,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DATA,
  PROTOCOL_VERSION,
} from './constants.js';
import { ErrorCodes, ProtocolError } from './errors.js';

export interface FrameHeader {
  version: number; // must be 0x01
  type: number; // 0x01 CONTROL | 0x02 DATA
  flags: number; // bit0 = FINAL
  fileIndex: number; // u32
  seq: number; // u32
}

/**
 * Encodes an 11-byte binary frame header.
 */
export function encodeHeader(h: FrameHeader): Uint8Array {
  const buf = new Uint8Array(FRAME_HEADER_SIZE);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  view.setUint8(0, h.version);
  view.setUint8(1, h.type);
  view.setUint8(2, h.flags);
  view.setUint32(3, h.fileIndex, false); // big-endian
  view.setUint32(7, h.seq, false); // big-endian

  return buf;
}

/**
 * Decodes an 11-byte binary frame header from a Uint8Array.
 * Throws ProtocolError on bad version, invalid type, or insufficient length.
 */
export function decodeHeader(buf: Uint8Array): FrameHeader {
  if (buf.byteLength < FRAME_HEADER_SIZE) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Frame header too short: expected at least ${FRAME_HEADER_SIZE} bytes, received ${buf.byteLength}`
    );
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      ErrorCodes.INVALID_MESSAGE,
      `Unsupported frame version: ${version} (expected ${PROTOCOL_VERSION})`
    );
  }

  const type = view.getUint8(1);
  if (type !== FRAME_TYPE_CONTROL && type !== FRAME_TYPE_DATA) {
    throw new ProtocolError(ErrorCodes.INVALID_MESSAGE, `Unknown frame type: ${type}`);
  }

  const flags = view.getUint8(2);
  const fileIndex = view.getUint32(3, false);
  const seq = view.getUint32(7, false);

  return {
    version,
    type,
    flags,
    fileIndex,
    seq,
  };
}

/**
 * Builds a 12-byte nonce for AES-GCM encryption.
 * Format: [direction u8][0x00 0x00 0x00][fileIndex u32][seq u32]
 */
export function buildNonce(direction: number, fileIndex: number, seq: number): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);

  view.setUint8(0, direction);
  // bytes 1, 2, 3 are zero-initialized
  view.setUint32(4, fileIndex, false);
  view.setUint32(8, seq, false);

  return nonce;
}

/**
 * Builds the Additional Authenticated Data (AAD) for AES-GCM.
 * Format: header bytes || direction byte
 */
export function buildAAD(header: Uint8Array | FrameHeader, direction: number): Uint8Array {
  const headerBytes = header instanceof Uint8Array ? header : encodeHeader(header);
  const aad = new Uint8Array(headerBytes.length + 1);
  aad.set(headerBytes, 0);
  aad[headerBytes.length] = direction;
  return aad;
}
