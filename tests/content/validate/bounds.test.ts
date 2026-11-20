/**
 * Tuning bounds validation.
 *
 * The shared declarations are the only source of truth for a range, so these
 * tests check that the compiler reads them rather than restates them -- and
 * that a code-only invariant is refused with a reason, not as a typo.
 */

import { describe, expect, it } from "vitest";
import { AUTHORING_INVARIANTS, validateBounds } from "@floor-fifty/content/validate/bounds";
import { TUNABLES, resolveTuning } from "@floor-fifty/shared/common/tuning";
import { parsedWithBase, parsedWithMode, validParsed } from "../support";

describe("validateBounds", () => {
  it("accepts a complete, in-range base and partial overrides", () => {
    expect(validateBounds(validParsed(), TUNABLES)).toEqual([]);
  });

  it("requires complete base tuning and validates partial override types/ranges", () => {
    expect(validateBounds(parsedWithBase({}), TUNABLES)).toContainEqual(
      expect.objectContaining({ code: "missingField", keyPath: "COURSE_FLOOR_COUNT" }),
    );
    expect(validateBounds(parsedWithMode({ COURSE_FLOOR_COUNT: 20.5 }), TUNABLES)).toContainEqual(
      expect.objectContaining({ code: "invalidType" }),
    );
    expect(validateBounds(parsedWithMode({ TICK_HZ: 30 }), TUNABLES)).toContainEqual(
      expect.objectContaining({ code: "invariantNotAuthorable" }),
    );
  });

  it("accepts inclusive endpoints and refuses one step beyond", () => {
    expect(validateBounds(parsedWithMode({ GRAVITY: TUNABLES.GRAVITY.min }), TUNABLES)).toEqual([]);
    expect(validateBounds(parsedWithMode({ GRAVITY: TUNABLES.GRAVITY.max }), TUNABLES)).toEqual([]);
    expect(
      validateBounds(parsedWithMode({ GRAVITY: TUNABLES.GRAVITY.min - 1 }), TUNABLES),
    ).toContainEqual(expect.objectContaining({ code: "outOfRange", keyPath: "GRAVITY" }));
  });

  it("names an unknown tunable as unknown and an invariant as unauthorable", () => {
    expect(validateBounds(parsedWithMode({ GRAVTIY: -275 }), TUNABLES)).toContainEqual(
      expect.objectContaining({ code: "unknownField", keyPath: "GRAVTIY" }),
    );
    for (const invariant of AUTHORING_INVARIANTS) {
      expect(invariant in TUNABLES).toBe(false);
    }
  });

  it("accepts a base transcribed from the declarations", () => {
    expect(validateBounds(parsedWithBase(resolveTuning()), TUNABLES)).toEqual([]);
  });
});
