import { afterEach, describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const refusalOf = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => "",
    (error: unknown) => String((error as Error | undefined)?.message ?? error),
  );

describe("the join check (release readiness §4.2)", () => {
  it("seats a join on another build of the same rules, and logs the skew", async () => {
    const lines: string[] = [];
    harness = await createColyseusHarness(4182, { telemetry: { log: (line) => lines.push(line) } });
    await harness.create("Kite", {
      buildId: "201001010000-aaaaaaa",
      rulesetRevision: GENERATED_CONTENT.rulesetRevision,
    });
    expect(harness.room.clients.length).toBe(1);
    const skew = lines.find((line) => line.includes("build-skew"));
    expect(skew).toContain("201001010000-aaaaaaa");
    // Nothing that names a player or a room: only the room's serial.
    expect(skew).not.toContain("Kite");
    expect(skew).not.toContain(harness.room.roomId);
  });

  it("seats a join on the same build and rules without a word", async () => {
    const lines: string[] = [];
    harness = await createColyseusHarness(4182, { telemetry: { log: (line) => lines.push(line) } });
    await harness.create("Kite", { buildId: "dev", rulesetRevision: GENERATED_CONTENT.rulesetRevision });
    expect(lines.some((line) => line.includes("build-skew"))).toBe(false);
  });

  it("refuses a join on another ruleset with VERSION_MISMATCH", async () => {
    harness = await createColyseusHarness();
    const host = await harness.create("Kite");
    const refusal = await refusalOf(
      harness.joinById(host.roomId, "Late", { buildId: "201001010000-aaaaaaa", rulesetRevision: "not-this-one" }),
    );
    expect(refusal).toMatch(/out of date/);
  });

  // Which side should move is decided by build order (the shared verdict's
  // tests). A server built without a release id is unordered, so it never
  // claims to be the old one: it asks the client to reload.
  it("asks even a newer client to reload when the server is a dev build", async () => {
    harness = await createColyseusHarness();
    const host = await harness.create("Kite");
    const refusal = await refusalOf(
      harness.joinById(host.roomId, "Late", { buildId: "209912312359-fffffff", rulesetRevision: "not-this-one" }),
    );
    expect(refusal).toMatch(/out of date/);
    expect(refusal).not.toMatch(/server is updating/);
  });
});
