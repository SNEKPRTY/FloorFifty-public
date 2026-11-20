import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { DeviceClass } from "@floor-fifty/shared/common/protocol";

const tuning = resolveTuning();
const A = asPlayerId("p1");
const B = asPlayerId("p2");

/** Two bots climb the same seed; returns every tick's positions and the finish. */
function race(
  characters: Record<string, string>,
  colours: Record<string, SeatColour> = {},
  devices: Record<string, DeviceClass> = {},
): { trace: string[]; finishedAt: number | undefined } {
  const base = createRaceState({
    seed: 4182,
    lapCount: 1,
    tuning,
    players: [
      { id: A, name: asPlayerName("A") },
      { id: B, name: asPlayerName("B") },
    ],
  });
  for (const [id, characterId] of Object.entries(characters)) base.players[id as typeof A]!.characterId = characterId;
  for (const [id, colour] of Object.entries(colours)) base.players[id as typeof A]!.colour = colour;
  for (const [id, deviceClass] of Object.entries(devices)) base.players[id as typeof A]!.deviceClass = deviceClass;
  let state: RaceState = { ...base, phase: "racing", raceStartedAtTick: 0 };
  const bots = [createClimbController(A), createClimbController(B)];
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  const trace: string[] = [];
  for (let tick = 0; tick < TICK_HZ * 120 && state.phase !== "finished"; tick += 1) {
    const inputs = new Map();
    for (const [index, bot] of bots.entries()) {
      const input = bot.next(state, tick + 1);
      if (input !== undefined) inputs.set(index === 0 ? A : B, input);
    }
    state = simulation.step({ ...state, tick: state.tick + 1 }, inputs).state;
    trace.push(Object.values(state.players).map((player) => `${player.x.toFixed(6)},${player.y.toFixed(6)}`).join("|"));
  }
  simulation.dispose();
  return { trace, finishedAt: state.phase === "finished" ? state.tick : undefined };
}

describe("a character is cosmetic", () => {
  it("never changes a race: two races differing only in characterId are tick-identical", () => {
    const plain = race({ [A]: "ninja", [B]: "ninja" });
    const dressed = race({ [A]: "frog", [B]: "kitsune" });
    // The probe must compare a real climb, not two empty runs.
    expect(plain.trace.length).toBeGreaterThan(TICK_HZ);
    expect(dressed.finishedAt).toBe(plain.finishedAt);
    expect(dressed.trace).toEqual(plain.trace);
  });

  it("a colour never changes a race either: two races differing only in colour are tick-identical", () => {
    const plain = race({ [A]: "ninja", [B]: "ninja" });
    const recoloured = race({ [A]: "ninja", [B]: "ninja" }, { [A]: "violet", [B]: "gold" });
    expect(plain.trace.length).toBeGreaterThan(TICK_HZ);
    expect(recoloured.finishedAt).toBe(plain.finishedAt);
    expect(recoloured.trace).toEqual(plain.trace);
  });

  it("a device class never changes a race: two races differing only in it are tick-identical (unlockables spec §3)", () => {
    const desktops = race({ [A]: "ninja", [B]: "ninja" }, {}, { [A]: "desktop", [B]: "desktop" });
    const mixed = race({ [A]: "ninja", [B]: "ninja" }, {}, { [A]: "phone", [B]: "tablet" });
    expect(desktops.trace.length).toBeGreaterThan(TICK_HZ);
    expect(mixed.finishedAt).toBe(desktops.finishedAt);
    expect(mixed.trace).toEqual(desktops.trace);
  });
});
