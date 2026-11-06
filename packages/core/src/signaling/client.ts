/**
 * Typed WebSocket signaling client wrapper.
 * Implements Section 8.2 of the specification.
 */

import {
  type ClientMessage,
  type ServerMessage,
  serverMessageSchema,
} from '@e2ee-share/protocol';

export type SignalingClientState = 'connecting' | 'open' | 'closing' | 'closed';

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[]
) => WebSocketLike;

export interface SignalingClientOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onClose: (code: number, reason: string) => void;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  WebSocketCtor?: typeof WebSocket | WebSocketConstructor;
}

export class SignalingClient {
  private readonly ws: WebSocketLike;
  private readonly options: SignalingClientOptions;
  private joinTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private hasSentJoin = false;
  private readonly outgoingQueue: string[] = [];

  constructor(options: SignalingClientOptions) {
    this.options = options;
    const Ctor =
      (options.WebSocketCtor as unknown as WebSocketConstructor | undefined) ??
      (globalThis.WebSocket as unknown as WebSocketConstructor | undefined);

    if (!Ctor) {
      throw new Error('No WebSocket implementation available');
    }

    this.ws = new Ctor(options.url);

    this.ws.onopen = () => {
      // If join was not sent prior to socket opening, start the 5-second join timeout
      if (!this.hasSentJoin) {
        this.joinTimeoutTimer = setTimeout(() => {
          this.close(4008, 'Join timeout');
        }, 5000);
      }

      // Flush messages queued during CONNECTING state
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift();
        if (item !== undefined) {
          this.ws.send(item);
        }
      }

      this.options.onOpen?.();
    };

    this.ws.onmessage = (event: { data: unknown }) => {
      this.handleIncoming(event.data);
    };

    this.ws.onclose = (event: { code: number; reason?: unknown }) => {
      this.clearJoinTimeout();
      const reasonStr =
        typeof event.reason === 'string'
          ? event.reason
          : event.reason !== undefined && event.reason !== null
            ? String(event.reason)
            : '';
      this.options.onClose(event.code, reasonStr);
    };

    this.ws.onerror = (err: unknown) => {
      this.options.onError?.(err);
    };
  }

  get state(): SignalingClientState {
    switch (this.ws.readyState) {
      case 0:
        return 'connecting';
      case 1:
        return 'open';
      case 2:
        return 'closing';
      case 3:
      default:
        return 'closed';
    }
  }

  send(msg: ClientMessage): void {
    if (msg.kind === 'join') {
      this.hasSentJoin = true;
      this.clearJoinTimeout();
    }

    const payload = JSON.stringify(msg);
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(payload);
    } else if (this.ws.readyState === 0 /* CONNECTING */) {
      this.outgoingQueue.push(payload);
    } else {
      throw new Error(`Cannot send message in WebSocket state: ${this.state}`);
    }
  }

  close(code?: number, reason?: string): void {
    this.clearJoinTimeout();
    this.outgoingQueue.length = 0;
    if (this.ws.readyState === 0 || this.ws.readyState === 1) {
      this.ws.close(code, reason);
    }
  }

  private clearJoinTimeout(): void {
    if (this.joinTimeoutTimer !== null) {
      clearTimeout(this.joinTimeoutTimer);
      this.joinTimeoutTimer = null;
    }
  }

  private handleIncoming(data: unknown): void {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(data);
    } else if (
      data !== null &&
      typeof data === 'object' &&
      'toString' in data &&
      typeof (data as { toString: () => string }).toString === 'function'
    ) {
      text = (data as { toString: () => string }).toString();
    } else {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(text);
      const result = serverMessageSchema.safeParse(parsed);
      if (result.success) {
        this.options.onMessage(result.data);
      }
    } catch {
      // Invalid JSON or schema is silently dropped
    }
  }
}
