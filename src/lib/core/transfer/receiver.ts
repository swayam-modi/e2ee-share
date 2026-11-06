/**
 * FileReceiver — processes incoming DataChannel messages, decrypts DATA frames,
 * verifies integrity, and writes plaintext to FileSink instances.
 *
 * Implements Sections 5.7, 5.9 and 8.5 of the specification.
 */
import {
  DIRECTION_RECEIVER,
  DIRECTION_SENDER,
  ErrorCodes,
  FRAME_FLAG_FINAL,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DATA,
  ProtocolError,
} from '../../protocol/index';
import type { Channel } from '../rtc/channel';
import { decryptFrame } from '../crypto/aead';
import { sanitizeFilename } from './sanitize';
import { sendControl } from './control';
import type { FileSink } from './sinks/sink';
import type { TransferProgress } from '../session/types';

export interface FileOfferInfo {
  fileIndex: number;
  /** Sanitized filename (Section 8.6). */
  name: string;
  size: number;
  mime: string;
  chunkCount: number;
}

export interface ReceiverOptions {
  key: CryptoKey;
  channel: Channel;
  /**
   * Called when a file-offer arrives. Return a FileSink to accept,
   * or null to reject.
   */
  onFileOffer: (offer: FileOfferInfo) => Promise<FileSink | null>;
  onProgress: (p: TransferProgress) => void;
  onComplete: (fileIndex: number) => void;
  onError: (err: ProtocolError) => void;
  /**
   * Starting value for the outgoing control sequence counter.
   * Pass the session's current controlSeqOut so the transfer layer
   * continues the sequence after the session-level 'hello' message.
   * Defaults to 0 for tests that construct FileReceiver directly.
   */
  initialControlSeqOut?: number;
}

interface ActiveFile {
  sink: FileSink;
  expectedSeq: number;
  bytesReceived: number;
  bytesTotal: number;
  chunkCount: number;
}

/** Minimum time between progress callbacks (ms). ~10 updates/second. */
const PROGRESS_THROTTLE_MS = 100;

export class FileReceiver {
  private controlSeqIn = 0;
  private controlSeqOut: number;
  private activeFiles = new Map<number, ActiveFile>();
  private done = false;
  private lastProgressAt = new Map<number, number>();
  /** Bytes received at the time of the last throttled progress emit, for speed. */
  private lastProgressBytes = new Map<number, number>();

  constructor(private readonly opts: ReceiverOptions) {
    // Continue from where the session layer left off (after 'hello' at seq 0).
    this.controlSeqOut = opts.initialControlSeqOut ?? 0;
  }

  /**
   * Process incoming channel messages until `bye` is received or the channel
   * closes. Resolves when the transfer is complete.
   */
  async run(): Promise<void> {
    const { key, channel, onError } = this.opts;

    return new Promise<void>((resolve, reject) => {
      const offMessage = channel.on('message', (data: ArrayBuffer) => {
        void this.handleMessage(data, key, channel).then(
          (isDone) => {
            if (isDone) {
              offMessage();
              offClose();
              resolve();
            }
          },
          (err: unknown) => {
            offMessage();
            offClose();
            const protocolErr =
              err instanceof ProtocolError
                ? err
                : new ProtocolError(
                    ErrorCodes.CRYPTO_FAILED,
                    err instanceof Error ? err.message : String(err),
                  );
            void this.abortAllSinks().then(() => {
              onError(protocolErr);
              reject(protocolErr);
            });
          },
        );
      });

      const offClose = channel.on('close', () => {
        offMessage();
        offClose();
        if (!this.done) {
          const err = new ProtocolError(ErrorCodes.CHANNEL_CLOSED, 'Channel closed mid-transfer');
          void this.abortAllSinks().then(() => {
            onError(err);
            reject(err);
          });
        } else {
          resolve();
        }
      });
    });
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async handleMessage(
    data: ArrayBuffer,
    key: CryptoKey,
    channel: Channel,
  ): Promise<boolean> {
    const bytes = new Uint8Array(data);
    if (bytes.byteLength < 1) return false;

    const frameType = bytes[1];

    if (frameType === FRAME_TYPE_CONTROL) {
      return this.handleControlFrame(bytes, key, channel);
    } else if (frameType === FRAME_TYPE_DATA) {
      return this.handleDataFrame(bytes, key);
    }

    return false;
  }

  private async handleControlFrame(
    bytes: Uint8Array,
    key: CryptoKey,
    channel: Channel,
  ): Promise<boolean> {
    let header: Awaited<ReturnType<typeof decryptFrame>>['header'];
    let plaintext: Uint8Array;

    try {
      ({ header, plaintext } = await decryptFrame(key, DIRECTION_SENDER, bytes));
    } catch {
      throw new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Failed to decrypt control frame');
    }

    if (header.seq !== this.controlSeqIn) {
      throw new ProtocolError(
        ErrorCodes.INTEGRITY_FAILED,
        `Control seq mismatch: expected ${this.controlSeqIn}, got ${header.seq}`,
      );
    }
    this.controlSeqIn++;

    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    const msg = JSON.parse(text) as {
      t: string;
      fileIndex?: number;
      name?: string;
      size?: number;
      mime?: string;
      chunkCount?: number;
      reason?: string;
    };

    switch (msg.t) {
      case 'file-offer': {
        await this.handleFileOffer(msg as Parameters<typeof this.handleFileOffer>[0], key, channel);
        return false;
      }
      case 'cancel': {
        await this.abortAllSinks();
        this.done = true;
        this.opts.onError(
          new ProtocolError(ErrorCodes.CHANNEL_CLOSED, `Remote cancelled: ${msg.reason ?? ''}`),
        );
        return true;
      }
      case 'bye': {
        this.done = true;
        return true;
      }
      default:
        return false;
    }
  }

  private async handleFileOffer(
    msg: {
      t: string;
      fileIndex?: number;
      name?: string;
      size?: number;
      mime?: string;
      chunkCount?: number;
    },
    key: CryptoKey,
    channel: Channel,
  ): Promise<void> {
    const fileIndex = msg.fileIndex ?? 0;
    const rawName = msg.name ?? 'download';
    const size = msg.size ?? 0;
    const mime = msg.mime ?? 'application/octet-stream';
    const chunkCount = msg.chunkCount ?? 1;

    const sanitized = sanitizeFilename(rawName);

    const offer: FileOfferInfo = {
      fileIndex,
      name: sanitized,
      size,
      mime,
      chunkCount,
    };

    const sink = await this.opts.onFileOffer(offer);

    if (!sink) {
      // Reject
      await sendControl(channel, key, DIRECTION_RECEIVER, this.controlSeqOut++, {
        t: 'file-reject',
        fileIndex,
        reason: 'declined',
      });
      return;
    }

    // Accept
    this.activeFiles.set(fileIndex, {
      sink,
      expectedSeq: 0,
      bytesReceived: 0,
      bytesTotal: size,
      chunkCount,
    });

    await sendControl(channel, key, DIRECTION_RECEIVER, this.controlSeqOut++, {
      t: 'file-accept',
      fileIndex,
    });
  }

  private async handleDataFrame(bytes: Uint8Array, key: CryptoKey): Promise<boolean> {
    let header: Awaited<ReturnType<typeof decryptFrame>>['header'];
    let plaintext: Uint8Array;

    try {
      ({ header, plaintext } = await decryptFrame(key, DIRECTION_SENDER, bytes));
    } catch {
      throw new ProtocolError(ErrorCodes.CRYPTO_FAILED, 'Failed to decrypt data frame');
    }

    const { fileIndex, seq, flags } = header;
    const isFinal = (flags & FRAME_FLAG_FINAL) !== 0;

    const fileState = this.activeFiles.get(fileIndex);
    if (!fileState) {
      // Unexpected data for unknown or rejected file — ignore
      return false;
    }

    if (seq !== fileState.expectedSeq) {
      await fileState.sink.abort();
      this.activeFiles.delete(fileIndex);
      throw new ProtocolError(
        ErrorCodes.INTEGRITY_FAILED,
        `Data frame seq mismatch for file ${fileIndex}: expected ${fileState.expectedSeq}, got ${seq}`,
      );
    }

    fileState.expectedSeq++;
    fileState.bytesReceived += plaintext.byteLength;

    try {
      await fileState.sink.write(plaintext);
    } catch (err) {
      await fileState.sink.abort();
      this.activeFiles.delete(fileIndex);
      throw new ProtocolError(
        ErrorCodes.CRYPTO_FAILED,
        `Sink write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Emit progress (throttled)
    this.emitProgress(fileIndex, fileState);

    if (isFinal) {
      // Verify completeness
      const chunksReceived = fileState.expectedSeq; // seq was just incremented
      if (chunksReceived !== fileState.chunkCount) {
        await fileState.sink.abort();
        this.activeFiles.delete(fileIndex);
        throw new ProtocolError(
          ErrorCodes.INTEGRITY_FAILED,
          `File ${fileIndex}: expected ${fileState.chunkCount} chunks, got ${chunksReceived}`,
        );
      }

      await fileState.sink.close();
      this.activeFiles.delete(fileIndex);

      // Always emit 100% progress at completion, bypassing the throttle so small
      // files that transfer in under one throttle interval still reach isDone.
      this.opts.onProgress({
        fileIndex,
        bytesSent: fileState.bytesTotal,
        bytesTotal: fileState.bytesTotal,
        speed: 0,
      });

      this.opts.onComplete(fileIndex);
    }

    return false;
  }

  private emitProgress(fileIndex: number, fileState: ActiveFile): void {
    const now = Date.now();
    const last = this.lastProgressAt.get(fileIndex) ?? 0;
    const elapsed = now - last;
    if (elapsed >= PROGRESS_THROTTLE_MS) {
      const lastBytes = this.lastProgressBytes.get(fileIndex) ?? 0;
      const speed = elapsed > 0 ? ((fileState.bytesReceived - lastBytes) * 1000) / elapsed : 0;
      this.lastProgressAt.set(fileIndex, now);
      this.lastProgressBytes.set(fileIndex, fileState.bytesReceived);
      this.opts.onProgress({
        fileIndex,
        bytesSent: fileState.bytesReceived,
        bytesTotal: fileState.bytesTotal,
        speed,
      });
    }
  }

  private async abortAllSinks(): Promise<void> {
    for (const [fileIndex, fileState] of this.activeFiles) {
      try {
        await fileState.sink.abort();
      } catch {
        /* best-effort */
      }
      this.activeFiles.delete(fileIndex);
    }
  }
}
