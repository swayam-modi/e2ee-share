import { z } from 'zod';
import { ErrorCode, ErrorCodes } from './errors';

export const signalTypeSchema = z.enum([
  'pubkey',
  'wrapped-key',
  'key-ack',
  'sdp-offer',
  'sdp-answer',
  'ice',
]);
export type SignalType = z.infer<typeof signalTypeSchema>;

export const envelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: signalTypeSchema,
  body: z.string(),
  mac: z.string(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

export const peerRoleSchema = z.enum(['sender', 'receiver']);
export type PeerRole = z.infer<typeof peerRoleSchema>;

export const errorCodeSchema = z.enum([
  ErrorCodes.ROOM_NOT_FOUND,
  ErrorCodes.ROOM_EXPIRED,
  ErrorCodes.ROOM_LOCKED,
  ErrorCodes.INVALID_TOKEN,
  ErrorCodes.INVALID_MESSAGE,
  ErrorCodes.RATE_LIMITED,
  ErrorCodes.PEER_LEFT,
  ErrorCodes.AUTH_FAILED,
  ErrorCodes.CRYPTO_FAILED,
  ErrorCodes.ICE_FAILED,
  ErrorCodes.CHANNEL_CLOSED,
  ErrorCodes.TRANSFER_CANCELLED,
  ErrorCodes.INTEGRITY_FAILED,
]);

// Client -> Server schemas
export const clientJoinMessageSchema = z.object({
  kind: z.literal('join'),
  roomId: z.string().min(1),
  role: peerRoleSchema,
  senderToken: z.string().optional(),
});
export type ClientJoinMessage = z.infer<typeof clientJoinMessageSchema>;

export const clientSignalMessageSchema = z.object({
  kind: z.literal('signal'),
  envelope: envelopeSchema,
});
export type ClientSignalMessage = z.infer<typeof clientSignalMessageSchema>;

export const clientByeMessageSchema = z.object({
  kind: z.literal('bye'),
});
export type ClientByeMessage = z.infer<typeof clientByeMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('kind', [
  clientJoinMessageSchema,
  clientSignalMessageSchema,
  clientByeMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Server -> Client schemas
export const serverJoinedMessageSchema = z.object({
  kind: z.literal('joined'),
  role: peerRoleSchema,
  peerPresent: z.boolean(),
});
export type ServerJoinedMessage = z.infer<typeof serverJoinedMessageSchema>;

export const serverPeerJoinedMessageSchema = z.object({
  kind: z.literal('peer-joined'),
});
export type ServerPeerJoinedMessage = z.infer<typeof serverPeerJoinedMessageSchema>;

export const serverPeerLeftMessageSchema = z.object({
  kind: z.literal('peer-left'),
});
export type ServerPeerLeftMessage = z.infer<typeof serverPeerLeftMessageSchema>;

export const serverSignalMessageSchema = z.object({
  kind: z.literal('signal'),
  envelope: envelopeSchema,
});
export type ServerSignalMessage = z.infer<typeof serverSignalMessageSchema>;

export const serverErrorMessageSchema = z.object({
  kind: z.literal('error'),
  code: errorCodeSchema,
  message: z.string(),
});
export type ServerErrorMessage = {
  kind: 'error';
  code: ErrorCode;
  message: string;
};

export const serverMessageSchema = z.discriminatedUnion('kind', [
  serverJoinedMessageSchema,
  serverPeerJoinedMessageSchema,
  serverPeerLeftMessageSchema,
  serverSignalMessageSchema,
  serverErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
