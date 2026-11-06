/**
 * FileSink interface — the write target for received file data.
 * Implements Section 8.7 of the specification.
 */
export interface FileSink {
  /**
   * Write a chunk of decrypted plaintext to the sink.
   * May be called multiple times in order.
   */
  write(chunk: Uint8Array): Promise<void>;

  /**
   * Finalize the file: flush, save, trigger browser download, etc.
   * Called exactly once when the final chunk has been verified.
   */
  close(): Promise<void>;

  /**
   * Abort the transfer: discard any partial data and free resources.
   * Called on error or cancel.
   */
  abort(): Promise<void>;
}
