import { describe, expect, it } from "vitest";
import { nextFreeColour, SEAT_COLOURS, type SeatColour } from "@floor-fifty/shared/common/seats";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { createRaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";

const taken = (...colours: SeatColour[]) => new Set<SeatColour>(colours);

describe("nextFreeColour", () => {
  it("is the first colour nobody holds, in seat-colour order", () => {
    expect(nextFreeColour(taken())).toBe("scarlet");
    expect(nextFreeColour(taken("scarlet", "cyan"))).toBe("gold");
  });

  it("steps on from a colour, wrapping, skipping those held", () => {
    expect(nextFreeColour(taken("cyan"), "scarlet")).toBe("gold");
    expect(nextFreeColour(taken(), "violet")).toBe("scarlet");
    expect(nextFreeColour(taken("scarlet"), "violet")).toBe("cyan");
  });

  it("is none when all four are held", () => {
    expect(nextFreeColour(taken(...SEAT_COLOURS))).toBeUndefined();
    expect(nextFreeColour(taken("cyan", "gold", "violet"), "scarlet")).toBeUndefined();
  });
});

describe("createRaceState", () => {
  it("colours its players in seat order", () => {
    const state = createRaceState({
      seed: 1,
      lapCount: 1,
      tuning: resolveTuning(),
      players: [
        { id: asPlayerId("a"), name: asPlayerName("A") },
        { id: asPlayerId("b"), name: asPlayerName("B") },
      ],
    });
    expect(Object.values(state.players).map((player) => player.colour)).toEqual(["scarlet", "cyan"]);
  });
});
