// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Under the CSP (no 'unsafe-eval'), Pixi throws while building its renderer
// unless its no-eval build is in place first; the release smoke proved the
// page never boots without it (release readiness §6.3).
describe("the client under a CSP with no eval", () => {
  it("installs the no-eval builds before anything else is imported", () => {
    const main = readFileSync("apps/client/src/main.ts", "utf8");
    const firstImport = /^import .*$/m.exec(main)?.[0];
    expect(firstImport).toBe('import "./lib/no-eval";');
  });

  it("uses Pixi's no-eval build and zod's jitless mode", () => {
    const noEval = readFileSync("apps/client/src/lib/no-eval.ts", "utf8");
    expect(noEval).toContain('import "pixi.js/unsafe-eval";');
    expect(noEval).toContain("config({ jitless: true })");
  });
});
