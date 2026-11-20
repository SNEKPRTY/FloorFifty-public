import { describe, expect, it } from "vitest";
import { TICK_HZ, VIEWPORT } from "@floor-fifty/shared/common/constants";

describe("workspace contract", () => {
  it("exposes the fixed game clock and logical viewport", () => {
    expect(TICK_HZ).toBe(60);
    expect(VIEWPORT).toEqual({ width: 960, height: 540 });
  });

  // A build checks the committed content artifact against its sources first,
  // so a release can never ship content that no longer compiles from them
  // (launch polish program, Task 7.2; release readiness §6.6).
  it("verifies the content artifact before every build", async () => {
    const { readFile } = await import("node:fs/promises");
    const root = JSON.parse(await readFile("../../package.json", "utf8").catch(() => readFile("package.json", "utf8"))) as {
      scripts: Record<string, string>;
    };
    expect(root.scripts["prebuild"]).toBe("pnpm content:check --verify-artifact");
  });
});
