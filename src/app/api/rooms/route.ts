import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { roomStore } from "@/lib/server/room-store";
import { roomsLimiter } from "@/lib/server/rate-limit";
import { hashSenderToken } from "@/lib/server/room";

const MAX_ROOMS = parseInt(process.env.MAX_ROOMS ?? "10000", 10);
const ROOM_TTL_MAX_SEC = parseInt(process.env.ROOM_TTL_MAX_SEC ?? "3600", 10);

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!roomsLimiter.check(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  if (roomStore.count() >= MAX_ROOMS) {
    return NextResponse.json({ error: "Server at capacity" }, { status: 503 });
  }
  const roomId = crypto.randomBytes(16).toString("base64url");
  const senderToken = crypto.randomBytes(32).toString("base64url");
  const senderTokenHash = hashSenderToken(senderToken);
  const now = Date.now();
  const expiresAt = now + ROOM_TTL_MAX_SEC * 1000;
  roomStore.create(roomId, senderTokenHash, now, expiresAt);
  return NextResponse.json({ roomId, senderToken, expiresAt }, { status: 201 });
}
