import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { iceLimiter } from "@/lib/server/rate-limit";

interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!iceLimiter.check(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const stunRaw = process.env.STUN_URLS ?? "stun:stun.l.google.com:19302";
  const stunUrls = stunRaw.includes(",")
    ? stunRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : stunRaw;
  const iceServers: IceServerConfig[] = [{ urls: stunUrls }];
  const turnRaw = process.env.TURN_URLS ?? "";
  const turnSecret = process.env.TURN_SECRET;
  if (turnRaw && turnSecret) {
    const turnUrls = turnRaw.includes(",")
      ? turnRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : turnRaw;
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const username = `${expiry}:${crypto.randomBytes(8).toString("hex")}`;
    const credential = crypto
      .createHmac("sha1", turnSecret)
      .update(username)
      .digest("base64");
    iceServers.push({ urls: turnUrls, username, credential });
  }
  return NextResponse.json({ iceServers });
}
