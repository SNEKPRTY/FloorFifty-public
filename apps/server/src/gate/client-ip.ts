/**
 * Who a request is from, for the rate limits (release readiness §6.1).
 *
 * The TCP peer, unless the peer is Caddy on loopback, in which case Caddy's
 * last hop: the address Caddy itself saw. A header from anyone else is the
 * sender's own claim and is ignored, so it cannot be used to dodge a limit.
 *
 * Behind Fly.io the TCP peer is Fly's proxy, never loopback, so every player
 * would share one set of limits. There the address is the `Fly-Client-IP`
 * header Fly's proxy sets on every request. It is trusted only when
 * `FLOOR_FIFTY_PROXY=fly` says the server runs behind Fly (a Machine takes
 * connections only through Fly's proxy); anywhere else the header is a
 * sender's own claim and is ignored.
 */

import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

/** Which proxy stands in front of the server: Caddy on loopback (staging), or Fly's. */
export type ProxySource = "caddy" | "fly";

export function proxySourceFromEnv(env: Readonly<Record<string, string | undefined>>): ProxySource {
  const value = env["FLOOR_FIFTY_PROXY"] ?? "";
  if (value === "" || value === "caddy") return "caddy";
  if (value === "fly") return "fly";
  throw new Error('FLOOR_FIFTY_PROXY must be "caddy" or "fly"');
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function clientIp(request: IncomingMessage, source: ProxySource = "caddy"): string {
  const peer = request.socket.remoteAddress ?? "unknown";
  if (source === "fly") {
    const claimed = request.headers["fly-client-ip"];
    const address = typeof claimed === "string" ? claimed.trim() : "";
    return limitKey(isIP(address) === 0 ? peer : address);
  }
  const forwarded = request.headers["x-forwarded-for"];
  if (!LOOPBACK.has(peer) || typeof forwarded !== "string") return limitKey(peer);
  const last = forwarded.split(",").at(-1)?.trim() ?? "";
  return limitKey(last === "" ? peer : last);
}

/**
 * The key an address is limited by. IPv4 stays whole; an IPv4-mapped IPv6
 * address is its IPv4; any other IPv6 address is its /64, because one
 * subscriber holds a whole /64 and could otherwise take fresh limits by
 * changing its address.
 */
function limitKey(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped !== null) return mapped[1]!;
  if (!address.includes(":")) return address;
  const [head = "", tail = ""] = address.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = address.includes("::") ? (tail === "" ? [] : tail.split(":")) : [];
  const groups = address.includes("::")
    ? [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back]
    : front;
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group || "0", 16).toString(16));
  return `${prefix.join(":")}::/64`;
}
