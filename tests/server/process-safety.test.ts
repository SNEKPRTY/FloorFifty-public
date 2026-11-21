import { describe, expect, it, vi } from "vitest";
import { forbiddenInProduction, installCrashHandlers } from "../../apps/server/src/process-safety";

describe("the production guard (release readiness §6.6)", () => {
  /** A production environment with everything it needs, so each case changes one thing. */
  const production = { NODE_ENV: "production", MAX_ROOMS: "40", FLOOR_FIFTY_ALLOWED_ORIGINS: "https://a.test" };

  it("starts a production server that has its limits and its origins", () => {
    expect(forbiddenInProduction(production)).toEqual([]);
  });

  it.each(["FLOOR_FIFTY_TEST_DRIVER_TOKEN", "FLOOR_FIFTY_TEST_SEED"])("refuses %s", (name) => {
    expect(forbiddenInProduction({ ...production, [name]: "x" })).toEqual([name]);
  });

  it("refuses verbose telemetry", () => {
    expect(forbiddenInProduction({ ...production, FLOOR_FIFTY_TELEMETRY: "1" })).toEqual(["FLOOR_FIFTY_TELEMETRY"]);
  });

  it("names every switch that is set, not just the first", () => {
    expect(
      forbiddenInProduction({ ...production, FLOOR_FIFTY_TEST_DRIVER_TOKEN: "x", FLOOR_FIFTY_TELEMETRY: "1" }),
    ).toEqual(["FLOOR_FIFTY_TEST_DRIVER_TOKEN", "FLOOR_FIFTY_TELEMETRY"]);
  });

  it("ignores an empty value, as the server does", () => {
    expect(forbiddenInProduction({ ...production, FLOOR_FIFTY_TEST_DRIVER_TOKEN: "" })).toEqual([]);
  });

  // A public server with no room cap or no origin list is wide open (§6.1, §6.5).
  it("refuses to run without MAX_ROOMS or FLOOR_FIFTY_ALLOWED_ORIGINS", () => {
    expect(forbiddenInProduction({ NODE_ENV: "production" })).toEqual([
      "MAX_ROOMS (unset)",
      "FLOOR_FIFTY_ALLOWED_ORIGINS (unset)",
    ]);
    expect(forbiddenInProduction({ ...production, MAX_ROOMS: "lots" })).toEqual(["MAX_ROOMS (unset)"]);
  });

  // Finish for launch §2.3 and the audit's S5: a Fly Machine must say so.
  it("refuses a Fly Machine without the Fly proxy rule", () => {
    expect(forbiddenInProduction({ ...production, FLY_APP_NAME: "floorfifty-api" })).toEqual([
      "FLOOR_FIFTY_PROXY (unset on Fly)",
    ]);
    expect(forbiddenInProduction({ ...production, FLY_APP_NAME: "floorfifty-api", FLOOR_FIFTY_PROXY: "caddy" })).toEqual([
      "FLOOR_FIFTY_PROXY (unset on Fly)",
    ]);
    expect(forbiddenInProduction({ ...production, FLY_APP_NAME: "floorfifty-api", FLOOR_FIFTY_PROXY: "fly" })).toEqual(
      [],
    );
  });

  it("refuses a proxy rule it does not know", () => {
    expect(forbiddenInProduction({ ...production, FLOOR_FIFTY_PROXY: "nginx" })).toEqual(["FLOOR_FIFTY_PROXY (invalid)"]);
    expect(forbiddenInProduction({ ...production, FLOOR_FIFTY_PROXY: "caddy" })).toEqual([]);
  });

  it("refuses a Fly Machine that is not in production, whatever else is set", () => {
    expect(forbiddenInProduction({ FLY_APP_NAME: "floorfifty-api", FLOOR_FIFTY_PROXY: "fly" })).toEqual([
      "NODE_ENV (not production on Fly)",
    ]);
    expect(forbiddenInProduction({ FLY_APP_NAME: "floorfifty-api", NODE_ENV: "development" })).toEqual([
      "NODE_ENV (not production on Fly)",
    ]);
  });

  it("allows a test-driven server anything outside production, as the browser suite runs one", () => {
    expect(forbiddenInProduction({ FLOOR_FIFTY_TEST_DRIVER_TOKEN: "x", FLOOR_FIFTY_TELEMETRY: "1" })).toEqual([]);
  });

  // Audit S5: every guard above hung on NODE_ENV=production, so a server started
  // without it was open to every origin, whatever else it was given. A server
  // that is not driven by the browser suite is a public one, so it needs its
  // origin list whatever NODE_ENV says. (A rule changed: the old test here was
  // "allows anything outside production", which pinned the open start.)
  describe("a server that is not in production and not test-driven", () => {
    it("refuses to start without an origin list, whatever NODE_ENV says", () => {
      expect(forbiddenInProduction({})).toEqual(["FLOOR_FIFTY_ALLOWED_ORIGINS (unset)"]);
      expect(forbiddenInProduction({ NODE_ENV: "development" })).toEqual(["FLOOR_FIFTY_ALLOWED_ORIGINS (unset)"]);
      expect(forbiddenInProduction({ NODE_ENV: "staging", FLOOR_FIFTY_ALLOWED_ORIGINS: "  " })).toEqual([
        "FLOOR_FIFTY_ALLOWED_ORIGINS (unset)",
      ]);
    });

    it("starts with one, as staging does", () => {
      expect(forbiddenInProduction({ FLOOR_FIFTY_ALLOWED_ORIGINS: "https://staging.test" })).toEqual([]);
    });

    it("starts without one only when the test driver is on, as the browser suite runs it", () => {
      expect(forbiddenInProduction({ FLOOR_FIFTY_TEST_DRIVER_TOKEN: "e2e-driver-token" })).toEqual([]);
      expect(forbiddenInProduction({ FLOOR_FIFTY_TEST_DRIVER_TOKEN: "" })).toEqual(["FLOOR_FIFTY_ALLOWED_ORIGINS (unset)"]);
    });
  });
});

describe("crash handling (release readiness §5.5)", () => {
  const install = () => {
    const handlers = new Map<string, (error: unknown) => void>();
    const exit = vi.fn();
    const lines: string[] = [];
    installCrashHandlers({ on: (event, fn) => handlers.set(event, fn) }, exit, (line) => lines.push(line));
    return { handlers, exit, lines };
  };

  it("logs one fatal line, with the class and stack, and exits 1 on an unhandled rejection", () => {
    const { handlers, exit, lines } = install();
    handlers.get("unhandledRejection")!(new TypeError("boom"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as { event: string; class: string; stack: string };
    expect(line).toMatchObject({ event: "fatal", class: "TypeError" });
    expect(line.stack).toContain("boom");
  });

  it("does the same for an uncaught exception, and for a thrown non-error", () => {
    const { handlers, exit, lines } = install();
    handlers.get("uncaughtException")!("a string");
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "fatal", class: "Error" });
  });
});
