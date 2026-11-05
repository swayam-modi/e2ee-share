# E2EE P2P File Sharing (`e2ee-share`)

Browser-based, end-to-end encrypted peer-to-peer file sharing between two users. A lightweight signaling server introduces the browsers, after which files transfer directly browser-to-browser via WebRTC DataChannels, encrypted in streaming chunks using AES-256-GCM.

## Key Features

- **End-to-End Encryption**: Encrypted with AES-256-GCM at the application layer. The signaling server never sees plaintext, filenames, or encryption keys.
- **Direct P2P Transfer**: Data flows directly between peers over WebRTC DataChannel (with optional TURN relay when direct NAT traversal is impossible).
- **Streaming Chunks**: Handles large files in 15 KiB chunks with low memory overhead.
- **Zero Third-Party Dependencies**: Self-hosted, no CDNs, no external tracking scripts or fonts.
- **MITM Protection**: Bearer link contains a URL fragment secret (`#...`) that is never sent to the server. Signaling envelopes are HMAC-authenticated with keys derived from this secret.

## Monorepo Structure

```text
e2ee-share/
├── packages/
│   ├── protocol/   # Shared types, Zod schemas, frame formats, constants
│   └── core/       # Browser-agnostic crypto, WebRTC, signaling, and transfer logic
├── apps/
│   ├── server/     # Fastify + WebSocket signaling server
│   └── web/        # Vite + React 18 client application
└── docs/           # Architecture, protocol, threat model, and design decisions
```

## Prerequisites

- **Node.js**: 22.x or later (see `.nvmrc`)
- **pnpm**: 9.x or later

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3. Development

Run the server and web client concurrently:

```bash
pnpm dev
```

- Web UI: [http://localhost:5173](http://localhost:5173)
- Signaling Server: [http://localhost:3000](http://localhost:3000)

### 4. Build, Typecheck & Test

```bash
# Build all packages and applications
pnpm build

# Typecheck all packages
pnpm typecheck

# Lint all code
pnpm lint

# Run unit and integration tests
pnpm test
```

## Security Model Overview

1. **Room Creation**: Sender asks server for a random `roomId` (16 bytes base64url).
2. **Key Generation**: Sender generates a 32-byte random `secret` stored only in the URL hash fragment (`#<secret>`).
3. **Authentication**: Both peers derive an HMAC auth key via HKDF from the secret and authenticate every signaling message.
4. **Key Exchange**: Ephemeral RSA-OAEP key exchange establishes a per-session AES-256 session key.
5. **Data Framing**: Each chunk is framed with an 11-byte header authenticated as AAD in AES-GCM with deterministic nonces.
