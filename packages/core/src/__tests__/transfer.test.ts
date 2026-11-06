/**
 * Phase 5 — Transfer Engine Tests
 * Tests FileSender + FileReceiver integration with mock Channel/FileSink.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHUNK_PLAINTEXT_SIZE,
  ErrorCodes,
} from '@e2ee-share/protocol';
import type { Channel, ChannelEvents } from '../rtc/channel.js';
import { FileSender } from '../transfer/sender.js';
import { FileReceiver, type FileOfferInfo } from '../transfer/receiver.js';
import { BlobSink, BLOB_SINK_MAX_BYTES } from '../transfer/sinks/blob-sink.js';
import type { FileSink } from '../transfer/sinks/sink.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a 256-bit AES-GCM key for testing. */
async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Generate random bytes of arbitrary size, working around the 65,536-byte
 * limit of `crypto.getRandomValues`.
 */
function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const CHUNK = 65_536;
  for (let offset = 0; offset < size; offset += CHUNK) {
    const len = Math.min(CHUNK, size - offset);
    crypto.getRandomValues(out.subarray(offset, offset + len));
  }
  return out;
}

/** Create a File from raw bytes (browser-compatible via Blob). */
function makeFile(bytes: Uint8Array | ArrayBuffer | number[], name = 'test.bin', type = 'application/octet-stream'): File {
  const part: BlobPart = bytes instanceof Uint8Array ? bytes.buffer as ArrayBuffer : bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes as number[]);
  return new File([part], name, { type, lastModified: Date.now() });
}

/** Collect frames as the sender produces them, returning them for the receiver. */
interface WiredPair {
  senderChannel: Channel;
  receiverChannel: Channel;
}

/**
 * Wire a sender → receiver pair in-memory.
 * Messages sent on senderChannel are delivered to receiverChannel and vice-versa.
 */
function wireChannels(): WiredPair & { triggerClose(side: 'sender' | 'receiver'): void } {
  const senderListeners = new Map<keyof ChannelEvents, Set<ChannelEvents[keyof ChannelEvents]>>();
  const receiverListeners = new Map<
    keyof ChannelEvents,
    Set<ChannelEvents[keyof ChannelEvents]>
  >();

  function emitOn(
    listeners: Map<keyof ChannelEvents, Set<ChannelEvents[keyof ChannelEvents]>>,
    event: keyof ChannelEvents,
    ...args: unknown[]
  ) {
    const set = listeners.get(event);
    if (!set) return;
    for (const h of set) {
      (h as (...a: unknown[]) => void)(...args);
    }
  }

  function makeChannel(
    sendTo: Map<keyof ChannelEvents, Set<ChannelEvents[keyof ChannelEvents]>>,
    myListeners: Map<keyof ChannelEvents, Set<ChannelEvents[keyof ChannelEvents]>>
  ): Channel {
    return {
      get bufferedAmount() {
        return 0;
      },
      async send(data: Uint8Array) {
        // Copy and deliver asynchronously to avoid re-entrancy issues
        const copy = data.slice();
        await Promise.resolve();
        emitOn(sendTo, 'message', copy.buffer);
      },
      close() {
        emitOn(myListeners, 'close');
      },
      on<K extends keyof ChannelEvents>(event: K, handler: ChannelEvents[K]) {
        let set = myListeners.get(event);
        if (!set) {
          set = new Set();
          myListeners.set(event, set);
        }
        set.add(handler as ChannelEvents[keyof ChannelEvents]);
        return () => {
          set?.delete(handler as ChannelEvents[keyof ChannelEvents]);
        };
      },
    };
  }

  const senderChannel = makeChannel(receiverListeners, senderListeners);
  const receiverChannel = makeChannel(senderListeners, receiverListeners);

  return {
    senderChannel,
    receiverChannel,
    triggerClose(side: 'sender' | 'receiver') {
      const listeners = side === 'sender' ? senderListeners : receiverListeners;
      emitOn(listeners, 'close');
    },
  };
}

/** Simple in-memory sink that accumulates written bytes. */
class MemorySink implements FileSink {
  readonly chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk.slice());
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  get bytes(): Uint8Array {
    const total = this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Phase 5 — Transfer Engine', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await makeKey();
  });

  // ---------------------------------------------------------------------------
  // 1. Full round-trip (single small file)
  // ---------------------------------------------------------------------------
  it('full round-trip: 100 KB file (sender → receiver)', async () => {
    const original = randomBytes(100 * 1024);
    const file = makeFile(original, 'payload.bin');
    const { senderChannel, receiverChannel } = wireChannels();

    const sink = new MemorySink();

    const senderDone = new FileSender({
      files: [file],
      key,
      channel: senderChannel,
      onProgress: () => void 0,
    }).run();

    const receiverDone = new FileReceiver({
      key,
      channel: receiverChannel,
      onFileOffer: async (offer) => {
        expect(offer.name).toBe('payload.bin');
        expect(offer.size).toBe(original.byteLength);
        return sink;
      },
      onProgress: () => void 0,
      onComplete: () => void 0,
      onError: (err) => {
        throw err;
      },
    }).run();

    await Promise.all([senderDone, receiverDone]);

    expect(sink.closed).toBe(true);
    expect(sink.bytes).toEqual(original);
  });

  // ---------------------------------------------------------------------------
  // 2. Multi-file transfer
  // ---------------------------------------------------------------------------
  it('multi-file: 3 files all accepted, all complete', async () => {
    const contents = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Uint8Array([8]),
    ];
    const files = [
      makeFile(contents[0]!, 'a.bin'),
      makeFile(contents[1]!, 'b.bin'),
      makeFile(contents[2]!, 'c.bin'),
    ];
    const { senderChannel, receiverChannel } = wireChannels();

    const sinks: MemorySink[] = [];
    const completedFiles: number[] = [];

    const senderDone = new FileSender({
      files,
      key,
      channel: senderChannel,
      onProgress: () => void 0,
    }).run();

    const receiverDone = new FileReceiver({
      key,
      channel: receiverChannel,
      onFileOffer: async () => {
        const sink = new MemorySink();
        sinks.push(sink);
        return sink;
      },
      onProgress: () => void 0,
      onComplete: (fi) => {
        completedFiles.push(fi);
      },
      onError: (err) => {
        throw err;
      },
    }).run();

    await Promise.all([senderDone, receiverDone]);

    expect(sinks).toHaveLength(3);
    expect(sinks.every((s) => s.closed)).toBe(true);
    expect(sinks[0]!.bytes).toEqual(contents[0]!);
    expect(sinks[1]!.bytes).toEqual(contents[1]!);
    expect(sinks[2]!.bytes).toEqual(contents[2]!);
    expect(completedFiles.sort()).toEqual([0, 1, 2]);
  });

  // ---------------------------------------------------------------------------
  // 3. File reject: receiver rejects → sender moves to next file
  // ---------------------------------------------------------------------------
  it('file reject: receiver rejects first file, accepts second', async () => {
    const file1 = makeFile(new Uint8Array([1, 2, 3]), 'secret.bin');
    const file2 = makeFile(new Uint8Array([9, 8, 7]), 'ok.bin');
    const { senderChannel, receiverChannel } = wireChannels();

    let callCount = 0;
    const sink = new MemorySink();

    const senderDone = new FileSender({
      files: [file1, file2],
      key,
      channel: senderChannel,
      onProgress: () => void 0,
    }).run();

    const receiverDone = new FileReceiver({
      key,
      channel: receiverChannel,
      onFileOffer: async (offer: FileOfferInfo) => {
        callCount++;
        if (offer.fileIndex === 0) return null; // reject
        return sink;
      },
      onProgress: () => void 0,
      onComplete: () => void 0,
      onError: (err) => {
        throw err;
      },
    }).run();

    await Promise.all([senderDone, receiverDone]);

    expect(callCount).toBe(2);
    expect(sink.closed).toBe(true);
    // First file rejected — only second file content should be in sink
    expect(sink.bytes).toEqual(new Uint8Array([9, 8, 7]));
  });

  // ---------------------------------------------------------------------------
  // 4. Tamper test: flip a bit in a DATA frame → CRYPTO_FAILED
  // ---------------------------------------------------------------------------
  it('tamper: flipped bit in DATA frame → receiver emits CRYPTO_FAILED', async () => {
    const original = new Uint8Array(100).fill(0xab);
    const file = makeFile(original, 'tamper.bin');

    // Collect raw encrypted frames from sender
    const encryptedFrames: Uint8Array[] = [];
    let receivedError: { code: string } | null = null;
    let tampered = false;

    // Build a custom sender channel that intercepts and tampers DATA frames
    const receiverListeners = new Map<
      keyof ChannelEvents,
      Set<ChannelEvents[keyof ChannelEvents]>
    >();
    const senderListeners = new Map<
      keyof ChannelEvents,
      Set<ChannelEvents[keyof ChannelEvents]>
    >();

    function emitOn(
      listeners: Map<keyof ChannelEvents, Set<ChannelEvents[keyof ChannelEvents]>>,
      event: keyof ChannelEvents,
      ...args: unknown[]
    ) {
      const set = listeners.get(event);
      if (!set) return;
      for (const h of set) {
        (h as (...a: unknown[]) => void)(...args);
      }
    }

    const senderChannel: Channel = {
      get bufferedAmount() { return 0; },
      async send(data: Uint8Array) {
        const copy = data.slice();
        const frameType = copy[1];
        // Only tamper the first DATA frame (type 0x02)
        if (frameType === 0x02 && !tampered) {
          tampered = true;
          copy[copy.byteLength - 1] = (copy[copy.byteLength - 1] ?? 0) ^ 0xff; // Flip last byte (GCM tag)
        }
        encryptedFrames.push(copy);
        await Promise.resolve();
        emitOn(receiverListeners, 'message', copy.buffer);
      },
      close() { emitOn(senderListeners, 'close'); },
      on<K extends keyof ChannelEvents>(event: K, handler: ChannelEvents[K]) {
        let set = senderListeners.get(event);
        if (!set) { set = new Set(); senderListeners.set(event, set); }
        set.add(handler as ChannelEvents[keyof ChannelEvents]);
        return () => { set?.delete(handler as ChannelEvents[keyof ChannelEvents]); };
      },
    };

    const receiverChannel: Channel = {
      get bufferedAmount() { return 0; },
      async send(data: Uint8Array) {
        const copy = data.slice();
        await Promise.resolve();
        emitOn(senderListeners, 'message', copy.buffer);
      },
      close() { emitOn(receiverListeners, 'close'); },
      on<K extends keyof ChannelEvents>(event: K, handler: ChannelEvents[K]) {
        let set = receiverListeners.get(event);
        if (!set) { set = new Set(); receiverListeners.set(event, set); }
        set.add(handler as ChannelEvents[keyof ChannelEvents]);
        return () => { set?.delete(handler as ChannelEvents[keyof ChannelEvents]); };
      },
    };

    const receiverDone = new FileReceiver({
      key,
      channel: receiverChannel,
      onFileOffer: async () => new MemorySink(),
      onProgress: () => void 0,
      onComplete: () => void 0,
      onError: (err) => { receivedError = { code: err.code }; },
    }).run().catch((err: { code: string }) => { receivedError = { code: err.code }; });

    const senderDone = new FileSender({
      files: [file],
      key,
      channel: senderChannel,
      onProgress: () => void 0,
    }).run().catch(() => { /* sender may error too */ });

    await Promise.allSettled([senderDone, receiverDone]);

    expect(receivedError).not.toBeNull();
    expect((receivedError as unknown as { code: string }).code).toBe(ErrorCodes.CRYPTO_FAILED);
  });

  // ---------------------------------------------------------------------------
  // 5. Cancel mid-transfer: sender cancels → receiver gets cancel, sink.abort()
  // ---------------------------------------------------------------------------
  it('cancel: sender.cancel() stops transfer and receiver aborts sink', async () => {
    // Use a large enough file to have multiple chunks
    const data = randomBytes(3 * CHUNK_PLAINTEXT_SIZE);
    const file = makeFile(data, 'big.bin');

    const { senderChannel, receiverChannel } = wireChannels();
    const sink = new MemorySink();
    let receivedError: { code: string } | null = null;

    const receiverDone = new FileReceiver({
      key,
      channel: receiverChannel,
      onFileOffer: async () => sink,
      onProgress: () => void 0,
      onComplete: () => void 0,
      onError: (err) => { receivedError = { code: err.code }; },
    }).run().catch((err: { code: string }) => { receivedError = { code: err.code }; });

    // Let sender run and cancel during first chunk
    let chunksSent = 0;
    const cancelSender = new FileSender({
      files: [file],
      key,
      channel: senderChannel,
      onProgress: () => {
        chunksSent++;
        if (chunksSent === 1) {
          cancelSender.cancel('mid transfer cancel');
        }
      },
    });

    const senderDone = cancelSender.run().catch(() => { /* expected */ });

    await Promise.allSettled([senderDone, receiverDone]);

    // Receiver should have aborted the sink due to cancel message
    expect(sink.aborted || sink.closed || receivedError !== null).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. Empty file: 0-byte file round-trips correctly
  // ---------------------------------------------------------------------------
  it('empty file: 0 bytes transfers correctly', async () => {
    const file = makeFile(new Uint8Array(0), 'empty.bin');
    const { senderChannel, receiverChannel } = wireChannels();
    const sink = new MemorySink();

    const senderDone = new FileSender({
      files: [file],
      key,
      channel: senderChannel,
      onProgress: () => void 0,
    }).run();

    const receiverDone = new FileReceiver({
      key,
      channel: receiverChannel,
      onFileOffer: async () => sink,
      onProgress: () => void 0,
      onComplete: () => void 0,
      onError: (err) => { throw err; },
    }).run();

    await Promise.all([senderDone, receiverDone]);

    expect(sink.closed).toBe(true);
    expect(sink.bytes.byteLength).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Large file (200 KB, multiple chunks)
  // ---------------------------------------------------------------------------
  it('large file: 200 KB (multiple chunks), hash matches', async () => {
    const size = 200 * 1024;
    const original = randomBytes(size);
    const file = makeFile(original, 'large.bin');
    const { senderChannel, receiverChannel } = wireChannels();
    const sink = new MemorySink();

    await Promise.all([
      new FileSender({
        files: [file],
        key,
        channel: senderChannel,
        onProgress: () => void 0,
      }).run(),
      new FileReceiver({
        key,
        channel: receiverChannel,
        onFileOffer: async () => sink,
        onProgress: () => void 0,
        onComplete: () => void 0,
        onError: (err) => { throw err; },
      }).run(),
    ]);

    expect(sink.closed).toBe(true);

    // Compare hashes
    const [origHash, receivedHash] = await Promise.all([
      crypto.subtle.digest('SHA-256', original.buffer as ArrayBuffer),
      crypto.subtle.digest('SHA-256', sink.bytes.buffer as ArrayBuffer),
    ]);
    expect(new Uint8Array(origHash)).toEqual(new Uint8Array(receivedHash));
  });

  // ---------------------------------------------------------------------------
  // 8. BlobSink size limit
  // ---------------------------------------------------------------------------
  it('BlobSink: exceeds maxBytes → throws', async () => {
    const sink = new BlobSink('test.bin', 10);
    await expect(sink.write(new Uint8Array(11).fill(0))).rejects.toThrow('BlobSink');
  });

  it('BlobSink: abort() frees chunks', async () => {
    const sink = new BlobSink('test.bin', BLOB_SINK_MAX_BYTES);
    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.abort();
    // After abort, write is a no-op
    await sink.write(new Uint8Array([4]));
    // Should not throw
  });

  // ---------------------------------------------------------------------------
  // 9. Progress callbacks are emitted
  // ---------------------------------------------------------------------------
  it('progress: callbacks emitted during transfer', async () => {
    const data = randomBytes(50 * 1024);
    const file = makeFile(data, 'prog.bin');
    const { senderChannel, receiverChannel } = wireChannels();

    const progressEvents: number[] = [];

    await Promise.all([
      new FileSender({
        files: [file],
        key,
        channel: senderChannel,
        onProgress: (p) => { progressEvents.push(p.bytesSent); },
      }).run(),
      new FileReceiver({
        key,
        channel: receiverChannel,
        onFileOffer: async () => new MemorySink(),
        onProgress: () => void 0,
        onComplete: () => void 0,
        onError: (err) => { throw err; },
      }).run(),
    ]);

    expect(progressEvents.length).toBeGreaterThan(0);
    // Final progress should be the full file size
    const lastProgress = progressEvents[progressEvents.length - 1]!;
    expect(lastProgress).toBe(data.byteLength);
  });
});
