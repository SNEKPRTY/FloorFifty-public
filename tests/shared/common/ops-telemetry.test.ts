import { describe, expect, it } from "vitest";
import { opsEventSchema } from "@floor-fifty/shared/common/ops-telemetry";

const common = {
  buildId: "202610041200-abc1234",
  rulesetRevision: "r".repeat(64),
  contentRevision: "c".repeat(64),
  deviceClass: "phone",
  load: "0123456789abcdef",
};

describe("operational telemetry events (release readiness §7.1)", () => {
  it.each([
    { event: "boot", stage: "content", ok: false },
    { event: "boot", stage: "ready", ok: true },
    { event: "asset-failure", alias: "music.main-menu" },
    { event: "socket", state: "close", code: 4001 },
    { event: "socket", state: "gave-up" },
    { event: "phase", phase: "racing" },
    { event: "fatal", class: "TypeError", screen: "Gameplay" },
    { event: "rejection", class: "EncodingError", screen: "Gameplay" },
    // Audit S23: a refusal the player was shown, by its code.
    { event: "refusal", code: "VERSION_MISMATCH" },
  ])("accepts %j", (event) => {
    expect(opsEventSchema.safeParse({ ...event, ...common }).success).toBe(true);
  });

  it.each(["name", "roomCode", "token", "ip", "input", "message"])("refuses any %s field", (field) => {
    expect(opsEventSchema.safeParse({ event: "phase", phase: "racing", ...common, [field]: "x" }).success).toBe(false);
  });

  it("refuses a message dressed as a class", () => {
    expect(
      opsEventSchema.safeParse({ event: "fatal", class: "Cannot read properties of undefined", screen: "Gameplay", ...common })
        .success,
    ).toBe(false);
  });

  it("refuses a refusal that carries prose, a room code or anything that is not an identifier", () => {
    for (const code of ["There is no room with that code.", "ABC 234", "room ABC234 not found", ""]) {
      expect(opsEventSchema.safeParse({ event: "refusal", code, ...common }).success).toBe(false);
    }
  });

  // Audit S27: a crash may carry one short reason, and nothing longer or wider.
  it("accepts a crash with a short one-line reason", () => {
    expect(
      opsEventSchema.safeParse({ event: "fatal", class: "TypeError", screen: "Gameplay", reason: "Invalid array length", ...common }).success,
    ).toBe(true);
  });

  it.each([
    ["a reason over 120 characters", "x".repeat(121)],
    ["a reason with a second line, which could be a stack", "first\nat foo (bar.js:1:2)"],
  ])("refuses %s", (_label, reason) => {
    expect(opsEventSchema.safeParse({ event: "fatal", class: "TypeError", screen: "Gameplay", reason, ...common }).success).toBe(false);
  });

  it("gives no other event a reason", () => {
    expect(opsEventSchema.safeParse({ event: "rejection", class: "EncodingError", screen: "Gameplay", reason: "x", ...common }).success).toBe(false);
  });

  it("refuses a load id that could carry anything", () => {
    expect(opsEventSchema.safeParse({ event: "phase", phase: "racing", ...common, load: "Kite ABC234" }).success).toBe(
      false,
    );
  });

  it("refuses an event it does not know", () => {
    expect(opsEventSchema.safeParse({ event: "chat", ...common }).success).toBe(false);
  });
});
