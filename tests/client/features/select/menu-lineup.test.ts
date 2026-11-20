// @vitest-environment node
import { describe, expect, it } from "vitest";
import { afterSeeing, lineupSheet, menuLineup } from "../../../../apps/client/src/features/select/menu-lineup";

const own = { characterId: "frog", colour: "violet" } as const;

describe("the title's lineup", () => {
  it("puts you in front, then the players you saw, most recent first", () => {
    const seen = [
      { id: "r1-p2", characterId: "diver", colour: "cyan" },
      { id: "r1-p3", characterId: "robo", colour: "violet" },
      { id: "r0-p2", characterId: "ninja", colour: "gold" },
    ] as const;
    expect(menuLineup(own, seen)).toEqual([
      own,
      { characterId: "diver", colour: "cyan" },
      { characterId: "robo", colour: "violet" },
      { characterId: "ninja", colour: "gold" },
    ]);
  });

  it("fills a new player's empty places with ninjas in the colours not yet on the ledge", () => {
    expect(menuLineup(own, [])).toEqual([
      own,
      { characterId: "ninja", colour: "scarlet" },
      { characterId: "ninja", colour: "cyan" },
      { characterId: "ninja", colour: "gold" },
    ]);
  });

  it("draws ? as the ninja, in its colour", () => {
    expect(lineupSheet({ characterId: "?", colour: "gold" })).toBe("/assets/production/ninja-gold.png");
    expect(lineupSheet({ characterId: "kitsune", colour: "cyan" })).toBe("/assets/production/kitsune-cyan.png");
  });
});

describe("remembering who you saw", () => {
  it("puts the room's other players first, in seat order, then those from before, three at most", () => {
    const before = [
      { id: "r0-p2", characterId: "ninja", colour: "gold" },
      { id: "r0-p3", characterId: "frog", colour: "cyan" },
    ] as const;
    const others = [
      { id: "r1-p2", characterId: "diver", colour: "scarlet" },
      { id: "r1-p3", characterId: "robo", colour: "violet" },
    ] as const;
    expect(afterSeeing(before, others)).toEqual([...others, before[0]]);
  });

  it("updates a player seen again in place, and says nothing when nothing changed", () => {
    const seen = [{ id: "r1-p2", characterId: "diver", colour: "scarlet" }] as const;
    expect(afterSeeing(seen, [{ id: "r1-p2", characterId: "diver", colour: "scarlet" }])).toBeUndefined();
    expect(afterSeeing(seen, [{ id: "r1-p2", characterId: "frog", colour: "scarlet" }])).toEqual([
      { id: "r1-p2", characterId: "frog", colour: "scarlet" },
    ]);
  });
});
