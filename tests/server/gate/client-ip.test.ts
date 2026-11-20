import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientIp, proxySourceFromEnv } from "../../../apps/server/src/gate/client-ip";

const request = (
  remoteAddress: string | undefined,
  xff?: string,
  more: Record<string, string | string[]> = {},
): IncomingMessage =>
  ({
    socket: { remoteAddress },
    headers: { ...(xff === undefined ? {} : { "x-forwarded-for": xff }), ...more },
  }) as unknown as IncomingMessage;

describe("the client address (release readiness §6.1)", () => {
  it("is the TCP peer", () => {
    expect(clientIp(request("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("ignores X-Forwarded-For from anyone but loopback, so it cannot be forged", () => {
    expect(clientIp(request("203.0.113.9", "1.2.3.4"))).toBe("203.0.113.9");
  });

  it("takes Caddy's last hop when Caddy forwards", () => {
    expect(clientIp(request("::ffff:127.0.0.1", "1.2.3.4, 198.51.100.7"))).toBe("198.51.100.7");
    expect(clientIp(request("127.0.0.1", "198.51.100.7"))).toBe("198.51.100.7");
    expect(clientIp(request("::1", " 198.51.100.8 "))).toBe("198.51.100.8");
  });

  it("falls back to the peer when loopback forwards nothing usable", () => {
    expect(clientIp(request("127.0.0.1"))).toBe("127.0.0.1");
    expect(clientIp(request("127.0.0.1", " , "))).toBe("127.0.0.1");
  });

  // One IPv6 subscriber holds a whole /64, so the limits key on that, or a
  // client could take fresh limits by changing its address.
  it("keys an IPv6 address by its /64, and leaves IPv4 whole", () => {
    expect(clientIp(request("2001:db8:aaaa:bbbb:1:2:3:4"))).toBe("2001:db8:aaaa:bbbb::/64");
    expect(clientIp(request("2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff"))).toBe("2001:db8:aaaa:bbbb::/64");
    expect(clientIp(request("2001:db8::1"))).toBe("2001:db8:0:0::/64");
    expect(clientIp(request("::ffff:203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(request("::ffff:127.0.0.1", "2001:db8:1:2::9"))).toBe("2001:db8:1:2::/64");
  });

  it("names a socket with no address rather than throwing", () => {
    expect(clientIp(request(undefined))).toBe("unknown");
  });
});

describe("the client address behind Fly (finish for launch §2.3)", () => {
  const behindFly = (flyClientIp: string | string[] | undefined, xff?: string): IncomingMessage =>
    request("172.16.0.1", xff, flyClientIp === undefined ? {} : { "fly-client-ip": flyClientIp });

  it("is the Fly-Client-IP header, not Fly's proxy", () => {
    expect(clientIp(behindFly("203.0.113.9"), "fly")).toBe("203.0.113.9");
    expect(clientIp(behindFly(" 203.0.113.9 "), "fly")).toBe("203.0.113.9");
  });

  it("limits an IPv6 player by /64 and an IPv4-mapped one by IPv4", () => {
    expect(clientIp(behindFly("2001:db8:aaaa:bbbb:1:2:3:4"), "fly")).toBe("2001:db8:aaaa:bbbb::/64");
    expect(clientIp(behindFly("::ffff:203.0.113.9"), "fly")).toBe("203.0.113.9");
  });

  it("ignores X-Forwarded-For", () => {
    expect(clientIp(behindFly("203.0.113.9", "1.2.3.4"), "fly")).toBe("203.0.113.9");
    expect(clientIp(request("127.0.0.1", "198.51.100.7"), "fly")).toBe("127.0.0.1");
  });

  it.each([undefined, "", "not-an-ip", ["203.0.113.9", "203.0.113.10"]])(
    "falls back to the TCP peer for Fly-Client-IP %j",
    (value) => {
      expect(clientIp(behindFly(value), "fly")).toBe("172.16.0.1");
    },
  );

  it("ignores Fly-Client-IP everywhere else, from any peer", () => {
    expect(clientIp(behindFly("203.0.113.9"))).toBe("172.16.0.1");
    expect(clientIp(request("127.0.0.1", undefined, { "fly-client-ip": "203.0.113.9" }))).toBe("127.0.0.1");
    expect(clientIp(request("127.0.0.1", "198.51.100.7", { "fly-client-ip": "203.0.113.9" }), "caddy")).toBe(
      "198.51.100.7",
    );
  });
});

describe("FLOOR_FIFTY_PROXY", () => {
  it("defaults to Caddy and accepts caddy and fly", () => {
    expect(proxySourceFromEnv({})).toBe("caddy");
    expect(proxySourceFromEnv({ FLOOR_FIFTY_PROXY: "" })).toBe("caddy");
    expect(proxySourceFromEnv({ FLOOR_FIFTY_PROXY: "caddy" })).toBe("caddy");
    expect(proxySourceFromEnv({ FLOOR_FIFTY_PROXY: "fly" })).toBe("fly");
  });

  it("refuses anything else, naming the choices", () => {
    expect(() => proxySourceFromEnv({ FLOOR_FIFTY_PROXY: "flyy" })).toThrow(/"caddy" or "fly"/);
  });
});
