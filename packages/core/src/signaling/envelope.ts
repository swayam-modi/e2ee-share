/**
 * Signaling envelope sequence tracking and HMAC signing/verification.
 * Implements Section 5.4 of the specification.
 */

import {
  type Envelope,
  type SignalType,
  ProtocolError,
  ErrorCodes,
} from '@e2ee-share/protocol';
import { signEnvelope, verifyEnvelope } from '../crypto/mac.js';

export interface EnvelopeManager {
  /**
   * Sign and return a new envelope, incrementing the local seq.
   * fromRole: the local role ('sender' | 'receiver')
   */
  sign(
    authKey: CryptoKey,
    roomId: string,
    fromRole: string,
    type: SignalType,
    body: string
  ): Promise<Envelope>;

  /**
   * Verify an incoming envelope from the peer.
   * Returns the envelope if valid; throws ProtocolError(AUTH_FAILED) if:
   * - MAC is wrong
   * - seq is not strictly greater than the last seen from this role
   */
  verify(
    authKey: CryptoKey,
    roomId: string,
    fromRole: string,
    envelope: Envelope
  ): Promise<Envelope>;
}

class DefaultEnvelopeManager implements EnvelopeManager {
  private localSeq = 0;
  private lastPeerSeq = -1;

  async sign(
    authKey: CryptoKey,
    roomId: string,
    fromRole: string,
    type: SignalType,
    body: string
  ): Promise<Envelope> {
    const seq = this.localSeq;
    this.localSeq += 1;

    const mac = await signEnvelope(authKey, {
      roomId,
      fromRole,
      seq,
      type,
      body,
    });

    return {
      seq,
      type,
      body,
      mac,
    };
  }

  async verify(
    authKey: CryptoKey,
    roomId: string,
    fromRole: string,
    envelope: Envelope
  ): Promise<Envelope> {
    // 1. Verify constant-time HMAC
    const isValid = await verifyEnvelope(
      authKey,
      {
        roomId,
        fromRole,
        seq: envelope.seq,
        type: envelope.type,
        body: envelope.body,
      },
      envelope.mac
    );

    if (!isValid) {
      throw new ProtocolError(
        ErrorCodes.AUTH_FAILED,
        'Envelope MAC verification failed'
      );
    }

    // 2. Monotonic sequence number check
    if (envelope.seq <= this.lastPeerSeq) {
      throw new ProtocolError(
        ErrorCodes.AUTH_FAILED,
        `Sequence number ${envelope.seq} must be strictly greater than last seen ${this.lastPeerSeq}`
      );
    }

    this.lastPeerSeq = envelope.seq;
    return envelope;
  }
}

export function createEnvelopeManager(): EnvelopeManager {
  return new DefaultEnvelopeManager();
}
