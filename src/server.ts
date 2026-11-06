import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { registerSignaling } from "./lib/server/signaling";
import { roomStore } from "./lib/server/room-store";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    // When there is no upstream proxy (dev, direct connections), neither
    // x-forwarded-for nor x-real-ip will be set. Populate x-real-ip from the
    // socket so every client gets its own rate-limit bucket instead of all
    // collapsing into the 'unknown' fallback.
    if (
      !req.headers["x-forwarded-for"] &&
      !req.headers["x-real-ip"] &&
      req.socket.remoteAddress
    ) {
      req.headers["x-real-ip"] = req.socket.remoteAddress;
    }
    const parsedUrl = parse(req.url!, true);
    await handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  registerSignaling(wss, roomStore);

  // TTL sweeper: clean up expired/closed rooms every 60 s
  setInterval(() => roomStore.sweep(Date.now()), 60_000);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket as import("stream").Duplex, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
