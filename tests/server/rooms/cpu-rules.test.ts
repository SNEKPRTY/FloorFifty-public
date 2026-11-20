import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, QUICK_MATCH_START_TICKS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomAccess } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { PERSONALITIES } from "@floor-fifty/shared/cpu/personalities";
import { addCpu, cpuCount, fillCpus, fillsOnReady, removeCpu, startClockRanOut } from "../../../apps/server/src/rooms/cpu-rules";
import { evaluateQuickMatch, evaluateReadiness, nextRace, setReady } from "../../../apps/server/src/rooms/lobby-rules";
import { RoomCommandError } from "../../../apps/server/src/rooms/room-errors";
import { openSets } from "@floor-fifty/shared/content/access";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { raceTuning } from "../../../apps/server/src/rooms/race-tuning";
import { advanceSelect, enterSelect, type SelectContext } from "../../../apps/server/src/rooms/select-rules";

const HOST = asPlayerId("room-p1");
const GUEST = asPlayerId("room-p2");
const OPEN = ["ninja"] as const;
/** Every character the catalogue has, earned and paid alike: what a CPU may wear. */
const ALL = ["ninja", "frog", "diver", "robo", "kitsune"] as const;

function lobby(access: RoomAccess, ...ids: PlayerId[]): RaceState {
  return createRaceState({ seed: 7, lapCount: 1, tuning: resolveTuning(), access, players: ids.map((id) => ({ id, name: asPlayerName(id) })) });
}
let next = 10;
const allocate = () => asPlayerId(`room-p${(next += 1)}`);
function refusal(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof RoomCommandError) return error.code;
    throw error;
  }
  return undefined;
}

describe("adding a CPU", () => {
  it("seats a ready, connected CPU in a free colour, named for that colour's personality", () => {
    const race = lobby("private", HOST);
    const id = addCpu(race, HOST, allocate, OPEN);
    const cpu = race.players[id]!;
    expect(cpu).toMatchObject({ cpu: true, ready: true, status: "connected", characterId: "ninja" });
    expect(cpu.colour).not.toBe(race.players[HOST]!.colour);
    expect(cpu.name).toBe(PERSONALITIES[cpu.colour].name);
    expect(cpuCount(race)).toBe(1);
  });

  it("draws its colour and character at random, from every character, earned and paid alike", () => {
    const colours = new Set<string>();
    const characters = new Set<string>();
    for (let roomSeed = 1; roomSeed <= 40; roomSeed += 1) {
      const race = createRaceState({ seed: 7, roomSeed, lapCount: 1, tuning: resolveTuning(), access: "private", players: [{ id: HOST, name: asPlayerName("Kite") }] });
      const cpu = race.players[addCpu(race, HOST, allocate, ALL)]!;
      colours.add(cpu.colour);
      characters.add(cpu.characterId);
    }
    // The host holds scarlet; every other colour turns up, and every character.
    expect([...colours].sort()).toEqual(["cyan", "gold", "violet"]);
    expect([...characters].sort()).toEqual([...ALL].sort());
  });

  it("draws the same CPU for the same room and seat, so a room's story is repeatable", () => {
    const seat = () => {
      const race = createRaceState({ seed: 7, roomSeed: 99, lapCount: 1, tuning: resolveTuning(), access: "private", players: [{ id: HOST, name: asPlayerName("Kite") }] });
      const cpu = race.players[addCpu(race, HOST, () => asPlayerId("room-p2"), ALL)]!;
      return { colour: cpu.colour, characterId: cpu.characterId };
    };
    expect(seat()).toEqual(seat());
  });

  it("is the host's alone", () => {
    expect(refusal(() => addCpu(lobby("private", HOST, GUEST), GUEST, allocate, OPEN))).toBe("NOT_HOST");
  });

  it("is refused in a public room, which fills itself", () => {
    expect(refusal(() => addCpu(lobby("public", HOST), HOST, allocate, OPEN))).toBe("MALFORMED_MESSAGE");
  });

  it("is refused outside the lobby", () => {
    const race = lobby("private", HOST);
    race.phase = "select";
    expect(refusal(() => addCpu(race, HOST, allocate, OPEN))).toBe("MALFORMED_MESSAGE");
  });

  it("is refused once every seat is taken", () => {
    const race = lobby("private", HOST);
    for (let seat = 1; seat < MAX_PLAYERS; seat += 1) addCpu(race, HOST, allocate, OPEN);
    expect(refusal(() => addCpu(race, HOST, allocate, OPEN))).toBe("ROOM_FULL");
    expect(Object.keys(race.players)).toHaveLength(MAX_PLAYERS);
  });

  it("never lets a CPU hold the room up: the host's own Ready still starts it", () => {
    const race = lobby("private", HOST);
    addCpu(race, HOST, allocate, OPEN);
    setReady(race, HOST, true);
    expect(race.phase).toBe("select");
  });
});

describe("removing a CPU", () => {
  it("frees its seat", () => {
    const race = lobby("private", HOST);
    const id = addCpu(race, HOST, allocate, OPEN);
    removeCpu(race, HOST, id);
    expect(race.players[id]).toBeUndefined();
  });

  it("refuses a guest, a human target and an unknown one", () => {
    const race = lobby("private", HOST, GUEST);
    const id = addCpu(race, HOST, allocate, OPEN);
    expect(refusal(() => removeCpu(race, GUEST, id))).toBe("NOT_HOST");
    expect(refusal(() => removeCpu(race, HOST, GUEST))).toBe("MALFORMED_MESSAGE");
    expect(refusal(() => removeCpu(race, HOST, asPlayerId("room-p99")))).toBe("MALFORMED_MESSAGE");
  });
});

describe("filling a public room", () => {
  it("fills on the lone racer's Ready, during the search and after it", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    expect(fillsOnReady(race, HOST)).toBe(true);
    race.tick = 100_000;
    expect(fillsOnReady(race, HOST)).toBe(true);
  });

  it("does not fill on Ready with company, or in a private room", () => {
    expect(fillsOnReady(lobby("public", HOST, GUEST), HOST)).toBe(false);
    expect(fillsOnReady(lobby("private", HOST), HOST)).toBe(false);
  });

  it("fills every empty seat, and then the lone racer's Ready opens select", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    expect(fillCpus(race, allocate, OPEN)).toHaveLength(MAX_PLAYERS - 1);
    setReady(race, HOST, true);
    expect(race.phase).toBe("select");
  });

  it("says when the start clock has run out, and only then", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    expect(startClockRanOut(race)).toBe(false);
    race.tick = QUICK_MATCH_START_TICKS;
    expect(startClockRanOut(race)).toBe(true);
    fillCpus(race, allocate, OPEN);
    evaluateQuickMatch(race);
    evaluateReadiness(race);
    expect(race.phase).toBe("select");
  });

  it("never counts a CPU as company for the clocks", () => {
    const race = lobby("public", HOST);
    fillCpus(race, allocate, OPEN);
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBeDefined();
  });
});

describe("Race again", () => {
  function finished(access: RoomAccess): RaceState {
    const race = lobby(access, HOST);
    if (access === "private") addCpu(race, HOST, allocate, OPEN);
    else fillCpus(race, allocate, OPEN);
    race.phase = "finished";
    return race;
  }

  it("keeps a private room's CPUs, ready, in their colours", () => {
    const next = nextRace(finished("private"));
    const cpus = Object.values(next.players).filter((player) => player.cpu);
    expect(cpus).toHaveLength(1);
    expect(cpus[0]!.ready).toBe(true);
    expect(cpus[0]!.name).toBe(PERSONALITIES[cpus[0]!.colour].name);
  });

  it("drops a public room's CPUs, so strangers can take the seats", () => {
    const next = nextRace(finished("public"));
    expect(Object.values(next.players).some((player) => player.cpu)).toBe(false);
    expect(Object.keys(next.players)).toEqual([HOST]);
  });
});

describe("select (CPU players spec D-C6)", () => {
  const ctx: SelectContext = {
    accessOf: () => openSets(GENERATED_CONTENT.content),
    stageCourse: (id) => raceTuning(GENERATED_CONTENT.content, id, "floors-20"),
  };

  it("gives a CPU no pick, so the roulette only ever lands on a person's", () => {
    const race = lobby("private", HOST);
    const cpu = addCpu(race, HOST, allocate, OPEN);
    race.phase = "select";
    enterSelect(race, ctx);
    expect(Object.keys(race.select!.picks)).toEqual([HOST]);
    race.select!.picks[HOST]!.locked = true;
    advanceSelect(race, ctx);
    expect(race.select!.stage!.pickedBy).toBe(HOST);
    expect(race.select!.stage!.pickedBy).not.toBe(cpu);
  });
});
