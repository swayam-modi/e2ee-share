/**
 * Session state machine states, events, and progress types.
 * Implements Section 8.8 of the specification.
 */

import type { ProtocolError } from '../../protocol/index';

export type SenderState =
  | 'idle'
  | 'creatingRoom'
  | 'waitingForReceiver'
  | 'awaitingApproval'
  | 'keyExchange'
  | 'rtcConnecting'
  | 'ready'
  | 'transferring'
  | 'done'
  | 'failed'
  | 'cancelled';

export type ReceiverState =
  | 'idle'
  | 'preparingKeys'
  | 'joining'
  | 'waitingForKey'
  | 'rtcConnecting'
  | 'ready'
  | 'receiving'
  | 'done'
  | 'failed';

export interface TransferProgress {
  fileIndex: number;
  bytesSent: number;
  bytesTotal: number;
  speed: number; // bytes per second
}

export interface SessionEvents<
  S extends SenderState | ReceiverState = SenderState | ReceiverState,
> {
  stateChange: (state: S) => void;
  fingerprint: (fp: string) => void; // shown in UI for both sides
  progress: (p: TransferProgress) => void;
  error: (err: ProtocolError) => void;
  done: () => void;
}
