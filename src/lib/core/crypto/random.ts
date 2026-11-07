/**
 * Cryptographically secure random bytes and RFC 4648 §5 base64url encoding/decoding.
 * Uses Web Crypto API (globalThis.crypto).
 */

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODE_LOOKUP = new Int8Array(128);
DECODE_LOOKUP.fill(-1);
for (let i = 0; i < BASE64URL_CHARS.length; i++) {
  const code = BASE64URL_CHARS.charCodeAt(i);
  DECODE_LOOKUP[code] = i;
}
// Support standard base64 variants as well
DECODE_LOOKUP['+'.charCodeAt(0)] = 62;
DECODE_LOOKUP['/'.charCodeAt(0)] = 63;

/**
 * Returns cryptographically secure random bytes of length n.
 */
export function randomBytes(n: number): Uint8Array {
  if (n < 0 || !Number.isInteger(n)) {
    throw new RangeError(`Byte length must be a non-negative integer, got ${n}`);
  }
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/**
 * Converts a Uint8Array into a standard unpadded base64url string (RFC 4648 §5).
 * Replaces '+' with '-' and '/' with '_', with no '=' padding.
 */
export function toBase64Url(bytes: Uint8Array): string {
  const len = bytes.length;
  if (len === 0) {
    return '';
  }

  let result = '';
  let i = 0;

  for (; i + 2 < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    if (b0 === undefined || b1 === undefined || b2 === undefined) break;

    const char0 = BASE64URL_CHARS[b0 >> 2] ?? '';
    const char1 = BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] ?? '';
    const char2 = BASE64URL_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] ?? '';
    const char3 = BASE64URL_CHARS[b2 & 0x3f] ?? '';

    result += char0 + char1 + char2 + char3;
  }

  const remainder = len - i;
  if (remainder === 1) {
    const b0 = bytes[i];
    if (b0 !== undefined) {
      const char0 = BASE64URL_CHARS[b0 >> 2] ?? '';
      const char1 = BASE64URL_CHARS[(b0 & 0x03) << 4] ?? '';
      result += char0 + char1;
    }
  } else if (remainder === 2) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    if (b0 !== undefined && b1 !== undefined) {
      const char0 = BASE64URL_CHARS[b0 >> 2] ?? '';
      const char1 = BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] ?? '';
      const char2 = BASE64URL_CHARS[(b1 & 0x0f) << 2] ?? '';
      result += char0 + char1 + char2;
    }
  }

  return result;
}

/**
 * Decodes a base64url string into a Uint8Array.
 * Handles both unpadded and padded base64url strings.
 */
export function fromBase64Url(s: string): Uint8Array {
  let len = s.length;
  // Ignore any trailing '=' padding
  while (len > 0 && s.charCodeAt(len - 1) === 61) {
    len--;
  }

  if (len === 0) {
    return new Uint8Array(0);
  }

  const remainder = len % 4;
  if (remainder === 1) {
    throw new Error('Invalid base64url string length');
  }

  const byteLength = Math.floor((len * 3) / 4);
  const out = new Uint8Array(byteLength);

  let inIdx = 0;
  let outIdx = 0;

  while (inIdx < len) {
    const c0 = s.charCodeAt(inIdx++);
    const c1 = s.charCodeAt(inIdx++);
    const c2 = inIdx < len ? s.charCodeAt(inIdx++) : -1;
    const c3 = inIdx < len ? s.charCodeAt(inIdx++) : -1;

    const v0 = c0 < 128 ? (DECODE_LOOKUP[c0] ?? -1) : -1;
    const v1 = c1 < 128 ? (DECODE_LOOKUP[c1] ?? -1) : -1;
    const v2 = c2 >= 0 ? (c2 < 128 ? (DECODE_LOOKUP[c2] ?? -1) : -1) : 0;
    const v3 = c3 >= 0 ? (c3 < 128 ? (DECODE_LOOKUP[c3] ?? -1) : -1) : 0;

    if (v0 === -1 || v1 === -1 || (c2 >= 0 && v2 === -1) || (c3 >= 0 && v3 === -1)) {
      throw new Error('Invalid character in base64url string');
    }

    out[outIdx++] = (v0 << 2) | (v1 >> 4);
    if (c2 >= 0 && outIdx < byteLength) {
      out[outIdx++] = ((v1 & 0x0f) << 4) | (v2 >> 2);
    }
    if (c3 >= 0 && outIdx < byteLength) {
      out[outIdx++] = ((v2 & 0x03) << 6) | v3;
    }
  }

  return out;
}
