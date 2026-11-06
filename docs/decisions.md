# Architectural & Design Decisions

This document tracks decisions made during implementation where the specification allowed flexibility or where trade-offs were resolved.

## Decision Log

### ADR 001: Monorepo Build and Typechecking Strategy

- **Context**: Monorepo packages (`@e2ee-share/protocol`, `@e2ee-share/core`) are consumed by `apps/server` and `apps/web`.
- **Decision**: Configure packages with `tsc` building to `dist/`, emitting declarations (`.d.ts`), while using `moduleResolution: "bundler"` for maximum interoperability with Vite and Fastify/tsx. Root `typecheck` ensures packages are compiled before running `tsc --noEmit` across all workspaces.
- **Rationale**: Avoids issues where bundlers/TypeScript attempt to import TypeScript sources outside project root directories, and allows standalone packaging if needed.

### ADR 002: ESLint Flat Config (ESLint 9)

- **Context**: ESLint 9 uses flat configuration (`eslint.config.js`) by default.
- **Decision**: Use `typescript-eslint` helper (`tseslint.config`) with recommended TypeScript rules and explicit rules against `any` types.
- **Rationale**: Aligns with modern TypeScript ESLint standards and ensures strict typing rules across packages.

### ADR 003: Interim Frame Definitions in packages/core/src/crypto/_frame-types.ts

- **Context**: Phase 2 (Crypto Module) requires frame types (`FrameHeader`) and helper functions (`encodeHeader`, `decodeHeader`, `buildNonce`, `buildAAD`) as specified in Section 5.7. Phase 1 (`packages/protocol/src/frame.ts`) is running in parallel.
- **Decision**: Define canonical minimal frame types and binary serialization helpers in `packages/core/src/crypto/_frame-types.ts` matching Section 5.7.
- **Rationale**: Keeps `packages/core` self-contained and unblocked during Phase 2 development while preserving strict type compatibility with `@e2ee-share/protocol` once Phase 1 is merged.

### ADR 004: WebSocket Transport vs Protocol Max Message Sizing

- **Context**: The WebSocket layer (`ws` library) terminates connections abruptly with WebSocket close code 1009 when message size exceeds its transport-level `maxPayload`, preventing application-level protocol error frames from reaching the client.
- **Decision**: Configure `@fastify/websocket` transport `maxPayload` to 128 KiB, and enforce the 64 KiB (`MAX_WS_MESSAGE_BYTES`) limit at the protocol message handler level.
- **Rationale**: Enables the signaling server to cleanly return `{ kind: 'error', code: 'INVALID_MESSAGE', message: 'Message exceeds 64 KiB limit' }` to the client before closing the connection, conforming to protocol specifications.

### ADR 005: Flexible Header Input in buildAAD

- **Context**: Section 5.7 specifies AAD as header bytes concatenated with direction byte. Callers may have either an encoded 11-byte `Uint8Array` or a typed `FrameHeader` struct.
- **Decision**: Allow `buildAAD(header: Uint8Array | FrameHeader, direction: number): Uint8Array` to accept either form, encoding `FrameHeader` via `encodeHeader` when passed.
- **Rationale**: Prevents accidental serialization mismatch, provides ergonomic API for higher-level crypto modules, and ensures strict byte-level adherence to the wire format.

### ADR 006: Out-of-Order Approval Ordering in SenderSession

- **Context**: In Section 5.5, the sender user may click "Approve" either after the receiver's `pubkey` signal has arrived, or immediately upon entering `awaitingApproval`.
- **Decision**: `SenderSession` tracks approval state (`isApproved`). If approval occurs before `pubkey` arrives, the wrapped session key is generated and sent as soon as `pubkey` is processed; if approval occurs after `pubkey` is processed, key exchange executes immediately upon `approveReceiver()`.
- **Rationale**: Eliminates UI/network race conditions and guarantees robust progression to `keyExchange` regardless of network latency vs user action timing.

### ADR 007: Test Isolation of Fastify Server in Core Package Tests

- **Context**: Integration tests in `packages/core` require running the real Fastify server instance (`buildApp`) from `apps/server`, but static cross-package imports from `apps/server` would violate the library package's `rootDir: ./src` TypeScript boundary.
- **Decision**: Configure Vitest workspace aliases (`@e2ee-share/server` -> `apps/server/src/index.ts`) in `vitest.config.ts`, and dynamically import the server module in integration tests with explicit TypeScript interfaces.
- **Rationale**: Preserves strict TypeScript project boundaries (`tsc --noEmit` cleanly passes without rootDir violations), avoids circular package dependencies, and executes the real Fastify server during Vitest test runs.

### ADR 008: WebRTC Constructor Dependency Injection and Headless Test Compatibility

- **Context**: Node.js does not provide native `RTCPeerConnection` without binary addons, whereas browsers have standard WebRTC implementations.
- **Decision**: Design `createPeer` and sessions (`SenderSession`, `ReceiverSession`) to accept `RTCPeerConnectionCtor` via injection, falling back to `globalThis.RTCPeerConnection`. In headless Node test environments without injection, sessions complete key exchange and transition cleanly, while RTC test suites verify connection logic using mock peer connection constructors. Full native RTC tests are conditioned on `test.skipIf(!globalThis.RTCPeerConnection)`.
- **Rationale**: Guarantees testability across standard Node LTS environments without heavy native C++ dependencies like `@roamhq/wrtc`, adhering to Section 11 specifications.

### ADR 009: Decoupling WebSocket Lifecycle from Established DataChannel

- **Context**: In Section 5.5, once the WebRTC DataChannel opens, clients send `{ kind: 'bye' }` on the WebSocket to free server resources, transitioning signaling to closed.
- **Decision**: Update `handleSocketClose` in `SenderSession` and `ReceiverSession` so that signaling WebSocket closure does not trigger a session failure when the session is already in `ready` or `transferring` state.
- **Rationale**: Conforms to the protocol design where the signaling server is untrusted and only needed for the initial handshake; file transfer flows entirely over the encrypted DataChannel.

### ADR 010: Trickle ICE Candidate Buffering Prior to Remote Description

- **Context**: In asynchronous trickle ICE, candidates can arrive over signaling before `setRemoteDescription` completes (such as during ICE server retrieval or SDP negotiation).
- **Decision**: Buffer candidates in `pendingRemoteCandidates` when `pc.remoteDescription` is null, and drain them sequentially once `setRemoteDescription` succeeds in `acceptOffer` and `acceptAnswer`.
- **Rationale**: Prevents race conditions and `InvalidStateError` exceptions in WebRTC implementations.

