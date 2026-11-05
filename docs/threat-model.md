# Threat Model & Security Architecture

The signaling server is **untrusted for confidentiality and data integrity**. The share link is treated as a **bearer secret**.

## Threat Analysis and Mitigations

| Threat                                   | Impact                                                                 | Mitigation Strategy                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious or Compromised Server          | Attempts to read transferred file content or metadata                  | Data travels exclusively across WebRTC DataChannels and is encrypted end-to-end with AES-256-GCM. Filenames and sizes are negotiated over encrypted control channels.                        |
| Man-in-the-Middle (MITM) on Signaling    | Server attempts to inject its own public key to intercept session keys | Share link carries a 256-bit secret in the URL hash fragment (`#...`). Browsers never send fragments to the server. Signaling envelopes require HMAC authentication keyed from HKDF(secret). |
| Link Interception / Snooping             | Third party obtains the share link before the intended receiver        | Rooms are locked upon first receiver join. The sender explicitly confirms the receiver's connection via fingerprint matching before session key exchange occurs.                             |
| Chunk Tampering, Dropping, or Reordering | Attacker on transport alters or truncates file                         | Every chunk uses AES-GCM with frame headers authenticated as AAD. Nonces bind sequence numbers, file indices, and transfer direction. A `FINAL` flag and chunk count detect truncation.      |
| Nonce Reuse                              | Cryptographic weakness in GCM                                          | Nonces are constructed deterministically from direction, file index, and chunk sequence counter. Fresh ephemeral session keys are established per transfer session.                          |
| Path Traversal / Malicious Filenames     | Malicious sender attempts to overwrite system files on receiver        | Receiver strictly sanitizes file names, stripping paths, special characters, and reserved names, limiting length to safe bounds.                                                             |
| Room Enumeration & DoS                   | Brute-forcing active room IDs                                          | 128-bit random IDs, short TTLs (10 min unjoined, 60 min absolute), and aggressive IP rate limiting on room creation and API endpoints.                                                       |

## Inherent Limitations

- **JavaScript Delivery**: Like any browser-based application, if the web server serving the JavaScript assets is completely compromised, it could theoretically serve tampered client scripts. This is mitigated by strict CSP headers, no third-party scripts/CDNs, and deterministic builds.
- **Single-Use Sessions**: Sessions cannot be resumed across network disconnects. A broken connection requires generating a new session link.
