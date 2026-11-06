/**
 * FsAccessSink — streams received file data directly to disk using the
 * File System Access API (Chromium). The UI must open the file picker
 * synchronously from a user gesture (the Accept button click handler) and
 * pass the resulting FileSystemWritableFileStream here.
 *
 * Implements Section 8.7 of the specification.
 */
import type { FileSink } from './sink.js';

export class FsAccessSink implements FileSink {
  private writableStream: FileSystemWritableFileStream;
  private aborted = false;

  /**
   * @param writableStream An already-opened FileSystemWritableFileStream.
   *   The UI is responsible for calling showSaveFilePicker() / createWritable()
   *   before constructing this sink, so that the user gesture timing requirement
   *   is met in the browser.
   */
  constructor(writableStream: FileSystemWritableFileStream) {
    this.writableStream = writableStream;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.aborted) return;
    // Copy to a plain ArrayBuffer for maximum compatibility with the FSAAPI.
    const buf = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buf).set(chunk);
    await this.writableStream.write(buf);
  }

  async close(): Promise<void> {
    if (this.aborted) return;
    await this.writableStream.close();
  }

  async abort(): Promise<void> {
    if (this.aborted) return;
    this.aborted = true;
    try {
      await this.writableStream.abort();
    } catch {
      // Best-effort: stream may already be closed or errored.
    }
  }
}
