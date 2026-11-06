# E2EE P2P File Sharing — Implementation Plan

> Browser-based, end-to-end encrypted file sharing between two users.
> A signaling server only introduces the two browsers. Files travel directly
> browser → browser over WebRTC, encrypted in chunks, so very large files work
> without loading them into memory.

---

## 0. Instructions for the coding agent

1. Build **phase by phase** (Section 12). Do not start a phase until the previous phase's acceptance criteria pass.
2. After every phase run: `pnpm typecheck && pnpm lint && pnpm test`. Fix everything before moving on.
3. TypeScript `strict: true`. No `any`. No `@ts-ignore` without a comment explaining why.
4. **Never** log, persist, or send to the server: the URL fragment secret, private keys, the session key, file names, file contents. The server must only ever see: room IDs, roles, and opaque signaling envelopes.
5. **No third-party scripts, fonts, analytics or CDNs** in the web app. Everything is self-hosted.
6. All crypto uses the **Web Crypto API** (`crypto.subtle`). Do not add or write your own crypto primitives. Do not use `Math.random()` for anything security-related.
7. Keep all protocol logic in `packages/core` (framework-agnostic). The UI in `apps/web` is a thin layer, so it can later be swapped (for example for Angular).
8. When something in this document is ambiguous, pick the simplest option that preserves the security properties in Section 2, and note the decision in `docs/decisions.md`.

---

## 1. Goals and scope

**Goals**
- Two users share any file type, any size, end-to-end encrypted.
- Sender generates a link; receiver opens it; both browsers connect directly.
- Data is encrypted and sent in small chunks (streaming, constant memory).
- The server cannot read file contents, file names, or keys, even if it is malicious.

**Non-goals (v1)**
- User accounts, persistent storage, file history.
- More than two peers per room.
- Resuming a transfer after the connection drops (a new session is started instead).
- Native mobile apps.

---

## 2. Security model

The signaling server is **untrusted for confidentiality**. The share link is a **bearer secret**.

| Threat | Mitigation |
|---|---|
| Server reads file data | Data only flows over the WebRTC DataChannel and is AES-256-GCM encrypted at the application layer. |
| Server swaps the receiver's public key (MITM) | The link has a secret in the URL **fragment** (`#...`), which browsers never send to the server. All signaling messages carry an HMAC keyed from that secret. The server cannot forge them. |
| Someone else obtains the link | Room is locked after the first receiver joins. The sender must explicitly **approve** the receiver and can compare a **fingerprint** shown on both screens. |
| Tampering, reordering, dropping or truncating chunks | AES-GCM per chunk. The frame header is authenticated as AAD. Sequence numbers are part of the nonce. A FINAL flag plus the expected chunk count detect truncation. |
| Nonce reuse | Nonce is built deterministically from direction, file index and chunk index. A new session key is generated for every session. |
| Malicious file name (path traversal) | Receiver sanitizes names (Section 8.6). |
| Room enumeration / spam | 128-bit random room IDs, rate limits, short TTLs. |
| Signaling or TURN sees traffic metadata | Accepted. Content stays encrypted. |

**Known inherent limitation:** in any web app the server delivers the JavaScript. A fully compromised server could ship malicious code. Mitigate with a strict CSP, no third-party scripts, open-sourcing the client, and (future) a reproducible build with published hashes.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Package manager | pnpm workspaces (monorepo) |
| Runtime | Node.js LTS (22 or newer) |
| Server | Fastify 5, `@fastify/websocket`, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/static`, `zod`, `pino` |
| Web | Vite + React 18 + TypeScript (UI only; logic lives in `packages/core`) |
| Styling | Tailwind CSS (or plain CSS modules, agent's choice) |
| Crypto | Web Crypto API: RSA-OAEP, AES-256-GCM, HKDF, HMAC-SHA-256, SHA-256 |
| Transport | Native `RTCPeerConnection` + `RTCDataChannel` (no simple-peer / PeerJS) |
| Streaming I/O | Streams API, `Blob.slice()`/`File.stream()`, File System Access API (receiver) |
| NAT traversal | STUN + self-hosted **coturn** (TURN) with ephemeral REST credentials |
| Tests | Vitest (unit and integration), Playwright (e2e, two browser contexts) |
| Lint/format | ESLint (typescript-eslint), Prettier |
| Deploy | Docker, docker-compose, Caddy (TLS) |
| Optional later | Redis (multi-instance rooms), `fflate` (zip/folders), QR code library |

Use the latest stable versions and pin them via the lockfile.

**Browser support:** Chromium (Chrome, Edge, Brave) is the primary target (streams directly to disk). Firefox and Safari are supported with a fallback (in-memory Blob with a size warning). WebRTC requires HTTPS (or `localhost`).

---

## 4. Architecture

```
            ┌────────────────────────────────────────┐
            │  Signaling server (Fastify + WebSocket)│
            │  - creates rooms                       │
            │  - relays opaque signaling envelopes   │
            │  - issues ephemeral TURN credentials   │
            └───────▲───────────────────────▲────────┘
        wss (signed │ envelopes)            │ wss (signed envelopes)
                    │                       │
        ┌───────────┴─────────┐   ┌─────────┴───────────┐
        │  Sender (client A)  │   │ Receiver (client B) │
        └───────────┬─────────┘   └─────────┬───────────┘
                    │   WebRTC DataChannel  │
                    └──── AES-GCM frames ───┘
                       (direct, or via TURN relay;
                        always E2E encrypted)
```

Flow summary:
1. A creates a room (REST) and builds the link `https://host/r/<roomId>#<secret>`.
2. B opens the link and joins the room over WebSocket.
3. B generates an RSA-OAEP key pair and sends its public key (authenticated with an HMAC derived from `<secret>`).
4. A verifies it, the user approves, A generates a random AES-256 session key and sends it wrapped with B's public key.
5. WebRTC offer/answer/ICE are exchanged through the server (also authenticated).
6. Once the DataChannel opens, **everything else happens over it**, including file metadata. The server is no longer involved.
7. A streams encrypted chunks. B decrypts and writes them to disk as they arrive.

---

## 5. Protocol specification

### 5.1 URL format

```
https://<host>/r/<roomId>#<secret>
```
- `roomId`: 16 random bytes, base64url (22 chars). Generated by the **server**.
- `secret`: 32 random bytes, base64url (43 chars). Generated by the **sender's browser**. Never sent to the server.
- After reading the fragment, the receiver removes it from the address bar with `history.replaceState`. Sessions are not resumable, so a refresh starts over.

### 5.2 REST API (server)

| Method | Path | Description |
|---|---|---|
| POST | `/api/rooms` | Create a room. Returns `201 { roomId, senderToken, expiresAt }`. Rate limited per IP. |
| GET | `/api/ice` | Returns `{ iceServers: [...] }` with ephemeral TURN credentials. Rate limited. |
| GET | `/healthz` | Liveness probe. |
| GET | `/ws` | WebSocket upgrade for signaling. |

`senderToken` is a random 32-byte value that proves the creator's identity when joining as sender. It is not the E2EE secret.

### 5.3 WebSocket messages (server-level, plain JSON, validated with zod)

Client → server:
```ts
{ kind: 'join'; roomId: string; role: 'sender' | 'receiver'; senderToken?: string }
{ kind: 'signal'; envelope: Envelope }   // relayed verbatim to the other peer
{ kind: 'bye' }                          // close the room
```
Server → client:
```ts
{ kind: 'joined'; role: 'sender' | 'receiver'; peerPresent: boolean }
{ kind: 'peer-joined' }
{ kind: 'peer-left' }
{ kind: 'signal'; envelope: Envelope }
{ kind: 'error'; code: ErrorCode; message: string }
```
Rules:
- The first message after connect must be `join` within 5 seconds, otherwise close.
- Max message size 64 KiB. Per-socket message rate limit.
- A room accepts exactly one sender (with a valid `senderToken`) and one receiver. After the receiver joins the room is **locked**.
- The server never inspects `envelope`.

### 5.4 Signaling envelope (end-to-end authenticated)

```ts
type SignalType = 'pubkey' | 'wrapped-key' | 'key-ack' | 'sdp-offer' | 'sdp-answer' | 'ice';

interface Envelope {
  seq: number;        // per-sender monotonically increasing, starts at 0
  type: SignalType;
  body: string;       // payload as a string (base64url or JSON string). Never re-serialized.
  mac: string;        // base64url HMAC-SHA-256
}
```
`authKey = HKDF-SHA-256(ikm = secret, salt = utf8(roomId), info = "e2ee-share v1 auth", 256 bits)`, imported as a non-extractable HMAC key.

`mac = HMAC(authKey, utf8(`${roomId}|${fromRole}|${seq}|${type}|${body}`))`

The receiver of an envelope **must** verify with `subtle.verify` (constant time), check `seq` is strictly greater than the last seen from that role, and drop anything invalid. Invalid envelopes abort the session with an error.

Payloads (`body`):
- `pubkey`: base64url of the receiver's RSA public key (SPKI).
- `wrapped-key`: base64url of the RSA-OAEP ciphertext containing the raw 32-byte session key.
- `key-ack`: empty string (the MAC proves the receiver unwrapped successfully with the right context).
- `sdp-offer` / `sdp-answer`: the SDP string.
- `ice`: JSON string of the `RTCIceCandidateInit`.

### 5.5 Handshake sequence

```
Sender A                       Server                      Receiver B
   │ POST /api/rooms ─────────────▶│                              │
   │◀──── roomId, senderToken ─────│                              │
   │ builds link with #secret (local only)                        │
   │ WS join(sender) ──────────────▶│                              │
   │                                │◀────────── WS join(receiver) │
   │◀──────── peer-joined ──────────│                              │
   │                                │       B generates RSA-OAEP key pair
   │◀─────────── signal(pubkey + mac) ────────────────────────────│
   │ verify mac ✔, show fingerprint, USER CLICKS "APPROVE"        │
   │ generate 32-byte session key, RSA-OAEP wrap with B's pubkey  │
   │──────── signal(wrapped-key + mac) ───────────────────────────▶│
   │                                │       verify mac ✔, unwrap, import key
   │◀─────────── signal(key-ack + mac) ───────────────────────────│
   │──────── signal(sdp-offer + mac) ─────────────────────────────▶│
   │◀─────────── signal(sdp-answer + mac) ────────────────────────│
   │◀────────── signal(ice) … both directions … ──────────────────▶│
   │══════════════ DataChannel "transfer" opens ══════════════════│
   │ (server no longer needed; clients send `bye`)                │
```

### 5.6 Cryptographic parameters

| Item | Value |
|---|---|
| RSA key pair (receiver, ephemeral per session) | RSA-OAEP, 3072-bit modulus, exponent 65537, SHA-256 |
| Session key (sender, ephemeral per session) | 32 bytes from `crypto.getRandomValues` |
| Key transport | `subtle.encrypt(RSA-OAEP)` of the raw 32 bytes. Then import as AES-GCM key with `extractable: false`; zero the raw buffer. Receiver does the mirror with `subtle.decrypt`. |
| Data cipher | AES-256-GCM, 128-bit tag |
| Auth key | HKDF-SHA-256 from URL secret (Section 5.4) |
| Fingerprint | `SHA-256(receiver SPKI)`, first 8 bytes, shown as 4 groups of 4 hex chars (example `9F2A-71BC-0D44-E8A3`) |

All keys are ephemeral per session, so past sessions stay safe if a later session is compromised. Keep the crypto behind a `KeyExchange` interface so ECDH (P-256 + HKDF) can replace RSA later without touching the rest.

### 5.7 DataChannel binary frame format

DataChannel config: `{ ordered: true }` (reliable), label `transfer`, `binaryType = 'arraybuffer'`.

```
offset  size  field
0       1     version        = 0x01
1       1     type           = 0x01 CONTROL | 0x02 DATA
2       1     flags          bit0 = FINAL (last DATA frame of a file)
3       4     fileIndex      u32 big-endian (0xFFFFFFFF for CONTROL)
7       4     seq            u32 big-endian (chunk index for DATA; message counter for CONTROL)
11      n     ciphertext || 16-byte GCM tag
```
- Header = 11 bytes. **AAD** = header bytes `||` direction byte.
- **Nonce (12 bytes)** = `[direction u8][0x00 0x00 0x00][fileIndex u32][seq u32]`
  - direction: `0x01` sender→receiver, `0x02` receiver→sender (both sides use the same key, so direction prevents nonce collisions).
- `CHUNK_PLAINTEXT_SIZE = 15 * 1024` (15,360 bytes). Max frame = 15,360 + 11 + 16 = 15,387 bytes, below the 16 KiB cross-browser message limit. Keep these as named constants in `packages/protocol`.
- CONTROL plaintext is UTF-8 JSON, max 16,000 bytes.
- Receiver rejects: wrong version, unknown type, `seq` not exactly the expected next value, decrypt failure, frame larger than the maximum. Any failure aborts the transfer.

### 5.8 Control messages (encrypted JSON inside CONTROL frames)

```ts
type Control =
  | { t: 'hello'; v: 1; role: 'sender' | 'receiver' }
  | { t: 'file-offer'; fileIndex: number; name: string; size: number; mime: string;
      lastModified: number; chunkSize: number; chunkCount: number }
  | { t: 'file-accept'; fileIndex: number }
  | { t: 'file-reject'; fileIndex: number; reason: 'declined' | 'too-large' | 'unsupported' }
  | { t: 'file-complete'; fileIndex: number; bytesReceived: number }
  | { t: 'cancel'; fileIndex?: number; reason: string }
  | { t: 'bye' };
```
Validate every incoming control message with zod before use.

### 5.9 Transfer flow and flow control

1. Both sides send `hello`. Sender sends one `file-offer` per selected file (fileIndex = 0, 1, 2, …).
2. Receiver user accepts or rejects. On accept, the receiver opens the sink and sends `file-accept`.
3. Sender reads the file in `CHUNK_PLAINTEXT_SIZE` pieces via `file.stream()` or `blob.slice()`, encrypts each piece, and sends a DATA frame. The last frame has `FINAL` set.
4. **Backpressure:** set `dc.bufferedAmountLowThreshold = 256 KiB`. Before each send, if `dc.bufferedAmount > 1 MiB`, await the `bufferedamountlow` event. Never queue the whole file.
5. Receiver decrypts each frame, writes the plaintext to the sink, and updates progress.
6. On the FINAL frame the receiver checks `chunksReceived === chunkCount` and `bytesReceived === size`, closes the sink, and sends `file-complete`.
7. After the last file, either side sends `bye`; both close the PeerConnection.
8. If the DataChannel closes mid-transfer: mark the file failed, discard or truncate the partial file, show an error.

### 5.10 Error codes

`ROOM_NOT_FOUND`, `ROOM_EXPIRED`, `ROOM_LOCKED`, `INVALID_TOKEN`, `INVALID_MESSAGE`, `RATE_LIMITED`, `PEER_LEFT`, `AUTH_FAILED` (bad MAC), `CRYPTO_FAILED`, `ICE_FAILED`, `CHANNEL_CLOSED`, `TRANSFER_CANCELLED`, `INTEGRITY_FAILED`.

---

## 6. Repository structure

```
e2ee-share/
├─ package.json                  # root scripts: dev, build, typecheck, lint, test, test:e2e
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.js
├─ .prettierrc
├─ .editorconfig
├─ .gitignore
├─ .nvmrc
├─ .env.example
├─ README.md
├─ docker-compose.yml
├─ Dockerfile                    # multi-stage: build web + server, run server
├─ docs/
│  ├─ protocol.md                # copy of Section 5, kept in sync with code
│  ├─ threat-model.md            # Section 2 expanded
│  └─ decisions.md               # agent notes on ambiguous choices
├─ infra/
│  ├─ caddy/Caddyfile
│  └─ coturn/turnserver.conf
├─ packages/
│  ├─ protocol/                  # shared, no runtime deps except zod
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.ts
│  │     ├─ constants.ts         # CHUNK_PLAINTEXT_SIZE, versions, limits, TTLs
│  │     ├─ errors.ts            # ErrorCode, ProtocolError
│  │     ├─ signaling.ts         # zod schemas + types for WS messages and Envelope
│  │     ├─ control.ts           # zod schemas + types for Control messages
│  │     └─ frame.ts             # encodeHeader/decodeHeader, nonce builder, AAD builder
│  └─ core/                      # browser logic, framework-agnostic
│     ├─ package.json
│     └─ src/
│        ├─ index.ts
│        ├─ crypto/
│        │  ├─ random.ts         # randomBytes, base64url encode/decode
│        │  ├─ kdf.ts            # HKDF → authKey
│        │  ├─ mac.ts            # HMAC sign / verify
│        │  ├─ rsa.ts            # generateKeyPair, exportSpki, wrapSessionKey, unwrapSessionKey
│        │  ├─ aead.ts           # encryptFrame / decryptFrame (AES-GCM, nonce + AAD)
│        │  └─ fingerprint.ts    # SPKI → short display fingerprint
│        ├─ signaling/
│        │  ├─ client.ts         # WebSocket wrapper with typed events
│        │  └─ envelope.ts       # sign / verify / seq tracking
│        ├─ rtc/
│        │  ├─ peer.ts           # RTCPeerConnection, ICE config, offer/answer/candidates
│        │  └─ channel.ts        # DataChannel wrapper: send queue, backpressure, events
│        ├─ transfer/
│        │  ├─ sender.ts         # File → chunks → encrypt → send
│        │  ├─ receiver.ts       # frames → verify → decrypt → sink
│        │  ├─ control.ts        # send/receive typed Control messages
│        │  ├─ sanitize.ts       # filename sanitization
│        │  └─ sinks/
│        │     ├─ sink.ts               # interface FileSink { write, close, abort }
│        │     ├─ fs-access-sink.ts     # File System Access API (Chromium)
│        │     └─ blob-sink.ts          # in-memory fallback with size limit
│        ├─ session/
│        │  ├─ sender-session.ts   # state machine + events
│        │  ├─ receiver-session.ts # state machine + events
│        │  └─ types.ts            # states, events, progress types
│        └─ __tests__/
├─ apps/
│  ├─ server/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ index.ts            # entrypoint
│  │     ├─ app.ts              # builds the Fastify instance (testable)
│  │     ├─ config.ts           # env parsing (zod)
│  │     ├─ routes/
│  │     │  ├─ rooms.ts         # POST /api/rooms
│  │     │  ├─ ice.ts           # GET /api/ice (coturn REST credentials)
│  │     │  └─ health.ts
│  │     ├─ ws/
│  │     │  └─ signaling.ts     # /ws handler: join, relay, bye, limits
│  │     ├─ rooms/
│  │     │  ├─ room.ts          # Room class + state machine
│  │     │  ├─ room-store.ts    # RoomStore interface
│  │     │  ├─ memory-store.ts  # default in-memory implementation + TTL sweeper
│  │     │  └─ redis-store.ts   # (later phase)
│  │     ├─ plugins/
│  │     │  ├─ security.ts      # helmet, CSP, headers
│  │     │  └─ rate-limit.ts
│  │     └─ __tests__/
│  └─ web/
│     ├─ package.json
│     ├─ vite.config.ts         # dev proxy for /api and /ws → server
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx
│        ├─ App.tsx             # routes: "/" sender, "/r/:roomId" receiver
│        ├─ pages/
│        │  ├─ SenderPage.tsx
│        │  └─ ReceiverPage.tsx
│        ├─ components/
│        │  ├─ FileDropzone.tsx
│        │  ├─ ShareLinkCard.tsx
│        │  ├─ FingerprintApproval.tsx
│        │  ├─ OfferList.tsx
│        │  ├─ TransferList.tsx     # per-file progress, speed, ETA
│        │  ├─ StatusBanner.tsx
│        │  └─ ErrorView.tsx
│        ├─ hooks/
│        │  ├─ useSenderSession.ts
│        │  └─ useReceiverSession.ts
│        ├─ lib/format.ts           # bytes, speed, duration
│        └─ styles/
└─ e2e/
   ├─ playwright.config.ts
   └─ tests/
      ├─ transfer.spec.ts           # two contexts, 200 MB file, SHA-256 compare
      ├─ malicious-server.spec.ts   # server swaps the public key → sender aborts
      └─ turn-relay.spec.ts         # iceTransportPolicy: 'relay'
```

---

## 7. Server specification (`apps/server`)

### 7.1 Room model
```ts
type RoomState = 'WAITING_SENDER' | 'WAITING_RECEIVER' | 'LOCKED' | 'CLOSED';
interface Room {
  id: string;
  senderTokenHash: string;     // store a SHA-256 hash, compare in constant time
  state: RoomState;
  sender?: WebSocket;
  receiver?: WebSocket;
  createdAt: number;
  expiresAt: number;
}
```
- `RoomStore` interface: `create`, `get`, `delete`, `sweep`. Default `MemoryStore`. A Redis implementation (pub/sub for cross-instance relay) comes in the optional phase.
- TTLs: **10 minutes** until a receiver joins; **60 minutes** hard cap. A sweeper runs every 30 seconds.
- Once both peers are connected, the room is locked and no third socket is accepted.
- If either socket closes before the DataChannel is established, notify the other with `peer-left` and close the room.
- On `bye` or when both sockets are closed, delete the room immediately.

### 7.2 Limits (configurable via env)
- Room creation: 10 per minute per IP.
- `/api/ice`: 30 per minute per IP.
- WS message max size 64 KiB; max 100 messages per 10 seconds per socket.
- Max concurrent rooms: configurable (default 10,000).

### 7.3 ICE / TURN credentials (`/api/ice`)
coturn REST convention:
- `username = "<expiryUnixSeconds>:<random>"` (expiry = now + 1 hour)
- `credential = base64(HMAC-SHA1(TURN_SECRET, username))`
- Return STUN URLs plus TURN URLs (`turn:` UDP/TCP and `turns:` on 443 if configured).

### 7.4 Security headers
Via helmet, with:
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' wss://<host>; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
- `Referrer-Policy: no-referrer`
- `Cache-Control: no-store` on `/api/*`
- `Permissions-Policy` disabling unused features
- No request logging of query strings or WebSocket payloads. Log only: timestamp, event type, hashed room ID prefix, error code.

### 7.5 Static hosting
In production, Fastify serves the built `apps/web/dist` via `@fastify/static` with SPA fallback to `index.html` for `/r/*`.

---

## 8. Core library specification (`packages/core`)

### 8.1 Crypto module
Public functions (all async, all using `crypto.subtle`):
```ts
randomBytes(n: number): Uint8Array
toBase64Url(b: Uint8Array): string
fromBase64Url(s: string): Uint8Array

deriveAuthKey(secret: Uint8Array, roomId: string): Promise<CryptoKey>
signEnvelope(authKey, fields): Promise<string>
verifyEnvelope(authKey, fields, mac): Promise<boolean>

generateReceiverKeyPair(): Promise<CryptoKeyPair>
exportSpki(pub: CryptoKey): Promise<Uint8Array>
importSpki(bytes: Uint8Array): Promise<CryptoKey>
wrapSessionKey(rawKey: Uint8Array, receiverPub: CryptoKey): Promise<Uint8Array>
unwrapSessionKey(wrapped: Uint8Array, receiverPriv: CryptoKey): Promise<CryptoKey>  // returns non-extractable AES-GCM key

encryptFrame(key, direction, header, plaintext): Promise<Uint8Array>
decryptFrame(key, direction, frame): Promise<{ header: FrameHeader; plaintext: Uint8Array }>

fingerprint(spki: Uint8Array): Promise<string>
```
Receiver should start RSA key generation as soon as the page loads (3072-bit generation can take a second or more) and show a "preparing secure connection" state.

### 8.2 Signaling client
Typed event emitter around `WebSocket`: `open`, `joined`, `peerJoined`, `peerLeft`, `signal`, `error`, `close`. Handles the 5-second join timeout and clean close. No automatic reconnection in v1.

### 8.3 RTC layer
- `createPeer({ iceServers, role })` returns an object with `createOffer`, `acceptOffer`, `acceptAnswer`, `addIceCandidate`, and events (`iceCandidate`, `channelOpen`, `channelClose`, `connectionStateChange`).
- Sender creates the DataChannel; receiver gets it via `ondatachannel`.
- Add a debug option to force `iceTransportPolicy: 'relay'` for TURN testing.
- Fail with `ICE_FAILED` if the connection is not established within 30 seconds.

### 8.4 Sender
- Input: `File[]`, session key, channel.
- Offer files, wait for `file-accept`, stream chunks with backpressure (Section 5.9), emit progress events `{ fileIndex, bytesSent, bytesTotal, speed }`.
- Supports `cancel()` at any time (sends `cancel`, stops reading).

### 8.5 Receiver
- For each accepted offer, create a `FileSink`, verify frame order and counts, write plaintext, emit progress, and finalize on FINAL.
- On any failure: `sink.abort()` (delete or truncate the partial file where possible) and emit an error.

### 8.6 Filename sanitization (`sanitize.ts`)
- Take only the base name (strip any `/` or `\` and everything before it).
- Remove control characters and `< > : " | ? *`.
- Strip leading dots and spaces, and trailing dots and spaces.
- Collapse to a maximum of 200 characters while keeping the extension.
- Avoid Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…).
- If empty after cleanup, use `download`.
- Never use the sanitized name to build paths; only pass it to the browser's save APIs.

### 8.7 Sinks
- `FsAccessSink`: for one file use `showSaveFilePicker({ suggestedName })`; for several files use `showDirectoryPicker()` once and create a file handle per file. Pickers need a **user gesture**, so open them in the click handler of the Accept button, before awaiting anything else.
- `BlobSink` (fallback for Firefox and Safari): collect chunks in memory, then trigger a download via an object URL. Refuse offers above a configurable limit (default 1 GiB) with a clear message that explains the browser limitation.

### 8.8 Session state machines
```
SenderSession:   idle → creatingRoom → waitingForReceiver → awaitingApproval
                 → keyExchange → rtcConnecting → ready → transferring
                 → done | failed | cancelled

ReceiverSession: idle → preparingKeys → joining → waitingForKey → rtcConnecting
                 → ready → receiving → done | failed
```
Sessions expose `on(event, handler)`, `state`, and methods (`start`, `approveReceiver`, `sendFiles`, `acceptOffer`, `rejectOffer`, `cancel`, `close`). Every error path must close the socket, the peer connection, and clear key material references.

---

## 9. Web UI specification (`apps/web`)

**Sender (`/`)**
1. Drop zone: select files (multiple allowed). Show names and sizes.
2. Button "Create secure link" → status "Creating room…" → link card with a Copy button and expiry countdown.
3. When a receiver connects: show the fingerprint and an **Approve / Reject** prompt. Hint text: "Optional: confirm this fingerprint matches the one on the receiver's screen (use a different channel than the link)."
4. After approval: show connection state (Connecting → Connected), then per-file progress bars with speed and ETA. Cancel button.
5. Done screen. "Share more" resets the session.

**Receiver (`/r/:roomId`)**
1. "Preparing secure connection…" → "Connecting…" → "Waiting for sender to approve…" (show the same fingerprint).
2. When offers arrive: list file names (sanitized), sizes; **Accept** (opens the save picker) or **Decline** per file. "Accept all" is allowed for Chromium via the directory picker.
3. Progress bars, then "Saved" confirmation.
4. Clear error screens: room expired, room locked, sender left, integrity failure, connection failed.

**UI rules**
- Throttle progress rendering to ~10 updates/second.
- Never render file names or other remote strings as HTML (React text only).
- Show a persistent small lock icon with a "How is this secure?" panel linking to the threat model.
- Fully responsive; keyboard accessible; respects `prefers-color-scheme`.

---

## 10. Infrastructure

### 10.1 Environment variables (`.env.example`)
| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `PUBLIC_URL` | Public origin, used for CSP and CORS | `http://localhost:5173` in dev |
| `STUN_URLS` | Comma-separated STUN URLs | `stun:stun.l.google.com:19302` |
| `TURN_URLS` | Comma-separated TURN URLs | empty |
| `TURN_SECRET` | coturn `static-auth-secret` | required if `TURN_URLS` set |
| `ROOM_TTL_UNJOINED_SEC` | TTL before a receiver joins | `600` |
| `ROOM_TTL_MAX_SEC` | Hard cap per room | `3600` |
| `MAX_ROOMS` | Max concurrent rooms | `10000` |
| `REDIS_URL` | Enables the Redis store | empty |
| `LOG_LEVEL` | pino level | `info` |

Self-hosting STUN is optional; the public Google STUN is acceptable for development, but prefer your own coturn for production so no third party sees connection attempts.

### 10.2 Docker
- `Dockerfile`: stage 1 builds `packages/*`, `apps/web`, `apps/server`; stage 2 runs `node apps/server/dist/index.js` as a non-root user with a read-only filesystem where possible.
- `docker-compose.yml` services: `app` (server + static web), `coturn`, `caddy` (TLS termination, HTTP/2, proxies `/ws`), and optional `redis`.
- coturn runs with `network_mode: host` on Linux (it needs a UDP relay port range).

### 10.3 coturn (`infra/coturn/turnserver.conf`)
Essentials: `listening-port=3478`, `tls-listening-port=5349`, `use-auth-secret`, `static-auth-secret=<TURN_SECRET>`, `realm=<host>`, `fingerprint`, `min-port=49160`, `max-port=49200`, `no-cli`, `no-multicast-peers`, and `denied-peer-ip` entries for private ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16) so the relay cannot be abused to reach internal networks.

### 10.4 Local development
`pnpm dev` runs the server (`tsx watch`) and Vite together. Vite proxies `/api` and `/ws` to the server. Test with two different browser profiles (or one normal and one incognito window) on `localhost`.

---

## 11. Testing strategy

**Unit (Vitest; Node 22 has `globalThis.crypto.subtle`, so crypto tests run in Node)**
- AES-GCM round trip for random sizes (0, 1, 15,360, 15,361 bytes).
- Tamper tests: flipping any bit in header or ciphertext fails decryption; wrong direction fails; wrong seq fails.
- Nonce uniqueness across (direction, fileIndex, seq) for a large generated set.
- Frame encode/decode, and rejection of malformed frames.
- HKDF/HMAC: envelope verify passes for valid input and fails for modified `type`, `body`, `seq`, `fromRole`, or `roomId`.
- RSA wrap/unwrap round trip; unwrap with the wrong private key fails.
- Filename sanitizer table tests (`../../etc/passwd`, `CON.txt`, trailing dots, very long names, empty).
- Backpressure logic with a fake DataChannel.

**Server (Vitest + `ws`)**
- Room lifecycle, TTL expiry, locking (third socket rejected), wrong `senderToken`, `bye` cleanup.
- Relay is verbatim and bidirectional; oversized and malformed messages rejected; rate limits enforced.
- `/api/ice` credential format validates against the coturn HMAC scheme.

**End-to-end (Playwright, two browser contexts, headless Chromium)**
- Transfer a generated 200 MB file and compare SHA-256 on both sides. Also tiny (0 byte, 1 byte) and multi-file cases.
- **Malicious server test:** run the server with a test hook that replaces the receiver's public key. The sender must abort with `AUTH_FAILED`.
- Cancel mid-transfer on both sides; partial file is discarded.
- TURN relay test with `iceTransportPolicy: 'relay'` (requires coturn in CI/dev compose).
- Memory check: transferring a large file must not grow the JS heap proportionally to file size.

---

## 12. Implementation phases

### Phase 0 — Scaffolding
- [ ] pnpm workspace, `tsconfig.base.json`, ESLint, Prettier, Vitest, `.env.example`, root scripts.
- [ ] Empty packages/apps that compile.

**Acceptance:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass on a clean checkout.

### Phase 1 — Protocol package + signaling server
- [ ] `packages/protocol`: constants, error codes, zod schemas, frame header and nonce helpers.
- [ ] `apps/server`: config, `POST /api/rooms`, `/ws` join/relay/bye, room store with TTL sweeper, limits, rate limits, `/healthz`.
- [ ] Server tests from Section 11.

**Acceptance:** two raw `ws` clients can create, join, exchange `signal` messages, and the room is destroyed correctly.

### Phase 2 — Crypto module
- [ ] Everything in Section 8.1 with full unit tests (including tamper tests).

**Acceptance:** all crypto unit tests pass in Node.

### Phase 3 — Authenticated handshake (no WebRTC yet)
- [ ] Signaling client and envelope sign/verify with `seq` tracking.
- [ ] Sender and receiver session logic through `key-ack`, with the approval step.
- [ ] Integration test in Node: two sessions against the real server end up holding the same session key (prove by encrypting on one side and decrypting on the other).
- [ ] Negative test: server (test hook) swaps the public key → sender fails with `AUTH_FAILED`.

**Acceptance:** happy path and malicious-server test pass.

### Phase 4 — WebRTC + DataChannel
- [ ] `/api/ice` and TURN credential generation.
- [ ] Peer and channel wrappers, ICE exchange over authenticated envelopes, 30-second connect timeout.
- [ ] Encrypted CONTROL frames (`hello`, `bye`) over the channel.
- [ ] Browser-based test (Playwright) that two pages exchange `hello`.

**Acceptance:** two browser contexts connect and exchange encrypted control messages; server is idle after the channel opens.

### Phase 5 — Transfer engine
- [ ] Sender streaming with backpressure; receiver verification and sinks (`FsAccessSink`, `BlobSink`).
- [ ] Offer / accept / reject / complete / cancel flow; multi-file queue.
- [ ] Filename sanitization.
- [ ] Playwright transfer tests including the 200 MB hash comparison and memory check.

**Acceptance:** large file transfers correctly with bounded memory; truncation and tampering are detected.

### Phase 6 — Web UI
- [ ] Sender and receiver pages, components, hooks from Section 9.
- [ ] All error and empty states.

**Acceptance:** a non-technical user can complete a transfer with two browsers using only the UI.

### Phase 7 — Hardening
- [ ] CSP/headers, rate limits, size caps, input validation everywhere.
- [ ] Cancel and teardown on every error path; ensure key references are dropped.
- [ ] Review logs for any sensitive data.
- [ ] Write `docs/threat-model.md` and `docs/protocol.md`.

**Acceptance:** security checklist in Section 14 is fully ticked.

### Phase 8 — TURN, Docker and deploy
- [ ] coturn config, compose stack, Caddy TLS, production env.
- [ ] TURN relay e2e test.

**Acceptance:** two users on different networks (one behind a strict NAT) complete a transfer on the deployed stack.

### Phase 9 — Optional enhancements
- [ ] Redis `RoomStore` for multi-instance deployment.
- [ ] Optional per-file gzip using `CompressionStream` (skip already-compressed types).
- [ ] Folder sharing (stream zip with `fflate`).
- [ ] QR code for the link.
- [ ] ECDH `KeyExchange` implementation behind the same interface.
- [ ] Angular UI variant reusing `packages/core`.
- [ ] Service-worker streaming download fallback for Firefox/Safari.

---

## 13. Known limitations and future work

- **Bearer link:** anyone with the full link can attempt to join as receiver before the intended one. Mitigated by the room lock, explicit sender approval, and fingerprint comparison, but you should still send the link over a channel you trust.
- **Web app trust:** the server delivers the code (see Section 2).
- **No resume:** a dropped connection means starting over.
- **Browser limits:** Firefox and Safari cannot stream to disk, so large receives are limited there.
- **Throughput:** 15 KiB frames over a single DataChannel typically reach tens of MB/s on good links. If faster speeds are needed, read `RTCSctpTransport.maxMessageSize` and negotiate larger frames, or use several channels, but keep a 16 KiB fallback.

---

## 14. Definition of done

**Functional**
- [ ] Sender can share multiple files of any type; receiver can accept or decline each.
- [ ] 2 GB file transfers on Chromium with flat memory usage.
- [ ] 0-byte and 1-byte files work.
- [ ] Works through TURN when a direct connection is impossible.

**Security checklist**
- [ ] The URL fragment secret never appears in any network request, log, or server-side state.
- [ ] The malicious-server (public key swap) test passes.
- [ ] Every signaling envelope is MAC-verified with a monotonic `seq` check.
- [ ] No nonce can repeat within a session (tested).
- [ ] Any modified, reordered, duplicated, or truncated frame aborts the transfer.
- [ ] Filenames are sanitized; no path can be influenced by the remote peer.
- [ ] CSP is strict, with no third-party origins.
- [ ] Rooms are single-use, locked after the receiver joins, and expire by TTL.
- [ ] Private keys and session keys are non-extractable `CryptoKey`s and are dereferenced on teardown.

**Quality**
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all pass.
- [ ] README explains setup, dev, test, and deploy in under 10 minutes of reading.

