// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runI18n } from "../../../../tools/i18n/cli";

// The release refuses an unreviewed string (`pnpm release:check --release`).
// Checking the same thing here makes a pull request that adds or changes a
// translation write its review records before it merges, not on release day.
describe("every committed translation has a current review (languages spec §7)", () => {
  it("passes `i18n:check --release` on the files in the repo", async () => {
    const lines: string[] = [];
    const code = await runI18n(["check", "--release"], {
      root: resolve(__dirname, "../../../.."),
      now: () => new Date(0),
      log: (line) => lines.push(line),
    });
    expect(lines.join("\n"), "write the review records (docs/i18n/README.md) for these keys").toBe(
      "every locale complete and reviewed",
    );
    expect(code).toBe(0);
  });
});
