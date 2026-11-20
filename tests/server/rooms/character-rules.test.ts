import { describe, expect, it } from "vitest";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { applyCharacterFallback, pickCharacter, pickColour, resolveRandomCharacters } from "../../../apps/server/src/rooms/character-rules";
import { nextRace, setReady, startRace } from "../../../apps/server/src/rooms/lobby-rules";
import { RoomCommandError } from "../../../apps/server/src/rooms/room-errors";

const HOST = asPlayerId("room-p1");
const GUEST = asPlayerId("room-p2");
const EVERYONE: AccessSets = { stages: [], songs: [], characters: ["ninja", "frog", "diver", "robo", "kitsune"] };
const NINJA_ONLY: AccessSets = { stages: [], songs: [], characters: ["ninja"] };

function lobby(...ids: PlayerId[]): RaceState {
  return createRaceState({ seed: 7, lapCount: 1, tuning: resolveTuning(), players: ids.map((id) => ({ id, name: asPlayerName(id) })) });
}

function refusal(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof RoomCommandError) return error.code;
    throw error;
  }
  return undefined;
}

describe("pickCharacter", () => {
  it("dresses the seat in an accessible body", () => {
    const race = lobby(HOST);
    pickCharacter(race, HOST, "frog", EVERYONE);
    expect(race.players[HOST]!.characterId).toBe("frog");
  });

  it("refuses a body outside the seat's access", () => {
    const race = lobby(HOST);
    expect(refusal(() => pickCharacter(race, HOST, "robo", NINJA_ONLY))).toBe("MALFORMED_MESSAGE");
    expect(race.players[HOST]!.characterId).toBe("ninja");
  });

  it("refuses while ready, and allows again once unready", () => {
    const race = lobby(HOST, GUEST);
    setReady(race, HOST, true);
    expect(refusal(() => pickCharacter(race, HOST, "frog", EVERYONE))).toBe("MALFORMED_MESSAGE");
    setReady(race, HOST, false);
    pickCharacter(race, HOST, "frog", EVERYONE);
    expect(race.players[HOST]!.characterId).toBe("frog");
  });

  it("refuses outside the lobby", () => {
    const race = lobby(HOST);
    setReady(race, HOST, true); // one seat: straight to select
    expect(race.phase).toBe("select");
    expect(refusal(() => pickCharacter(race, HOST, "ninja", EVERYONE))).toBe("MALFORMED_MESSAGE");
  });

  it("takes ? as a pick", () => {
    const race = lobby(HOST);
    pickCharacter(race, HOST, "?", EVERYONE);
    expect(race.players[HOST]!.characterId).toBe("?");
  });
});

describe("applyCharacterFallback", () => {
  it("drops a character the seat no longer has, to the first it does", () => {
    const race = lobby(HOST);
    race.players[HOST]!.characterId = "robo";
    applyCharacterFallback(race, HOST, NINJA_ONLY);
    expect(race.players[HOST]!.characterId).toBe("ninja");
  });

  it("keeps ? and keeps an accessible body", () => {
    const race = lobby(HOST, GUEST);
    race.players[HOST]!.characterId = "?";
    race.players[GUEST]!.characterId = "frog";
    applyCharacterFallback(race, HOST, NINJA_ONLY);
    applyCharacterFallback(race, GUEST, EVERYONE);
    expect(race.players[HOST]!.characterId).toBe("?");
    expect(race.players[GUEST]!.characterId).toBe("frog");
  });

  it("falls back to the ninja when the report names no character at all", () => {
    const race = lobby(HOST);
    race.players[HOST]!.characterId = "frog";
    applyCharacterFallback(race, HOST, { stages: [], songs: [], characters: [] });
    expect(race.players[HOST]!.characterId).toBe("ninja");
  });
});

describe("? resolves deterministically", () => {
  const resolved = (seed: number): string => {
    const race = createRaceState({ seed, lapCount: 1, tuning: resolveTuning(), players: [{ id: HOST, name: asPlayerName("h") }] });
    race.players[HOST]!.characterId = "?";
    resolveRandomCharacters(race, () => EVERYONE);
    return race.players[HOST]!.characterId;
  };

  it("gives the same body for the same seed and round", () => {
    expect(resolved(11)).toBe(resolved(11));
    expect(EVERYONE.characters).toContain(resolved(11));
  });

  it("gives the only body a seat can have", () => {
    const race = lobby(HOST);
    race.players[HOST]!.characterId = "?";
    resolveRandomCharacters(race, () => NINJA_ONLY);
    expect(race.players[HOST]!.characterId).toBe("ninja");
  });

  it("keeps the resolved body, not ?, on race again, and counts the round", () => {
    const race = lobby(HOST);
    race.players[HOST]!.characterId = "?";
    resolveRandomCharacters(race, () => EVERYONE);
    const body = race.players[HOST]!.characterId;
    const started = startRace(race);
    expect(started.round).toBe(1);
    expect(started.players[HOST]!.characterId).toBe(body);
    const finished = { ...started, phase: "finished" as const };
    const again = nextRace(finished);
    expect(again.players[HOST]!.characterId).toBe(body);
    expect(again.round).toBe(1);
    expect(again.players[HOST]!.ready).toBe(false);
  });
});

describe("pickColour", () => {
  it("dresses a player in a colour nobody holds", () => {
    const race = lobby(HOST, GUEST);
    pickColour(race, GUEST, "gold");
    expect(race.players[GUEST]!.colour).toBe("gold");
  });

  it("refuses a colour another player holds", () => {
    const race = lobby(HOST, GUEST);
    expect(refusal(() => pickColour(race, GUEST, "scarlet"))).toBe("MALFORMED_MESSAGE");
    expect(race.players[GUEST]!.colour).toBe("cyan");
  });

  it("refuses while ready, and outside the ready room", () => {
    const race = lobby(HOST, GUEST);
    race.players[GUEST]!.ready = true;
    expect(refusal(() => pickColour(race, GUEST, "gold"))).toBe("MALFORMED_MESSAGE");
    const racing: RaceState = { ...lobby(HOST, GUEST), phase: "racing" };
    expect(refusal(() => pickColour(racing, GUEST, "gold"))).toBe("MALFORMED_MESSAGE");
  });

  it("accepts the colour already worn", () => {
    const race = lobby(HOST, GUEST);
    pickColour(race, HOST, "scarlet");
    expect(race.players[HOST]!.colour).toBe("scarlet");
  });
});

describe("the character roulette's seed", () => {
  // Review finding 2: the course seed is now a stage's frozen one, the same in
  // every room, so a draw seeded from it made ? a known outcome. The roulette
  // is seeded from the room seed (select spec §5.3).
  it("draws from the room seed, not the course seed", () => {
    const drawn = new Set<string>();
    for (let roomSeed = 1; roomSeed <= 40; roomSeed += 1) {
      const race = createRaceState({ seed: 35229, roomSeed, lapCount: 1, tuning: resolveTuning(), players: [{ id: HOST, name: asPlayerName("h") }] });
      race.players[HOST]!.characterId = "?";
      resolveRandomCharacters(race, () => EVERYONE);
      drawn.add(race.players[HOST]!.characterId);
    }
    expect(drawn.size).toBeGreaterThan(1);
  });
});
