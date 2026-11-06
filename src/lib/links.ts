/**
 * Returns the base HTTP URL for REST API calls.
 * Returns empty string so fetch('/api/rooms') goes to the same origin
 * and passes through Next.js's /api rewrite proxy — no cross-origin CORS.
 */
export function buildServerUrl(): string {
  return '';
}

/**
 * Returns the WebSocket URL for the signaling server.
 * Uses NEXT_PUBLIC_WS_URL if set; falls back to same-origin ws (production behind Caddy).
 * Client-side only — do not call in Server Components.
 */
export function buildWsUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (wsUrl) return wsUrl.replace(/\/+$/, '') + '/ws';
  // Production: Caddy proxies /ws on the same origin
  return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
}
