import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsSchema } from "../../../../apps/client/src/features/profile/settings";

describe("trajectory guide settings", () => {
  it("defaults trajectoryGuide to true in display settings", () => {
    expect(DEFAULT_SETTINGS.display.trajectoryGuide).toBe(true);
  });

  it("parses and validates trajectoryGuide setting", () => {
    const parsed = settingsSchema.parse({
      version: 2,
      display: { trajectoryGuide: false },
    });
    expect(parsed.display.trajectoryGuide).toBe(false);
  });

  it("falls back to default when trajectoryGuide is missing or invalid", () => {
    const parsed = settingsSchema.parse({
      version: 2,
      display: {},
    });
    expect(parsed.display.trajectoryGuide).toBe(true);
  });
});
