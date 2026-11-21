import { describe, expect, it } from "vitest";
import { allowedOriginsFromEnv, originPolicy } from "../../../apps/server/src/gate/origins";

describe("the origin policy (release readiness §6.5)", () => {
  it("allows everything when no list is set, as in dev", () => {
    const policy = originPolicy(undefined);
    expect(policy.allows("http://anything.test")).toBe(true);
    expect(policy.allows(undefined)).toBe(true);
    expect(policy.corsHeaders("http://anything.test")).toEqual({ "access-control-allow-origin": "*" });
  });

  it("treats an empty list as unset", () => {
    expect(originPolicy("  ").allows("http://anything.test")).toBe(true);
  });

  it("allows only a listed origin, exactly", () => {
    const policy = originPolicy("https://staging.floorfifty.duckdns.org, https://g-abc.rukengames.com");
    expect(policy.allows("https://g-abc.rukengames.com")).toBe(true);
    expect(policy.allows("https://staging.floorfifty.duckdns.org")).toBe(true);
    expect(policy.allows("https://g-abc.rukengames.com.evil.test")).toBe(false);
    expect(policy.allows("http://g-abc.rukengames.com")).toBe(false);
    expect(policy.allows(undefined)).toBe(false);
  });

  it("echoes a listed origin, and sends no allow header for another", () => {
    const policy = originPolicy("https://g-abc.rukengames.com");
    expect(policy.corsHeaders("https://g-abc.rukengames.com")).toEqual({
      "access-control-allow-origin": "https://g-abc.rukengames.com",
      vary: "Origin",
    });
    expect(policy.corsHeaders("https://other.test")).toEqual({ vary: "Origin" });
    expect(policy.corsHeaders(undefined)).toEqual({ vary: "Origin" });
  });

  // Ruken's local stack serves a game from http://g-<publicId>.localhost:8787
  // (Ruken P6 §5), the origin its playthrough lists for this server.
  it("allows a local Ruken game origin, port and all, and nothing near it", () => {
    const policy = originPolicy("http://g-ab12cd34.localhost:8787");
    expect(policy.allows("http://g-ab12cd34.localhost:8787")).toBe(true);
    expect(policy.allows("http://g-ab12cd34.localhost")).toBe(false);
    expect(policy.allows("http://g-other.localhost:8787")).toBe(false);
    expect(policy.allows("https://g-ab12cd34.localhost:8787")).toBe(false);
  });

  it("adds FLOOR_FIFTY_EXTRA_ORIGINS (a Fly secret) to the fly.toml list", () => {
    const list = allowedOriginsFromEnv({
      FLOOR_FIFTY_ALLOWED_ORIGINS: "https://ruken-games.ruken-beta.workers.dev",
      FLOOR_FIFTY_EXTRA_ORIGINS: "https://g-abc1234567.ruken.dev",
    });
    const policy = originPolicy(list);
    expect(policy.allows("https://ruken-games.ruken-beta.workers.dev")).toBe(true);
    expect(policy.allows("https://g-abc1234567.ruken.dev")).toBe(true);
    expect(policy.allows("https://g-other12345.ruken.dev")).toBe(false);
  });

  it("uses either list alone, and stays unset (open, dev only) when both are empty", () => {
    expect(allowedOriginsFromEnv({ FLOOR_FIFTY_ALLOWED_ORIGINS: "https://a.test" })).toBe("https://a.test");
    expect(allowedOriginsFromEnv({ FLOOR_FIFTY_EXTRA_ORIGINS: "https://b.test" })).toBe("https://b.test");
    expect(allowedOriginsFromEnv({ FLOOR_FIFTY_EXTRA_ORIGINS: " " })).toBeUndefined();
  });

  it("ignores a trailing slash on a listed origin, since a browser never sends one", () => {
    expect(originPolicy("https://g-abc1234567.ruken.dev/").allows("https://g-abc1234567.ruken.dev")).toBe(true);
  });
});
