/**
 * A TCP proxy that behaves like a network.
 *
 * The race runs over WebSockets, which run over TCP, so what a real link does
 * to it is: add latency, add jitter *without reordering* (TCP delivers in
 * order, so a late segment holds up everything behind it), and now and then
 * stall outright while a lost segment is retransmitted. This reproduces those
 * three and nothing else, per direction, from a seed, so a lab run is
 * repeatable to within the host's own timer jitter.
 *
 * It proxies bytes, not messages. Matchmaking HTTP, the WebSocket handshake
 * and every frame after it take the same road, which is the point: nothing in
 * the client or the server knows the proxy is there.
 */

import { createServer, connect, type Server, type Socket } from "node:net";

export type LinkProfile = {
  name: string;
  /** One-way latency client to server, in milliseconds. */
  upMs: number;
  /** One-way latency server to client. */
  downMs: number;
  /** Each chunk is delayed by an extra uniform amount in `[-jitterMs, +jitterMs]`. */
  jitterMs: number;
  /** A stall of `stallMs` begins every `stallEveryMs`, in both directions. */
  stallEveryMs?: number;
  stallMs?: number;
};

export type LatencyProxy = {
  port: number;
  /** Bytes carried client to server, and server to client. */
  readonly bytesUp: number;
  readonly bytesDown: number;
  close(): Promise<void>;
};

/** mulberry32: small, fast, and the same on every machine. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function startLatencyProxy(
  target: { host: string; port: number },
  profile: LinkProfile,
  seed = 1,
): Promise<LatencyProxy> {
  const random = seeded(seed);
  const started = performance.now();
  const sockets = new Set<Socket>();
  let bytesUp = 0;
  let bytesDown = 0;

  /** When a chunk sent now may be delivered, before ordering is enforced. */
  const deliveryTime = (baseMs: number): number => {
    const now = performance.now();
    let at = now + Math.max(0, baseMs + (random() * 2 - 1) * profile.jitterMs);
    const every = profile.stallEveryMs;
    const stall = profile.stallMs;
    if (every !== undefined && stall !== undefined && every > 0 && stall > 0) {
      // A chunk that enters a stall waits for it to end, and then still pays
      // the link's latency: the retransmission is itself a trip.
      const phase = (now - started) % every;
      const windowStart = every - stall;
      if (phase >= windowStart) at = Math.max(at, now + (every - phase) + baseMs);
    }
    return at;
  };

  /** One direction of one connection: in order, each chunk at its time or later. */
  const pipe = (from: Socket, to: Socket, baseMs: number, count: (n: number) => void): void => {
    let lastDelivery = 0;
    from.on("data", (chunk: Buffer) => {
      count(chunk.length);
      const at = Math.max(deliveryTime(baseMs), lastDelivery);
      lastDelivery = at;
      const send = (): void => {
        if (!to.destroyed) to.write(chunk);
      };
      const wait = at - performance.now();
      if (wait <= 0) send();
      else setTimeout(send, wait);
    });
  };

  const server: Server = createServer((client) => {
    const upstream = connect(target.port, target.host);
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true);
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => undefined);
    }
    pipe(client, upstream, profile.upMs, (n) => {
      bytesUp += n;
    });
    pipe(upstream, client, profile.downMs, (n) => {
      bytesDown += n;
    });
    // A close travels like data: after everything already in flight.
    const closeLater = (other: Socket, baseMs: number) => () => {
      setTimeout(() => other.end(), baseMs + profile.jitterMs + 1);
    };
    client.on("end", closeLater(upstream, profile.upMs));
    upstream.on("end", closeLater(client, profile.downMs));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    get bytesUp() {
      return bytesUp;
    },
    get bytesDown() {
      return bytesDown;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
