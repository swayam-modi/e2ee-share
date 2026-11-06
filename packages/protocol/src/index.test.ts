import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  CHUNK_PLAINTEXT_SIZE,
  MAX_FRAME_SIZE,
  FRAME_HEADER_SIZE,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DATA,
  FRAME_FLAG_FINAL,
  DIRECTION_SENDER,
  DIRECTION_RECEIVER,
  ErrorCodes,
  ProtocolError,
  clientMessageSchema,
  serverMessageSchema,
  controlSchema,
  encodeHeader,
  decodeHeader,
  buildNonce,
  buildAAD,
  FrameHeader,
} from './index.js';

describe('protocol package', () => {
  describe('constants', () => {
    it('should have expected constant values', () => {
      expect(PROTOCOL_VERSION).toBe(0x01);
      expect(CHUNK_PLAINTEXT_SIZE).toBe(15360);
      expect(MAX_FRAME_SIZE).toBe(15360 + 11 + 16);
      expect(FRAME_HEADER_SIZE).toBe(11);
    });
  });

  describe('errors', () => {
    it('should create ProtocolError with expected code and message', () => {
      const err = new ProtocolError(ErrorCodes.ROOM_NOT_FOUND, 'Room was not found');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ProtocolError);
      expect(err.name).toBe('ProtocolError');
      expect(err.code).toBe('ROOM_NOT_FOUND');
      expect(err.message).toBe('Room was not found');
    });
  });

  describe('signaling schemas', () => {
    it('should validate client join message', () => {
      const validJoin = {
        kind: 'join',
        roomId: 'test-room-123',
        role: 'sender',
        senderToken: 'token123',
      };
      const parsed = clientMessageSchema.safeParse(validJoin);
      expect(parsed.success).toBe(true);
    });

    it('should validate client signal message', () => {
      const validSignal = {
        kind: 'signal',
        envelope: {
          seq: 0,
          type: 'pubkey',
          body: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A',
          mac: 'hmac-signature-base64',
        },
      };
      const parsed = clientMessageSchema.safeParse(validSignal);
      expect(parsed.success).toBe(true);
    });

    it('should validate client bye message', () => {
      const validBye = { kind: 'bye' };
      const parsed = clientMessageSchema.safeParse(validBye);
      expect(parsed.success).toBe(true);
    });

    it('should reject invalid client messages', () => {
      const invalid = { kind: 'unknown' };
      const parsed = clientMessageSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('should validate server messages', () => {
      expect(
        serverMessageSchema.safeParse({
          kind: 'joined',
          role: 'receiver',
          peerPresent: true,
        }).success
      ).toBe(true);

      expect(serverMessageSchema.safeParse({ kind: 'peer-joined' }).success).toBe(true);
      expect(serverMessageSchema.safeParse({ kind: 'peer-left' }).success).toBe(true);

      expect(
        serverMessageSchema.safeParse({
          kind: 'signal',
          envelope: {
            seq: 1,
            type: 'ice',
            body: '{"candidate":""}',
            mac: 'mac123',
          },
        }).success
      ).toBe(true);

      expect(
        serverMessageSchema.safeParse({
          kind: 'error',
          code: ErrorCodes.ROOM_LOCKED,
          message: 'Room is already full',
        }).success
      ).toBe(true);
    });
  });

  describe('control schemas', () => {
    it('should validate all control message types', () => {
      expect(controlSchema.safeParse({ t: 'hello', v: 1, role: 'sender' }).success).toBe(true);
      expect(
        controlSchema.safeParse({
          t: 'file-offer',
          fileIndex: 0,
          name: 'photo.jpg',
          size: 1024,
          mime: 'image/jpeg',
          lastModified: 1700000000,
          chunkSize: 15360,
          chunkCount: 1,
        }).success
      ).toBe(true);
      expect(controlSchema.safeParse({ t: 'file-accept', fileIndex: 0 }).success).toBe(true);
      expect(
        controlSchema.safeParse({
          t: 'file-reject',
          fileIndex: 0,
          reason: 'declined',
        }).success
      ).toBe(true);
      expect(
        controlSchema.safeParse({
          t: 'file-complete',
          fileIndex: 0,
          bytesReceived: 1024,
        }).success
      ).toBe(true);
      expect(
        controlSchema.safeParse({
          t: 'cancel',
          fileIndex: 0,
          reason: 'user cancelled',
        }).success
      ).toBe(true);
      expect(controlSchema.safeParse({ t: 'bye' }).success).toBe(true);
    });

    it('should reject invalid control messages', () => {
      expect(controlSchema.safeParse({ t: 'hello', v: 2, role: 'sender' }).success).toBe(false);
      expect(
        controlSchema.safeParse({
          t: 'file-reject',
          fileIndex: 0,
          reason: 'random-reason',
        }).success
      ).toBe(false);
    });
  });

  describe('frame header and nonce helpers', () => {
    it('should encode and decode frame header round-trip', () => {
      const header: FrameHeader = {
        version: PROTOCOL_VERSION,
        type: FRAME_TYPE_DATA,
        flags: FRAME_FLAG_FINAL,
        fileIndex: 42,
        seq: 1337,
      };

      const encoded = encodeHeader(header);
      expect(encoded.byteLength).toBe(FRAME_HEADER_SIZE);

      const decoded = decodeHeader(encoded);
      expect(decoded).toEqual(header);

      const controlHeader: FrameHeader = {
        version: PROTOCOL_VERSION,
        type: FRAME_TYPE_CONTROL,
        flags: 0,
        fileIndex: 0xffffffff,
        seq: 0,
      };
      expect(decodeHeader(encodeHeader(controlHeader))).toEqual(controlHeader);
    });

    it('should reject header with unsupported version or invalid type', () => {
      const badVersion = new Uint8Array([0x02, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(() => decodeHeader(badVersion)).toThrow(ProtocolError);

      const badType = new Uint8Array([0x01, 0x03, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(() => decodeHeader(badType)).toThrow(ProtocolError);

      const tooShort = new Uint8Array([0x01, 0x01]);
      expect(() => decodeHeader(tooShort)).toThrow(ProtocolError);
    });

    it('should build nonce according to spec', () => {
      const nonce = buildNonce(DIRECTION_SENDER, 0x01020304, 0x05060708);
      expect(nonce.byteLength).toBe(12);
      expect(nonce[0]).toBe(DIRECTION_SENDER);
      expect(nonce[1]).toBe(0x00);
      expect(nonce[2]).toBe(0x00);
      expect(nonce[3]).toBe(0x00);

      // fileIndex big endian
      expect(nonce[4]).toBe(0x01);
      expect(nonce[5]).toBe(0x02);
      expect(nonce[6]).toBe(0x03);
      expect(nonce[7]).toBe(0x04);

      // seq big endian
      expect(nonce[8]).toBe(0x05);
      expect(nonce[9]).toBe(0x06);
      expect(nonce[10]).toBe(0x07);
      expect(nonce[11]).toBe(0x08);
    });

    it('should build AAD from header and direction', () => {
      const header = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const aad = buildAAD(header, DIRECTION_RECEIVER);
      expect(aad.byteLength).toBe(12);
      expect(Array.from(aad.slice(0, 11))).toEqual(Array.from(header));
      expect(aad[11]).toBe(DIRECTION_RECEIVER);
    });
  });
});
