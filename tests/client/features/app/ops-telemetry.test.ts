// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { opsEventSchema } from "@floor-fifty/shared/common/ops-telemetry";
import { createOpsTelemetry, beaconSend } from "../../../../apps/client/src/features/app/ops-telemetry";

const facts = { buildId: "202610041200-abc1234", protocolVersion: 18, rulesetRevision: "r".repeat(64) };
const revisions = () => ({ contentRevision: "c".repeat(64) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the operational telemetry sender (release readiness §7.1)", () => {
  it("sends the build, revisions, device class and a per-load id with every event", () => {
    const sent: string[] = [];
    const telemetry = createOpsTelemetry({
      url: "http://x/telemetry",
      facts,
      revisions,
      deviceClass: () => "phone",
      send: (_url, body) => sent.push(body),
    });
    telemetry.report({ event: "phase", phase: "racing" });
    telemetry.report({ event: "fatal", class: "TypeError", screen: "Gameplay" });
    const [first, second] = sent.map((body) => opsEventSchema.parse(JSON.parse(body)));
    expect(first).toMatchObject({ buildId: facts.buildId, deviceClass: "phone", contentRevision: "c".repeat(64) });
    expect(first!.load).toBe(second!.load);
  });

  it("never throws when sending fails", () => {
    const telemetry = createOpsTelemetry({
      url: "u",
      facts,
      revisions,
      deviceClass: () => "phone",
      send: () => {
        throw new Error("blocked");
      },
    });
    expect(() => telemetry.report({ event: "phase", phase: "racing" })).not.toThrow();
  });

  it("drops an event that would not pass the server's schema, rather than send a name", () => {
    const send = vi.fn();
    const telemetry = createOpsTelemetry({ url: "u", facts, revisions, deviceClass: () => "phone", send });
    telemetry.report({ event: "fatal", class: "Cannot read properties of undefined", screen: "Gameplay" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the beacon", () => {
  it("falls back to a keepalive fetch when the beacon is refused, and swallows its failure", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => beaconSend("http://x/telemetry", "{}")).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledWith("http://x/telemetry", expect.objectContaining({ keepalive: true, method: "POST" }));
    await Promise.resolve();
  });

  it("survives a browser with no beacon at all", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", () => {
      throw new Error("no fetch either");
    });
    expect(() => beaconSend("http://x/telemetry", "{}")).not.toThrow();
  });
});
