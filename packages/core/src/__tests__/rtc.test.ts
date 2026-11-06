import { describe, it, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  type Control,
  DC_BUFFERED_AMOUNT_HIGH,
  DC_BUFFERED_AMOUNT_LOW_THRESHOLD,
  DIRECTION_RECEIVER,
  DIRECTION_SENDER,
  ErrorCodes,
  type FrameHeader,
  FRAME_TYPE_DATA,
  ProtocolError,
} from '@e2ee-share/protocol';
import { createChannel, type Channel } from '../rtc/channel.js';
import { createPeer, type Peer } from '../rtc/peer.js';
import { receiveControl, sendControl } from '../transfer/control.js';
import { encryptFrame } from '../crypto/aead.js';

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u.byteLength);
  copy.set(u);
  return copy.buffer as ArrayBuffer;
}

describe('Phase 4 — WebRTC + DataChannel Unit Tests', () => {
  describe('Channel Backpressure (channel.ts)', () => {
    it('awaits before sending when bufferedAmount > DC_BUFFERED_AMOUNT_HIGH, then resolves after bufferedamountlow fires', async () => {
      let bufferedAmount = DC_BUFFERED_AMOUNT_HIGH + 1024; // 1 MiB + 1 KiB
      let sentBuffer: ArrayBuffer | null = null;
      let lowHandler: ((ev: Event) => void) | null = null;

      const mockDc = {
        get bufferedAmount(): number {
          return bufferedAmount;
        },
        bufferedAmountLowThreshold: 0,
        binaryType: 'arraybuffer' as BinaryType,
        send: vi.fn((buf: ArrayBuffer) => {
          sentBuffer = buf;
        }),
        close: vi.fn(),
        addEventListener: vi.fn((event: string, handler: (ev: Event) => void) => {
          if (event === 'bufferedamountlow') {
            lowHandler = handler;
          }
        }),
        removeEventListener: vi.fn(),
        onbufferedamountlow: null as ((ev: Event) => void) | null,
        onmessage: null as ((ev: MessageEvent) => void) | null,
        onclose: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
      };

      const channel = createChannel(mockDc as unknown as RTCDataChannel);

      // Verify that channel sets dc.bufferedAmountLowThreshold to 256 KiB
      expect(mockDc.bufferedAmountLowThreshold).toBe(DC_BUFFERED_AMOUNT_LOW_THRESHOLD);
      expect(channel.bufferedAmount).toBe(DC_BUFFERED_AMOUNT_HIGH + 1024);

      // Attempt send when buffer is high
      const payload = new Uint8Array([10, 20, 30, 40]);
      let sendResolved = false;
      const sendPromise = channel.send(payload).then(() => {
        sendResolved = true;
      });

      // Allow microtasks to execute
      await new Promise((r) => setTimeout(r, 0));

      // Must be awaiting buffer drain, not sent yet
      expect(sendResolved).toBe(false);
      expect(mockDc.send).not.toHaveBeenCalled();

      // Simulate buffer drain below threshold
      bufferedAmount = DC_BUFFERED_AMOUNT_LOW_THRESHOLD - 512;

      // Trigger bufferedamountlow event
      if (lowHandler) {
        (lowHandler as (ev: Event) => void)(new Event('bufferedamountlow'));
      }
      mockDc.onbufferedamountlow?.(new Event('bufferedamountlow'));

      // Wait for sendPromise to resolve
      await sendPromise;

      expect(sendResolved).toBe(true);
      expect(mockDc.send).toHaveBeenCalledTimes(1);
      expect(sentBuffer).not.toBeNull();
      expect(new Uint8Array(sentBuffer!)).toEqual(payload);
    });

    it('sends immediately when bufferedAmount is below threshold', async () => {
      const mockDc = {
        bufferedAmount: 100,
        bufferedAmountLowThreshold: 0,
        binaryType: 'arraybuffer' as BinaryType,
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onbufferedamountlow: null as ((ev: Event) => void) | null,
        onmessage: null as ((ev: MessageEvent) => void) | null,
        onclose: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
      };

      const channel = createChannel(mockDc as unknown as RTCDataChannel);
      const data = new Uint8Array([1, 2, 3]);

      await channel.send(data);

      expect(mockDc.send).toHaveBeenCalledTimes(1);
    });

    it('rejects pending sends if channel closes during backpressure wait', async () => {
      let closeHandler: (() => void) | null = null;
      const mockDc = {
        bufferedAmount: DC_BUFFERED_AMOUNT_HIGH + 2048,
        bufferedAmountLowThreshold: 0,
        binaryType: 'arraybuffer' as BinaryType,
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'close') closeHandler = handler;
        }),
        removeEventListener: vi.fn(),
        onbufferedamountlow: null as ((ev: Event) => void) | null,
        onmessage: null as ((ev: MessageEvent) => void) | null,
        onclose: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
      };

      const channel = createChannel(mockDc as unknown as RTCDataChannel);
      const sendPromise = channel.send(new Uint8Array([1]));

      await new Promise((r) => setTimeout(r, 0));

      // Trigger close while waiting
      if (closeHandler) (closeHandler as () => void)();
      mockDc.onclose?.(new Event('close'));

      await expect(sendPromise).rejects.toThrow(ProtocolError);
    });

    it('emits raw ArrayBuffer on incoming message', async () => {
      let messageHandler: ((ev: MessageEvent) => void) | null = null;
      const mockDc = {
        bufferedAmount: 0,
        bufferedAmountLowThreshold: 0,
        binaryType: 'arraybuffer' as BinaryType,
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn((event: string, handler: (ev: MessageEvent) => void) => {
          if (event === 'message') messageHandler = handler;
        }),
        removeEventListener: vi.fn(),
        onbufferedamountlow: null as ((ev: Event) => void) | null,
        onmessage: null as ((ev: MessageEvent) => void) | null,
        onclose: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
      };

      const channel = createChannel(mockDc as unknown as RTCDataChannel);
      const received: ArrayBuffer[] = [];
      channel.on('message', (data) => {
        received.push(data);
      });

      const testBuffer = new Uint8Array([5, 6, 7, 8]).buffer;
      if (messageHandler) {
        (messageHandler as (ev: MessageEvent) => void)(new MessageEvent('message', { data: testBuffer }));
      }

      expect(received.length).toBe(1);
      expect(new Uint8Array(received[0]!)).toEqual(new Uint8Array([5, 6, 7, 8]));
    });
  });

  describe('Control Frame Round-Trip (transfer/control.ts)', () => {
    let sessionKey: CryptoKey;

    beforeEach(async () => {
      sessionKey = await globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    });

    function createMockChannel(onSend: (data: Uint8Array) => void): Channel {
      return {
        bufferedAmount: 0,
        async send(data: Uint8Array): Promise<void> {
          onSend(data);
        },
        close(): void {},
        on(): () => void {
          return () => {};
        },
      };
    }

    const testVariants: { name: string; msg: Control }[] = [
      {
        name: "hello (sender)",
        msg: { t: 'hello', v: 1, role: 'sender' },
      },
      {
        name: "hello (receiver)",
        msg: { t: 'hello', v: 1, role: 'receiver' },
      },
      {
        name: "file-offer",
        msg: {
          t: 'file-offer',
          fileIndex: 0,
          name: 'project_archive.tar.gz',
          size: 52428800,
          mime: 'application/gzip',
          lastModified: 1710000000000,
          chunkSize: 15360,
          chunkCount: 3414,
        },
      },
      {
        name: "file-accept",
        msg: { t: 'file-accept', fileIndex: 0 },
      },
      {
        name: "file-reject (declined)",
        msg: { t: 'file-reject', fileIndex: 0, reason: 'declined' },
      },
      {
        name: "file-reject (too-large)",
        msg: { t: 'file-reject', fileIndex: 1, reason: 'too-large' },
      },
      {
        name: "file-reject (unsupported)",
        msg: { t: 'file-reject', fileIndex: 2, reason: 'unsupported' },
      },
      {
        name: "file-complete",
        msg: { t: 'file-complete', fileIndex: 0, bytesReceived: 52428800 },
      },
      {
        name: "cancel",
        msg: { t: 'cancel', fileIndex: 0, reason: 'Peer aborted download' },
      },
      {
        name: "bye",
        msg: { t: 'bye' },
      },
    ];

    for (const { name, msg } of testVariants) {
      it(`successfully sends and receives Control variant: ${name}`, async () => {
        let sentFrame: Uint8Array | null = null;
        const channel = createMockChannel((frame) => {
          sentFrame = frame;
        });

        const seq = 42;
        await sendControl(channel, sessionKey, DIRECTION_SENDER, seq, msg);

        expect(sentFrame).not.toBeNull();

        const received = await receiveControl(
          sessionKey,
          DIRECTION_SENDER,
          seq,
          toArrayBuffer(sentFrame!)
        );

        expect(received.msg).toEqual(msg);
        expect(received.seq).toBe(seq);
      });
    }

    it('round-trips in receiver-to-sender direction', async () => {
      let sentFrame: Uint8Array | null = null;
      const channel = createMockChannel((frame) => {
        sentFrame = frame;
      });

      const msg: Control = { t: 'file-accept', fileIndex: 1 };
      await sendControl(channel, sessionKey, DIRECTION_RECEIVER, 0, msg);

      const received = await receiveControl(
        sessionKey,
        DIRECTION_RECEIVER,
        0,
        toArrayBuffer(sentFrame!)
      );

      expect(received.msg).toEqual(msg);
      expect(received.seq).toBe(0);
    });
  });

  describe('Control Frame Integrity and Negative Tests', () => {
    let sessionKey: CryptoKey;

    beforeEach(async () => {
      sessionKey = await globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    });

    it('throws INTEGRITY_FAILED or CRYPTO_FAILED when expectedSeq does not match frame seq', async () => {
      let sentFrame: Uint8Array | null = null;
      const channel: Channel = {
        bufferedAmount: 0,
        async send(data: Uint8Array): Promise<void> {
          sentFrame = data;
        },
        close(): void {},
        on(): () => void {
          return () => {};
        },
      };

      // Encrypt with seq = 0
      await sendControl(channel, sessionKey, DIRECTION_SENDER, 0, {
        t: 'hello',
        v: 1,
        role: 'sender',
      });

      expect(sentFrame).not.toBeNull();

      // Attempt receive with expectedSeq = 1
      await expect(
        receiveControl(sessionKey, DIRECTION_SENDER, 1, toArrayBuffer(sentFrame!))
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ProtocolError &&
          (err.code === ErrorCodes.INTEGRITY_FAILED ||
            err.code === ErrorCodes.CRYPTO_FAILED)
        );
      });
    });

    it('throws CRYPTO_FAILED when ciphertext is corrupted', async () => {
      let sentFrame: Uint8Array | null = null;
      const channel: Channel = {
        bufferedAmount: 0,
        async send(data: Uint8Array): Promise<void> {
          sentFrame = data;
        },
        close(): void {},
        on(): () => void {
          return () => {};
        },
      };

      await sendControl(channel, sessionKey, DIRECTION_SENDER, 0, { t: 'bye' });

      // Flip a bit in the ciphertext / tag region (offset >= 11)
      const corrupted = new Uint8Array(sentFrame!);
      corrupted[15] = (corrupted[15] ?? 0) ^ 0x01;

      await expect(
        receiveControl(sessionKey, DIRECTION_SENDER, 0, toArrayBuffer(corrupted))
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ProtocolError && err.code === ErrorCodes.CRYPTO_FAILED
        );
      });
    });

    it('throws CRYPTO_FAILED when direction is wrong', async () => {
      let sentFrame: Uint8Array | null = null;
      const channel: Channel = {
        bufferedAmount: 0,
        async send(data: Uint8Array): Promise<void> {
          sentFrame = data;
        },
        close(): void {},
        on(): () => void {
          return () => {};
        },
      };

      // Encrypted with DIRECTION_SENDER
      await sendControl(channel, sessionKey, DIRECTION_SENDER, 0, { t: 'bye' });

      // Attempt to decrypt with DIRECTION_RECEIVER
      await expect(
        receiveControl(sessionKey, DIRECTION_RECEIVER, 0, toArrayBuffer(sentFrame!))
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ProtocolError && err.code === ErrorCodes.CRYPTO_FAILED
        );
      });
    });

    it('throws INVALID_MESSAGE when non-CONTROL frame is received', async () => {
      const dataHeader: FrameHeader = {
        version: 0x01,
        type: FRAME_TYPE_DATA,
        flags: 0,
        fileIndex: 0,
        seq: 0,
      };
      const frame = await encryptFrame(
        sessionKey,
        DIRECTION_SENDER,
        dataHeader,
        new Uint8Array([1, 2, 3])
      );

      await expect(
        receiveControl(sessionKey, DIRECTION_SENDER, 0, toArrayBuffer(frame))
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ProtocolError && err.code === ErrorCodes.INVALID_MESSAGE
        );
      });
    });
  });

  describe('Connection Timeout Stub (peer.ts)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('emits ICE_FAILED if peer connection does not reach connected within 30 seconds', () => {
      class MockRTCPeerConnection {
        connectionState: RTCPeerConnectionState = 'connecting';
        onconnectionstatechange: ((ev: Event) => void) | null = null;
        onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
        ondatachannel: ((ev: RTCDataChannelEvent) => void) | null = null;
        close = vi.fn();
        createOffer = vi.fn().mockResolvedValue({ sdp: 'fake-offer', type: 'offer' });
        setLocalDescription = vi.fn().mockResolvedValue(undefined);
        setRemoteDescription = vi.fn().mockResolvedValue(undefined);
        createAnswer = vi.fn().mockResolvedValue({ sdp: 'fake-answer', type: 'answer' });
        addIceCandidate = vi.fn().mockResolvedValue(undefined);
        createDataChannel = vi.fn().mockReturnValue({
          binaryType: 'arraybuffer',
          readyState: 'connecting',
          onopen: null,
          onclose: null,
          close: vi.fn(),
        });
      }

      const peer: Peer = createPeer({
        iceServers: [],
        role: 'sender',
        RTCPeerConnectionCtor: MockRTCPeerConnection as unknown as typeof RTCPeerConnection,
      });

      let emittedError: ProtocolError | null = null;
      let lastState: RTCPeerConnectionState | null = null;

      peer.on('error', (err) => {
        emittedError = err;
      });

      peer.on('connectionStateChange', (state) => {
        lastState = state;
      });

      // Advance 29 seconds: should not fail yet
      vi.advanceTimersByTime(29_000);
      expect(emittedError).toBeNull();
      expect(lastState).toBeNull();

      // Advance 1 more second (total 30 seconds): timeout fires
      vi.advanceTimersByTime(1_000);

      expect(emittedError).not.toBeNull();
      expect((emittedError as ProtocolError | null)?.code).toBe(ErrorCodes.ICE_FAILED);
      expect(lastState).toBe('failed');

      peer.close();
    });

    it('cancels timeout if connection reaches connected within 30 seconds', () => {
      let stateChangeHandler: (() => void) | null = null;
      let currentState: RTCPeerConnectionState = 'connecting';

      class MockRTCPeerConnection {
        get connectionState(): RTCPeerConnectionState {
          return currentState;
        }
        set connectionState(val: RTCPeerConnectionState) {
          currentState = val;
        }
        onconnectionstatechange: ((ev: Event) => void) | null = null;
        onicecandidate = null;
        ondatachannel = null;
        close = vi.fn();
        addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === 'connectionstatechange') stateChangeHandler = handler;
        });
        removeEventListener = vi.fn();
      }

      const peer: Peer = createPeer({
        iceServers: [],
        role: 'receiver',
        RTCPeerConnectionCtor: MockRTCPeerConnection as unknown as typeof RTCPeerConnection,
      });

      let emittedError: ProtocolError | null = null;
      peer.on('error', (err) => {
        emittedError = err;
      });

      // Reach connected at 5 seconds
      vi.advanceTimersByTime(5_000);
      currentState = 'connected';
      if (stateChangeHandler) (stateChangeHandler as () => void)();

      // Advance past 30 seconds
      vi.advanceTimersByTime(35_000);

      expect(emittedError).toBeNull();

      peer.close();
    });
  });

  describe('Mock Peer Pair Handshake and DataChannel Exchange', () => {
    it('establishes DataChannel and exchanges candidate envelopes between sender and receiver peers', async () => {
      let senderDc: Record<string, unknown> | null = null;

      class MockSenderPC {
        connectionState: RTCPeerConnectionState = 'connected';
        onconnectionstatechange: ((ev: Event) => void) | null = null;
        onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
        ondatachannel = null;
        close = vi.fn();
        createOffer = vi.fn().mockResolvedValue({ sdp: 'v=0\r\noffer', type: 'offer' });
        setLocalDescription = vi.fn().mockResolvedValue(undefined);
        setRemoteDescription = vi.fn().mockResolvedValue(undefined);
        createAnswer = vi.fn().mockResolvedValue({ sdp: 'v=0\r\nanswer', type: 'answer' });
        addIceCandidate = vi.fn().mockResolvedValue(undefined);
        createDataChannel = vi.fn((_label: string) => {
          senderDc = {
            binaryType: 'arraybuffer',
            readyState: 'open',
            onopen: null,
            onclose: null,
            send: vi.fn(),
            close: vi.fn(),
          };
          return senderDc;
        });
      }

      class MockReceiverPC {
        connectionState: RTCPeerConnectionState = 'connected';
        onconnectionstatechange: ((ev: Event) => void) | null = null;
        onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
        ondatachannel: ((ev: { channel: unknown }) => void) | null = null;
        close = vi.fn();
        createOffer = vi.fn().mockResolvedValue({ sdp: 'v=0\r\noffer', type: 'offer' });
        setLocalDescription = vi.fn().mockResolvedValue(undefined);
        setRemoteDescription = vi.fn().mockResolvedValue(undefined);
        createAnswer = vi.fn().mockResolvedValue({ sdp: 'v=0\r\nanswer', type: 'answer' });
        addIceCandidate = vi.fn().mockResolvedValue(undefined);
      }

      const senderPeer = createPeer({
        iceServers: [],
        role: 'sender',
        RTCPeerConnectionCtor: MockSenderPC as unknown as typeof RTCPeerConnection,
      });

      const receiverPeer = createPeer({
        iceServers: [],
        role: 'receiver',
        RTCPeerConnectionCtor: MockReceiverPC as unknown as typeof RTCPeerConnection,
      });

      let channelOpened = false;
      senderPeer.on('channelOpen', () => {
        channelOpened = true;
      });

      // 1. Sender creates offer
      const offer = await senderPeer.createOffer();
      expect(offer).toBe('v=0\r\noffer');

      // 2. Receiver accepts offer and generates answer
      const answer = await receiverPeer.acceptOffer(offer);
      expect(answer).toBe('v=0\r\nanswer');

      // 3. Sender accepts answer
      await senderPeer.acceptAnswer(answer);

      // 4. Sender exchanges ICE candidate with receiver
      await receiverPeer.addIceCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 });

      await new Promise((r) => setTimeout(r, 0));
      expect(channelOpened).toBe(true);

      senderPeer.close();
      receiverPeer.close();
    });
  });

  // Skip real RTCPeerConnection test in environments without WebRTC
  test.skipIf(!globalThis.RTCPeerConnection)('real RTCPeerConnection loopback test', async () => {
    const sender = createPeer({ iceServers: [], role: 'sender' });
    const receiver = createPeer({ iceServers: [], role: 'receiver' });

    sender.on('iceCandidate', (c) => void receiver.addIceCandidate(c));
    receiver.on('iceCandidate', (c) => void sender.addIceCandidate(c));

    const offer = await sender.createOffer();
    const answer = await receiver.acceptOffer(offer);
    await sender.acceptAnswer(answer);

    await Promise.all([
      new Promise<void>((resolve) => sender.on('channelOpen', () => resolve())),
      new Promise<void>((resolve) => receiver.on('channelOpen', () => resolve())),
    ]);

    sender.close();
    receiver.close();
  });
});
