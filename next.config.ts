import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV === "development";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve("./"),

  // Allow dev HMR connections from network IPs (e.g. opening on another device)
  allowedDevOrigins: [
    "192.168.102.114",
    "gripple-denice-metaphrastically.ngrok-free.dev",
  ],

  async headers() {
    // Strict base CSP for all environments; dev layers unsafe-inline/eval and
    // localhost WebSocket origins on top.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'"; // Next.js runtime needs unsafe-inline for hydration
    const connectSrc = isDev
      ? "connect-src 'self' ws://localhost:3001 wss://localhost:3001 ws://localhost:* wss://localhost:*"
      : "connect-src 'self' wss:";

    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      connectSrc,
      "worker-src 'self' blob:",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'", // blocks base-tag injection in all environments
    ].join("; ");

    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Content-Security-Policy", value: csp },
    ];

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
