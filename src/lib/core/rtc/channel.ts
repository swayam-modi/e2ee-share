/**
 * RTCDataChannel wrapper with backpressure handling and binary streaming.
 * Implements Sections 5.7 and 5.9 of the specification.
 */

import {
  DC_BUFFERED_AMOUNT_HIGH,
  DC_BUFFERED_AMOUNT_LOW_THRESHOLD,
  ErrorCodes,
  ProtocolError,
} from '../../protocol/index';

export interface ChannelEvents {
  message: (data: ArrayBuffer) => void;
  close: () => void;
  error: (err: Error) => void;
}

export interface Channel {
  send(data: Uint8Array): Promise<void>;
  close(): void;
  on<K extends keyof ChannelEvents>(event: K, handler: ChannelEvents[K]): () => void;
  readonly bufferedAmount: number;
}

export function createChannel(dc: RTCDataChannel): Channel {
  try {
    dc.bufferedAmountLowThreshold = DC_BUFFERED_AMOUNT_LOW_THRESHOLD;
  } catch {
    // Some mocks or older implementations may not support setting threshold
  }

  let isClosed = false;
  const lowWaiters = new Set<() => void>();
  const closeWaiters = new Set<() => void>();
  const errorWaiters = new Set<(err: Error) => void>();

  const listeners = new Map<keyof ChannelEvents, Set<ChannelEvents[keyof ChannelEvents]>>();

  function emit<K extends keyof ChannelEvents>(
    event: K,
    ...args: Parameters<ChannelEvents[K]>
  ): void {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch {
        // Suppress listener errors
      }
    }
  }

  function handleBufferedAmountLow(): void {
    const waiters = Array.from(lowWaiters);
    lowWaiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  }

  function handleMessage(event: MessageEvent<unknown>): void {
    if (isClosed) return;
    const rawData = event.data;

    if (rawData instanceof ArrayBuffer) {
      emit('message', rawData);
    } else if (ArrayBuffer.isView(rawData)) {
      const copy = new Uint8Array(rawData.byteLength);
      copy.set(new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength));
      emit('message', copy.buffer as ArrayBuffer);
    } else if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
      void rawData.arrayBuffer().then((buffer) => {
        if (!isClosed) {
          emit('message', buffer);
        }
      });
    }
  }

  function handleClose(): void {
    if (isClosed) return;
    isClosed = true;

    const closeCallbacks = Array.from(closeWaiters);
    closeWaiters.clear();
    lowWaiters.clear();
    for (const cb of closeCallbacks) {
      cb();
    }

    emit('close');
  }

  function handleError(event: unknown): void {
    const errorObj =
      event instanceof Error
        ? event
        : event && typeof event === 'object' && 'error' in event && event.error instanceof Error
          ? event.error
          : new Error(`DataChannel error: ${String(event)}`);

    const errCallbacks = Array.from(errorWaiters);
    errorWaiters.clear();
    lowWaiters.clear();
    for (const cb of errCallbacks) {
      cb(errorObj);
    }

    emit('error', errorObj);
  }

  // Bind low threshold event
  if (typeof dc.addEventListener === 'function') {
    dc.addEventListener('bufferedamountlow', handleBufferedAmountLow);
    dc.addEventListener('message', handleMessage as EventListener);
    dc.addEventListener('close', handleClose);
    dc.addEventListener('error', handleError as EventListener);
  } else {
    dc.onbufferedamountlow = handleBufferedAmountLow;
    dc.onmessage = handleMessage as (ev: MessageEvent) => void;
    dc.onclose = handleClose;
    dc.onerror = handleError as (ev: Event) => void;
  }

  return {
    get bufferedAmount(): number {
      return dc.bufferedAmount;
    },

    async send(data: Uint8Array): Promise<void> {
      if (isClosed) {
        throw new ProtocolError(ErrorCodes.CHANNEL_CLOSED, 'Cannot send on closed DataChannel');
      }

      // Backpressure wait: if bufferedAmount exceeds 1 MiB, await bufferedamountlow
      while (dc.bufferedAmount > DC_BUFFERED_AMOUNT_HIGH) {
        if (isClosed) {
          throw new ProtocolError(
            ErrorCodes.CHANNEL_CLOSED,
            'DataChannel closed while waiting for backpressure relief',
          );
        }

        await new Promise<void>((resolve, reject) => {
          const onLow = () => {
            cleanup();
            resolve();
          };
          const onClose = () => {
            cleanup();
            reject(
              new ProtocolError(
                ErrorCodes.CHANNEL_CLOSED,
                'DataChannel closed while awaiting buffer drain',
              ),
            );
          };
          const onError = (err: Error) => {
            cleanup();
            reject(err);
          };
          const cleanup = () => {
            lowWaiters.delete(onLow);
            closeWaiters.delete(onClose);
            errorWaiters.delete(onError);
          };

          lowWaiters.add(onLow);
          closeWaiters.add(onClose);
          errorWaiters.add(onError);
        });
      }

      // Convert Uint8Array to ArrayBuffer
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      dc.send(copy.buffer as ArrayBuffer);
    },

    close(): void {
      if (isClosed) return;
      isClosed = true;

      handleClose();

      try {
        dc.close();
      } catch {
        // Ignore
      }

      listeners.clear();
    },

    on<K extends keyof ChannelEvents>(event: K, handler: ChannelEvents[K]): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as ChannelEvents[keyof ChannelEvents]);
      return () => {
        set?.delete(handler as ChannelEvents[keyof ChannelEvents]);
      };
    },
  };
}
