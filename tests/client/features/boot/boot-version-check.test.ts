// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkBootVersion, startBootVersionCheck } from "../../../../apps/client/src/features/boot/boot-version-check";

const facts = { buildId: "202610041200-aaaaaaa", protocolVersion: 18, rulesetRevision: "r1" };

describe("the boot version check, started at boot", () => {
  // The check is advice; the join is the authority. A slow /health must
  // never hold the title back, so boot starts it and moves on.
  it("returns at once, and reports a stale build whenever the answer comes", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const reported: unknown[] = [];
    startBootVersionCheck(
      () => new Promise((resolve) => (answer = resolve)),
      facts,
      (error) => reported.push(error),
    );
    expect(reported).toEqual([]);
    answer({ ...facts, buildId: "202610051200-bbbbbbb", rulesetRevision: "r2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reported).toEqual([expect.objectContaining({ code: "VERSION_MISMATCH" })]);
  });

  it("reports nothing for a current build", async () => {
    const reported: unknown[] = [];
    startBootVersionCheck(async () => ({ ...facts }), facts, (error) => reported.push(error));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reported).toEqual([]);
  });
});

describe("the boot version check (release readiness §4.2)", () => {
  it("passes a server on the same rules", async () => {
    await expect(checkBootVersion(async () => ({ ...facts, ok: true }), facts)).resolves.toBeUndefined();
  });

  it("passes another build on the same rules", async () => {
    await expect(
      checkBootVersion(async () => ({ ...facts, buildId: "202610051200-bbbbbbb" }), facts),
    ).resolves.toBeUndefined();
  });

  it("asks for a reload when the server is newer", async () => {
    await expect(
      checkBootVersion(async () => ({ ...facts, buildId: "202610051200-bbbbbbb", rulesetRevision: "r2" }), facts),
    ).resolves.toMatchObject({ code: "VERSION_MISMATCH" });
  });

  it("says the server is updating when this client is newer", async () => {
    await expect(
      checkBootVersion(async () => ({ ...facts, buildId: "202610031200-bbbbbbb", protocolVersion: 17 }), facts),
    ).resolves.toMatchObject({ code: "SERVER_UPDATING" });
  });

  it("leaves the decision to the join when /health cannot be read", async () => {
    await expect(checkBootVersion(async () => { throw new Error("offline"); }, facts)).resolves.toBeUndefined();
    await expect(checkBootVersion(async () => ({ ok: true }), facts)).resolves.toBeUndefined();
    await expect(checkBootVersion(async () => "not json", facts)).resolves.toBeUndefined();
  });
});
