/**
 * unlocks.toml (unlockables spec §4.1): the content validator refuses an
 * entry whose ID has no predicate in the shared conditions.
 */
import { describe, expect, it } from "vitest";
import { unlocksSchema } from "../../../packages/content/src/schema/unlocks";

describe("the unlocks schema", () => {
  it("accepts an entry whose ID has a predicate", () => {
    expect(unlocksSchema.safeParse({ unlocks: [{ id: "games-5", hint: "Finish 5 races", goal: 5 }] }).success).toBe(true);
  });

  it("refuses an entry whose ID has no predicate, naming where predicates live", () => {
    const result = unlocksSchema.safeParse({ unlocks: [{ id: "games-500", hint: "Finish 500 races", goal: 500 }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("packages/shared/src/unlocks/conditions.ts");
  });
});
