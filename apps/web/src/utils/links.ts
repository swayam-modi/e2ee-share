import { fromBase64Url } from '@e2ee-share/core';

/**
 * Parse receiver URL: /r/:roomId#<base64url-secret>
 * Returns null if the URL doesn't match or the secret is invalid.
 */
export function parseReceiverUrl(): { roomId: string; secret: Uint8Array } | null {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/);
  if (!match) return null;
  const roomId = match[1];
  if (!roomId) return null;
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const secret = fromBase64Url(hash);
    if (secret.byteLength !== 32) return null;
    return { roomId, secret };
  } catch {
    return null;
  }
}

/**
 * Returns the base URL for the signaling server.
 * In production this is the same origin; in dev, Vite proxies /api and /ws.
 */
export function buildServerUrl(): string {
  return window.location.origin;
}
