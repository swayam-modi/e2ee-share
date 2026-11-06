import { z } from 'zod';

export const controlHelloSchema = z.object({
  t: z.literal('hello'),
  v: z.literal(1),
  role: z.enum(['sender', 'receiver']),
});
export type ControlHelloMessage = z.infer<typeof controlHelloSchema>;

export const controlFileOfferSchema = z.object({
  t: z.literal('file-offer'),
  fileIndex: z.number().int().nonnegative(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  mime: z.string(),
  lastModified: z.number(),
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().nonnegative(),
});
export type ControlFileOfferMessage = z.infer<typeof controlFileOfferSchema>;

export const controlFileAcceptSchema = z.object({
  t: z.literal('file-accept'),
  fileIndex: z.number().int().nonnegative(),
});
export type ControlFileAcceptMessage = z.infer<typeof controlFileAcceptSchema>;

export const controlFileRejectReasonSchema = z.enum(['declined', 'too-large', 'unsupported']);
export type ControlFileRejectReason = z.infer<typeof controlFileRejectReasonSchema>;

export const controlFileRejectSchema = z.object({
  t: z.literal('file-reject'),
  fileIndex: z.number().int().nonnegative(),
  reason: controlFileRejectReasonSchema,
});
export type ControlFileRejectMessage = z.infer<typeof controlFileRejectSchema>;

export const controlFileCompleteSchema = z.object({
  t: z.literal('file-complete'),
  fileIndex: z.number().int().nonnegative(),
  bytesReceived: z.number().int().nonnegative(),
});
export type ControlFileCompleteMessage = z.infer<typeof controlFileCompleteSchema>;

export const controlCancelSchema = z.object({
  t: z.literal('cancel'),
  fileIndex: z.number().int().nonnegative().optional(),
  reason: z.string(),
});
export type ControlCancelMessage = z.infer<typeof controlCancelSchema>;

export const controlByeSchema = z.object({
  t: z.literal('bye'),
});
export type ControlByeMessage = z.infer<typeof controlByeSchema>;

export const controlSchema = z.discriminatedUnion('t', [
  controlHelloSchema,
  controlFileOfferSchema,
  controlFileAcceptSchema,
  controlFileRejectSchema,
  controlFileCompleteSchema,
  controlCancelSchema,
  controlByeSchema,
]);

export type ControlMessage = z.infer<typeof controlSchema>;
export type Control = ControlMessage;
