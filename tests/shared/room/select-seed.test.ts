import { describe, expect, it } from "vitest";
import { pickSeedCommandSchema } from "@floor-fifty/shared/common/schemas";
import { formatSeed, isSeed, SEED_MAX, seedChoiceFromWire, seedChoiceToWire } from "@floor-fifty/shared/room/select";

describe("seeds (stage seeds spec §2)", () => {
  it("are whole numbers from 0 to 999 999", () => {
    expect([0, 1, 999_999].every(isSeed)).toBe(true);
    expect([-1, 1_000_000, 1.5, Number.NaN, "5"].some(isSeed)).toBe(false);
  });

  it("show as # and six digits", () => {
    expect(formatSeed(48213)).toBe("#048213");
    expect(formatSeed(SEED_MAX)).toBe("#999999");
    expect(formatSeed(0)).toBe("#000000");
  });

  it("round-trip through the wire's string, and read anything else as random", () => {
    for (const choice of ["random", "classic", 0, 48213, 999_999] as const) expect(seedChoiceFromWire(seedChoiceToWire(choice))).toBe(choice);
    for (const junk of ["", "abc", "-1", "1000000", "1.5", "0x10"]) expect(seedChoiceFromWire(junk)).toBe("random");
  });

  it("are refused on the wire outside the bounds", () => {
    const parse = (seed: unknown) => pickSeedCommandSchema.safeParse({ requestId: "r1", seed }).success;
    expect([parse("random"), parse("classic"), parse(0), parse(999_999)]).toEqual([true, true, true, true]);
    expect([parse(-1), parse(1_000_000), parse(1.5), parse("12"), parse("Random"), parse(undefined)]).toEqual([false, false, false, false, false, false]);
  });
});
