/**
 * FileSender — reads files from the browser File API, encrypts each chunk,
 * and streams DATA frames over the DataChannel.
 *
 * Implements Sections 5.7, 5.9 and 8.4 of the specification.
 */
import {
  CHUNK_PLAINTEXT_SIZE,
  DIRECTION_RECEIVER,
  DIRECTION_SENDER,
  ErrorCodes,
  FRAME_FLAG_FINAL,
  FRAME_TYPE_DATA,
  PROTOCOL_VERSION,
  ProtocolError,
  type FrameHeader,
} from '@e2ee-share/protocol';
import type { Channel } from '../rtc/channel.js';
import { encryptFrame } from '../crypto/aead.js';
import type { TransferProgress } from '../session/types.js';
import { sendControl } from './control.js';

export interface SenderOptions {
  files: File[];
  key: CryptoKey;
  channel: Channel;
  onProgress: (p: TransferProgress) => void;
}

/** Minimum time between progress callbacks (ms). ~10 updates/second. */
const PROGRESS_THROTTLE_MS = 100;

export class FileSender {
  private cancelled = false;
  private controlSeq = 0;
  /** Tracks incoming control seq (receiver → sender direction). */
  private controlSeqIn = 0;

  constructor(private readonly opts: SenderOptions) {}

  /**
   * Run the full transfer loop:
   * 1. For each file: send CONTROL `file-offer`.
   * 2. Wait for CONTROL `file-accept` or `file-reject`.
   * 3. If accepted: stream chunks, send DATA frames with backpressure.
   * 4. After all files: send CONTROL `bye`.
   */
  async run(): Promise<void> {
    const { files, channel, key } = this.opts;

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      if (this.cancelled) break;

      const file = files[fileIndex]!;
      const chunkCount = Math.ceil(file.size / CHUNK_PLAINTEXT_SIZE) || 1;

      // --- 1. Send file-offer ---
      await sendControl(channel, key, DIRECTION_SENDER, this.controlSeq++, {
        t: 'file-offer',
        fileIndex,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
        chunkSize: CHUNK_PLAINTEXT_SIZE,
        chunkCount,
      });

      // --- 2. Wait for file-accept or file-reject ---
      const accepted = await this.waitForFileDecision(key, fileIndex);
      if (!accepted || this.cancelled) continue;

      // --- 3. Stream chunks ---
      await this.streamFile(file, fileIndex, chunkCount, key, channel);
    }

    // --- 4. Send bye (unless we also sent cancel) ---
    if (!this.cancelled) {
      await sendControl(channel, key, DIRECTION_SENDER, this.controlSeq++, { t: 'bye' });
    }
  }

  /**
   * Cancel at any time: sends CONTROL `cancel`, stops reading.
   */
  cancel(reason = 'user cancelled'): void {
    if (this.cancelled) return;
    this.cancelled = true;

    // Best-effort: fire and forget
    void sendControl(
      this.opts.channel,
      this.opts.key,
      DIRECTION_SENDER,
      this.controlSeq++,
      { t: 'cancel', reason }
    ).catch(() => {
      /* ignore */
    });
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Wait for the receiver to accept or reject the given fileIndex.
   * Reads raw messages from the channel until it gets the matching decision.
   * Returns true if accepted, false if rejected.
   */
  private waitForFileDecision(key: CryptoKey, fileIndex: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const off = this.opts.channel.on('message', (data: ArrayBuffer) => {
        void (async () => {
          try {
            const bytes = new Uint8Array(data);
            // Peek frame type byte (offset 1 in header)
            const frameType = bytes[1];
            if (frameType !== 0x01 /* FRAME_TYPE_CONTROL */) return;

            const { decryptFrame } = await import('../crypto/aead.js');
            const { header, plaintext } = await decryptFrame(key, DIRECTION_RECEIVER, bytes);

            if (header.fileIndex !== 0xffffffff) return;

            const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
            const msg = JSON.parse(text) as { t: string; fileIndex?: number; reason?: string };

            if (this.controlSeqIn !== header.seq) {
              reject(
                new ProtocolError(
                  ErrorCodes.INTEGRITY_FAILED,
                  `Control seq mismatch: expected ${this.controlSeqIn}, got ${header.seq}`
                )
              );
              off();
              return;
            }
            this.controlSeqIn++;

            if (msg.t === 'file-accept' && msg.fileIndex === fileIndex) {
              off();
              resolve(true);
            } else if (msg.t === 'file-reject' && msg.fileIndex === fileIndex) {
              off();
              resolve(false);
            } else if (msg.t === 'cancel' || msg.t === 'bye') {
              off();
              this.cancelled = true;
              resolve(false);
            }
          } catch {
            /* ignore parse errors */
          }
        })();
      });

      this.opts.channel.on('close', () => {
        off();
        reject(new ProtocolError(ErrorCodes.CHANNEL_CLOSED, 'Channel closed waiting for accept'));
      });
    });
  }

  /** Stream all chunks of a single file as DATA frames. */
  private async streamFile(
    file: File,
    fileIndex: number,
    chunkCount: number,
    key: CryptoKey,
    channel: Channel
  ): Promise<void> {
    let seq = 0;
    let bytesSent = 0;
    const bytesTotal = file.size;
    let lastProgressAt = 0;
    let lastSpeedBytes = 0;
    let lastSpeedTime = Date.now();

    // Helper: emit progress (throttled to ~10/s)
    const emitProgress = (force = false) => {
      const now = Date.now();
      if (force || now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        const elapsed = (now - lastSpeedTime) / 1000;
        const speed = elapsed > 0 ? (bytesSent - lastSpeedBytes) / elapsed : 0;
        if (now - lastSpeedTime >= PROGRESS_THROTTLE_MS) {
          lastSpeedBytes = bytesSent;
          lastSpeedTime = now;
        }
        this.opts.onProgress({ fileIndex, bytesSent, bytesTotal, speed });
        lastProgressAt = now;
      }
    };

    if (file.size === 0) {
      // Empty file: send a single FINAL frame with zero-length plaintext
      const header: FrameHeader = {
        version: PROTOCOL_VERSION,
        type: FRAME_TYPE_DATA,
        flags: FRAME_FLAG_FINAL,
        fileIndex,
        seq: seq++,
      };
      const frame = await encryptFrame(key, DIRECTION_SENDER, header, new Uint8Array(0));
      await channel.send(frame);
      emitProgress(true);
      return;
    }

    const totalChunks = chunkCount;
    let chunkIdx = 0;

    // Use streaming: slice file into CHUNK_PLAINTEXT_SIZE pieces
    let offset = 0;
    while (offset < file.size && !this.cancelled) {
      const end = Math.min(offset + CHUNK_PLAINTEXT_SIZE, file.size);
      const slice = file.slice(offset, end);
      const arrayBuffer = await slice.arrayBuffer();
      const plaintext = new Uint8Array(arrayBuffer);

      chunkIdx++;
      const isFinal = chunkIdx === totalChunks;

      const header: FrameHeader = {
        version: PROTOCOL_VERSION,
        type: FRAME_TYPE_DATA,
        flags: isFinal ? FRAME_FLAG_FINAL : 0,
        fileIndex,
        seq: seq++,
      };

      const frame = await encryptFrame(key, DIRECTION_SENDER, header, plaintext);
      await channel.send(frame); // handles backpressure

      bytesSent += plaintext.byteLength;
      offset = end;
      emitProgress();
    }

    if (!this.cancelled) {
      emitProgress(true);
    }
  }
}
