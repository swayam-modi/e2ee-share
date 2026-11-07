/**
 * BlobSink — in-memory fallback for Firefox/Safari where the File System
 * Access API is unavailable. Accumulates plaintext chunks and triggers a
 * browser download via URL.createObjectURL on close().
 *
 * Maximum memory: 1 GiB (BLOB_SINK_MAX_BYTES). Exceeding this throws.
 *
 * Implements Section 8.7 of the specification.
 */
import type { FileSink } from './sink';

export const BLOB_SINK_MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB

export class BlobSink implements FileSink {
  /** Store as plain ArrayBuffer so the Blob constructor is happy under strict lib.dom. */
  private chunks: ArrayBuffer[] = [];
  private totalBytes = 0;
  private aborted = false;
  private readonly filename: string;
  private readonly maxBytes: number;

  constructor(filename: string, maxBytes: number = BLOB_SINK_MAX_BYTES) {
    this.filename = filename;
    this.maxBytes = maxBytes;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.aborted) return;

    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > this.maxBytes) {
      this.chunks = [];
      this.totalBytes = 0;
      throw new Error(
        `BlobSink: file exceeds maximum in-memory size of ${this.maxBytes} bytes`
      );
    }

    // Defensive copy into a plain ArrayBuffer (Blob-compatible, no SharedArrayBuffer).
    const copy = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(copy).set(chunk);
    this.chunks.push(copy);
  }

  async close(): Promise<void> {
    if (this.aborted) return;

    const blob = new Blob(this.chunks);
    this.chunks = [];
    this.totalBytes = 0;

    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = this.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Revoke after a short delay to let the browser initiate the download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.chunks = [];
    this.totalBytes = 0;
  }
}
