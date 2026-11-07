import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV === "development";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve("./"),

  // Allow dev HMR connections from network IPs — load from env, never hardcode
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],

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
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      // HSTS: only in production — avoids breaking local HTTP dev
      ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
    ];

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
