import { describe, it, expect } from 'vitest';
import {
  randomBytes,
  toBase64Url,
  fromBase64Url,
  deriveAuthKey,
  signEnvelope,
  verifyEnvelope,
  generateReceiverKeyPair,
  exportSpki,
  importSpki,
  wrapSessionKey,
  unwrapSessionKey,
  encryptFrame,
  decryptFrame,
  fingerprint,
  encodeHeader,
  decodeHeader,
  buildNonce,
  buildAAD,
  toBufferSource,
  MAX_ALLOWED_FRAME_SIZE,
  FRAME_VERSION,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DATA,
  FRAME_FLAG_FINAL,
  CHUNK_PLAINTEXT_SIZE,
  HEADER_SIZE,
  TAG_SIZE,
  type FrameHeader,
} from '../index.js';

describe('Crypto Module', () => {
  describe('random.ts', () => {
    it('generates randomBytes of the requested length', () => {
      const b0 = randomBytes(0);
      expect(b0.length).toBe(0);

      const b16 = randomBytes(16);
      expect(b16.length).toBe(16);

      const b32 = randomBytes(32);
      expect(b32.length).toBe(32);

      // Verify two random 32-byte arrays are distinct
      const b32b = randomBytes(32);
      expect(toBase64Url(b32)).not.toBe(toBase64Url(b32b));
    });

    it('throws RangeError for invalid byte lengths', () => {
      expect(() => randomBytes(-1)).toThrow(RangeError);
      expect(() => randomBytes(3.5)).toThrow(RangeError);
    });

    it('encodes and decodes base64url without padding or standard base64 characters', () => {
      const sizes = [0, 1, 2, 3, 4, 15, 32, 64, 100, 1024];
      for (const size of sizes) {
        const original = randomBytes(size);
        const encoded = toBase64Url(original);

        // Must not contain padding or standard base64 chars (+, /)
        expect(encoded).not.toContain('=');
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');

        const decoded = fromBase64Url(encoded);
        expect(decoded).toEqual(original);
      }
    });

    it('handles base64url decoding with padding and standard base64 characters', () => {
      // Standard base64 with + and / and = padding
      const standard = 'AP+/AA==';
      const decoded = fromBase64Url(standard);
      expect(decoded.length).toBe(4);
      expect(decoded[0]).toBe(0x00);
      expect(decoded[1]).toBe(0xff);
      expect(decoded[2]).toBe(0xbf);
      expect(decoded[3]).toBe(0x00);
    });

    it('throws on invalid base64url strings', () => {
      // Invalid length (mod 4 === 1)
      expect(() => fromBase64Url('A')).toThrow('Invalid base64url string length');
      expect(() => fromBase64Url('AAAAA')).toThrow('Invalid base64url string length');

      // Invalid characters
      expect(() => fromBase64Url('AA!@')).toThrow('Invalid character in base64url string');
      expect(() => fromBase64Url('AA?*')).toThrow('Invalid character in base64url string');
    });
  });

  describe('kdf.ts', () => {
    it('derives an HMAC CryptoKey from secret and roomId', async () => {
      const secret = randomBytes(32);
      const roomId = 'room-123456';

      const key = await deriveAuthKey(secret, roomId);
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('HMAC');
      expect(key.extractable).toBe(false);
      expect(key.usages).toEqual(['sign', 'verify']);
    });

    it('throws if secret is not 32 bytes', async () => {
      const invalidSecret = randomBytes(16);
      await expect(deriveAuthKey(invalidSecret, 'room-1')).rejects.toThrow('Invalid secret length');
    });

    it('produces identical signing behavior for identical secret and roomId', async () => {
      const secret = randomBytes(32);
      const roomId = 'room-abc';

      const key1 = await deriveAuthKey(secret, roomId);
      const key2 = await deriveAuthKey(secret, roomId);

      const fields = {
        roomId,
        fromRole: 'sender',
        seq: 0,
        type: 'sdp-offer',
        body: 'v=0...',
      };

      const mac1 = await signEnvelope(key1, fields);
      const mac2 = await signEnvelope(key2, fields);
      expect(mac1).toBe(mac2);
    });

    it('produces different MACs for different roomIds', async () => {
      const secret = randomBytes(32);
      const key1 = await deriveAuthKey(secret, 'room-1');
      const key2 = await deriveAuthKey(secret, 'room-2');

      const fields = {
        roomId: 'room-1',
        fromRole: 'sender',
        seq: 0,
        type: 'pubkey',
        body: 'dummy-body',
      };

      const mac1 = await signEnvelope(key1, fields);
      const mac2 = await signEnvelope(key2, fields);
      expect(mac1).not.toBe(mac2);
    });

    it('produces different MACs for different secrets', async () => {
      const secret1 = randomBytes(32);
      const secret2 = randomBytes(32);
      const roomId = 'room-common';

      const key1 = await deriveAuthKey(secret1, roomId);
      const key2 = await deriveAuthKey(secret2, roomId);

      const fields = {
        roomId,
        fromRole: 'sender',
        seq: 0,
        type: 'pubkey',
        body: 'dummy-body',
      };

      const mac1 = await signEnvelope(key1, fields);
      const mac2 = await signEnvelope(key2, fields);
      expect(mac1).not.toBe(mac2);
    });
  });

  describe('mac.ts', () => {
    it('signs and verifies envelope round-trip successfully', async () => {
      const secret = randomBytes(32);
      const roomId = 'room-test-mac';
      const authKey = await deriveAuthKey(secret, roomId);

      const fields = {
        roomId,
        fromRole: 'sender',
        seq: 42,
        type: 'sdp-offer',
        body: '{"type":"offer","sdp":"..."}',
      };

      const mac = await signEnvelope(authKey, fields);
      expect(typeof mac).toBe('string');
      expect(mac.length).toBeGreaterThan(0);

      const isValid = await verifyEnvelope(authKey, fields, mac);
      expect(isValid).toBe(true);
    });

    it('fails verification if any field is modified', async () => {
      const secret = randomBytes(32);
      const roomId = 'room-test-tamper';
      const authKey = await deriveAuthKey(secret, roomId);

      const fields = {
        roomId,
        fromRole: 'receiver',
        seq: 1,
        type: 'pubkey',
        body: 'original-body',
      };

      const mac = await signEnvelope(authKey, fields);

      // Modified roomId
      expect(await verifyEnvelope(authKey, { ...fields, roomId: 'room-wrong' }, mac)).toBe(false);

      // Modified fromRole
      expect(await verifyEnvelope(authKey, { ...fields, fromRole: 'sender' }, mac)).toBe(false);

      // Modified seq
      expect(await verifyEnvelope(authKey, { ...fields, seq: 2 }, mac)).toBe(false);

      // Modified type
      expect(await verifyEnvelope(authKey, { ...fields, type: 'wrapped-key' }, mac)).toBe(false);

      // Modified body
      expect(await verifyEnvelope(authKey, { ...fields, body: 'tampered-body' }, mac)).toBe(false);
    });

    it('fails verification if MAC is tampered or malformed', async () => {
      const secret = randomBytes(32);
      const roomId = 'room-test-bad-mac';
      const authKey = await deriveAuthKey(secret, roomId);

      const fields = {
        roomId,
        fromRole: 'sender',
        seq: 0,
        type: 'key-ack',
        body: '',
      };

      const mac = await signEnvelope(authKey, fields);

      // Tamper one character in MAC
      const tamperedMac = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
      expect(await verifyEnvelope(authKey, fields, tamperedMac)).toBe(false);

      // Malformed base64url MAC
      expect(await verifyEnvelope(authKey, fields, 'not-valid-base64!@#')).toBe(false);
      expect(await verifyEnvelope(authKey, fields, '')).toBe(false);
    });
  });

  describe('rsa.ts', () => {
    it('generates an RSA-OAEP 3072-bit keypair and exports/imports SPKI', async () => {
      const keyPair = await generateReceiverKeyPair();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();

      const spkiBytes = await exportSpki(keyPair.publicKey);
      expect(spkiBytes.byteLength).toBeGreaterThan(0);

      const importedPub = await importSpki(spkiBytes);
      expect(importedPub.type).toBe('public');
      expect(importedPub.algorithm.name).toBe('RSA-OAEP');
    });

    it('wraps and unwraps session key and verifies AES-GCM encryption', async () => {
      const keyPair = await generateReceiverKeyPair();
      const rawSessionKey = randomBytes(32);

      // Sender wraps with receiver public key
      const wrapped = await wrapSessionKey(rawSessionKey, keyPair.publicKey);
      expect(wrapped.byteLength).toBe(3072 / 8); // 384 bytes for 3072-bit RSA

      // Receiver unwraps with private key
      const unwrappedKey = await unwrapSessionKey(wrapped, keyPair.privateKey);
      expect(unwrappedKey.type).toBe('secret');
      expect(unwrappedKey.algorithm.name).toBe('AES-GCM');
      expect(unwrappedKey.extractable).toBe(false);

      // To verify the unwrapped key matches rawSessionKey,
      // encrypt with unwrappedKey and decrypt with rawSessionKey imported as AES-GCM
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('Hello, E2EE P2P World!');

      const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toBufferSource(iv) },
        unwrappedKey,
        toBufferSource(plaintext)
      );

      const originalKey = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawSessionKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toBufferSource(iv) },
        originalKey,
        ciphertext
      );

      expect(new Uint8Array(decrypted)).toEqual(plaintext);
    });

    it('throws when unwrapSessionKey is called with the wrong private key', async () => {
      const receiverA = await generateReceiverKeyPair();
      const receiverB = await generateReceiverKeyPair();
      const rawSessionKey = randomBytes(32);

      // Wrapped for receiverA
      const wrapped = await wrapSessionKey(rawSessionKey, receiverA.publicKey);

      // Attempt to unwrap with receiverB's private key
      await expect(unwrapSessionKey(wrapped, receiverB.privateKey)).rejects.toThrow();
    });

    it('throws when unwrapSessionKey receives corrupted ciphertext', async () => {
      const keyPair = await generateReceiverKeyPair();
      const rawSessionKey = randomBytes(32);
      const wrapped = await wrapSessionKey(rawSessionKey, keyPair.publicKey);

      // Corrupt a byte in ciphertext
      wrapped[10] = (wrapped[10] ?? 0) ^ 0xff;

      await expect(unwrapSessionKey(wrapped, keyPair.privateKey)).rejects.toThrow();
    });

    it('throws if wrapSessionKey is called with a key not equal to 32 bytes', async () => {
      const keyPair = await generateReceiverKeyPair();
      const shortKey = randomBytes(16);
      await expect(wrapSessionKey(shortKey, keyPair.publicKey)).rejects.toThrow(
        'Invalid session key length'
      );
    });
  });

  describe('aead.ts and _frame-types.ts', () => {
    it('encodes and decodes FrameHeader correctly', () => {
      const originalHeader: FrameHeader = {
        version: FRAME_VERSION,
        type: FRAME_TYPE_DATA,
        flags: FRAME_FLAG_FINAL,
        fileIndex: 7,
        seq: 12345,
      };

      const encoded = encodeHeader(originalHeader);
      expect(encoded.byteLength).toBe(HEADER_SIZE);

      const decoded = decodeHeader(encoded);
      expect(decoded).toEqual(originalHeader);
    });

    it('builds deterministic 12-byte nonce matching specification', () => {
      const direction = 0x01; // sender -> receiver
      const fileIndex = 0x00000005;
      const seq = 0x0000000a;

      const nonce = buildNonce(direction, fileIndex, seq);
      expect(nonce.byteLength).toBe(12);

      // [direction u8][0x00 0x00 0x00][fileIndex u32 BE][seq u32 BE]
      expect(nonce[0]).toBe(0x01);
      expect(nonce[1]).toBe(0x00);
      expect(nonce[2]).toBe(0x00);
      expect(nonce[3]).toBe(0x00);

      const view = new DataView(nonce.buffer, nonce.byteOffset, 12);
      expect(view.getUint32(4, false)).toBe(5);
      expect(view.getUint32(8, false)).toBe(10);
    });

    it('builds 12-byte AAD from header and direction', () => {
      const header: FrameHeader = {
        version: FRAME_VERSION,
        type: FRAME_TYPE_CONTROL,
        flags: 0,
        fileIndex: 0xffffffff,
        seq: 0,
      };

      const aad = buildAAD(encodeHeader(header), 0x02);
      expect(aad.byteLength).toBe(12);
      expect(aad.subarray(0, 11)).toEqual(encodeHeader(header));
      expect(aad[11]).toBe(0x02);
    });

    it('round-trips encryptFrame and decryptFrame for sizes: 0, 1, 15360, 15361 bytes', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const testSizes = [0, 1, CHUNK_PLAINTEXT_SIZE, CHUNK_PLAINTEXT_SIZE + 1];

      for (let i = 0; i < testSizes.length; i++) {
        const size = testSizes[i]!;
        const plaintext = randomBytes(size);
        const header: FrameHeader = {
          version: FRAME_VERSION,
          type: FRAME_TYPE_DATA,
          flags: i === testSizes.length - 1 ? FRAME_FLAG_FINAL : 0,
          fileIndex: 0,
          seq: i,
        };

        const direction = 0x01;
        const frame = await encryptFrame(key, direction, header, plaintext);

        // Frame structure: 11-byte header + ciphertext + 16-byte tag
        expect(frame.byteLength).toBe(HEADER_SIZE + size + TAG_SIZE);

        const decrypted = await decryptFrame(key, direction, frame);
        expect(decrypted.header).toEqual(header);
        expect(decrypted.plaintext).toEqual(plaintext);
      }
    });

    it('fails decryption if any bit in ciphertext is flipped (tamper test)', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const header: FrameHeader = {
        version: FRAME_VERSION,
        type: FRAME_TYPE_DATA,
        flags: 0,
        fileIndex: 1,
        seq: 10,
      };

      const plaintext = new TextEncoder().encode('Confidential payload');
      const frame = await encryptFrame(key, 0x01, header, plaintext);

      // Flip bit in the ciphertext portion (after 11-byte header)
      const tamperedFrame = new Uint8Array(frame);
      const ciphertextOffset = HEADER_SIZE + 2;
      tamperedFrame[ciphertextOffset] = (tamperedFrame[ciphertextOffset] ?? 0) ^ 0x01;

      await expect(decryptFrame(key, 0x01, tamperedFrame)).rejects.toThrow();
    });

    it('fails decryption if any bit in header/AAD is flipped (tamper test)', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const header: FrameHeader = {
        version: FRAME_VERSION,
        type: FRAME_TYPE_DATA,
        flags: 0,
        fileIndex: 1,
        seq: 10,
      };

      const plaintext = new TextEncoder().encode('Confidential payload');
      const frame = await encryptFrame(key, 0x01, header, plaintext);

      // Flip bit in header (e.g. seq or fileIndex or flags)
      const tamperedHeaderFrame = new Uint8Array(frame);
      tamperedHeaderFrame[2] = (tamperedHeaderFrame[2] ?? 0) ^ 0x01; // flip flags bit

      await expect(decryptFrame(key, 0x01, tamperedHeaderFrame)).rejects.toThrow();
    });

    it('fails decryption if wrong direction is used', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const header: FrameHeader = {
        version: FRAME_VERSION,
        type: FRAME_TYPE_CONTROL,
        flags: 0,
        fileIndex: 0xffffffff,
        seq: 0,
      };

      const plaintext = new TextEncoder().encode('{"t":"hello","v":1,"role":"sender"}');
      const frame = await encryptFrame(key, 0x01, header, plaintext);

      // Try decrypting with direction = 0x02
      await expect(decryptFrame(key, 0x02, frame)).rejects.toThrow();
    });

    it('fails decryption if wrong seq is decoded', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const header: FrameHeader = {
        version: FRAME_VERSION,
        type: FRAME_TYPE_DATA,
        flags: 0,
        fileIndex: 0,
        seq: 5,
      };

      const plaintext = randomBytes(100);
      const frame = await encryptFrame(key, 0x01, header, plaintext);

      // Tamper seq in frame header to 6
      const tamperedFrame = new Uint8Array(frame);
      const view = new DataView(tamperedFrame.buffer, tamperedFrame.byteOffset, tamperedFrame.byteLength);
      view.setUint32(7, 6, false);

      await expect(decryptFrame(key, 0x01, tamperedFrame)).rejects.toThrow();
    });

    it('rejects frames that are too short or exceed maximum size', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      // Under minimum size (27 bytes: 11 header + 16 tag)
      const shortFrame = new Uint8Array(26);
      await expect(decryptFrame(key, 0x01, shortFrame)).rejects.toThrow('Frame too short');

      // Oversized frame
      const oversizedFrame = new Uint8Array(MAX_ALLOWED_FRAME_SIZE + 1);
      await expect(decryptFrame(key, 0x01, oversizedFrame)).rejects.toThrow('Frame exceeds maximum size');
    });

    it('rejects unsupported frame version or unknown frame type', async () => {
      const rawKey = randomBytes(32);
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toBufferSource(rawKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const frame = new Uint8Array(30);

      // Version 2 instead of 1
      frame[0] = 0x02;
      frame[1] = FRAME_TYPE_CONTROL;
      await expect(decryptFrame(key, 0x01, frame)).rejects.toThrow('Unsupported frame version');

      // Unknown type 0x05
      frame[0] = FRAME_VERSION;
      frame[1] = 0x05;
      await expect(decryptFrame(key, 0x01, frame)).rejects.toThrow('Unknown frame type');
    });

    it('ensures nonce uniqueness across large set of (direction, fileIndex, seq) tuples', () => {
      const directions = [1, 2];
      const fileIndices = [0, 1, 2, 10, 0x7fffffff, 0xffffffff];
      const seqs = [0, 1, 2, 10, 100, 1000, 0x7fffffff, 0xffffffff];

      const seenNonces = new Set<string>();
      let totalCount = 0;

      for (const dir of directions) {
        for (const fi of fileIndices) {
          for (const s of seqs) {
            const nonce = buildNonce(dir, fi, s);
            const key = toBase64Url(nonce);
            expect(seenNonces.has(key)).toBe(false);
            seenNonces.add(key);
            totalCount++;
          }
        }
      }

      expect(seenNonces.size).toBe(totalCount);
    });
  });

  describe('fingerprint.ts', () => {
    it('generates a 19-char formatted fingerprint matching regex', async () => {
      const dummySpki = randomBytes(400);
      const fp = await fingerprint(dummySpki);

      expect(fp).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    });

    it('produces identical fingerprints for the same SPKI', async () => {
      const spki = randomBytes(400);
      const fp1 = await fingerprint(spki);
      const fp2 = await fingerprint(spki);

      expect(fp1).toBe(fp2);
    });

    it('produces different fingerprints for different SPKIs', async () => {
      const spki1 = randomBytes(400);
      const spki2 = randomBytes(400);

      const fp1 = await fingerprint(spki1);
      const fp2 = await fingerprint(spki2);

      expect(fp1).not.toBe(fp2);
    });
  });
});
