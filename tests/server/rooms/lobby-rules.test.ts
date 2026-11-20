import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import { createRaceState, spawnPosition, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import {
  acceptsInput,
  countdownElapsed,
  evaluateReadiness,
  isPreRace,
  nextHost,
  nextRace,
  setClock,
  setLapCount,
  setMode,
  setReady,
  startRace,
} from "../../../apps/server/src/rooms/lobby-rules";
import { RoomCommandError } from "../../../apps/server/src/rooms/room-errors";

const HOST = asPlayerId("room-p1");
const GUEST = asPlayerId("room-p2");
const THIRD = asPlayerId("room-p3");

/** A fresh lobby with these players seated, the first of them hosting. */
function lobby(...ids: PlayerId[]): RaceState {
  return createRaceState({
    seed: 7,
    lapCount: 1,
    tuning: resolveTuning(),
    players: ids.map((id) => ({ id, name: asPlayerName(id) })),
  });
}

/** The code a rule refused with, or undefined if it did not refuse. */
function refusal(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof RoomCommandError) return error.code;
    throw error;
  }
  return undefined;
}

describe("the phases", () => {
  it("counts only the lobby as before the race", () => {
    expect(isPreRace({ phase: "lobby" })).toBe(true);
    expect(isPreRace({ phase: "select" })).toBe(false);
    expect(isPreRace({ phase: "countdown" })).toBe(false);
    expect(isPreRace({ phase: "racing" })).toBe(false);
    expect(isPreRace({ phase: "finished" })).toBe(false);
  });

  it("takes input from the countdown until the race finishes", () => {
    expect(acceptsInput({ phase: "lobby" })).toBe(false);
    expect(acceptsInput({ phase: "countdown" })).toBe(true);
    expect(acceptsInput({ phase: "racing" })).toBe(true);
    expect(acceptsInput({ phase: "finished" })).toBe(false);
  });
});

describe("readiness", () => {
  it("opens select once every connected racer is ready", () => {
    const race = lobby(HOST, GUEST);
    setReady(race, HOST, true);
    expect(race.phase).toBe("lobby");

    setReady(race, GUEST, true);
    expect(race.phase).toBe("select");
    expect(race.countdownEndsAtTick).toBeUndefined();
  });

  it("does not wait for a racer who dropped", () => {
    const race = lobby(HOST, GUEST);
    race.players[GUEST]!.status = "ghost";
    setReady(race, HOST, true);
    expect(race.phase).toBe("select");
  });

  it("refuses un-readying once select has opened", () => {
    const race = lobby(HOST, GUEST);
    setReady(race, HOST, true);
    setReady(race, GUEST, true);
    expect(refusal(() => setReady(race, GUEST, false))).toBe("MALFORMED_MESSAGE");
    expect(race.phase).toBe("select");
  });

  it("never counts down a room with nobody connected", () => {
    const race = lobby(HOST);
    race.players[HOST]!.status = "ghost";
    race.players[HOST]!.ready = true;
    evaluateReadiness(race);
    expect(race.phase).toBe("lobby");
  });

  it("leaves a race that has begun alone", () => {
    const race = lobby(HOST);
    race.phase = "racing";
    race.players[HOST]!.ready = false;
    evaluateReadiness(race);
    expect(race.phase).toBe("racing");
  });

  it("refuses a readiness change once the race has begun", () => {
    const race = lobby(HOST);
    race.phase = "racing";
    expect(refusal(() => setReady(race, HOST, true))).toBe("MALFORMED_MESSAGE");
  });

  it("refuses readiness for a player who is not in the room", () => {
    const race = lobby(HOST);
    expect(refusal(() => setReady(race, GUEST, true))).toBe("INVALID_ROOM");
  });
});

describe("the countdown", () => {
  it("has not elapsed in the lobby", () => {
    expect(countdownElapsed(lobby(HOST))).toBe(false);
  });

  it("elapses on the tick it was set to end", () => {
    const race = lobby(HOST);
    // Readiness now opens select; the select rules reach the countdown.
    race.phase = "countdown";
    race.countdownEndsAtTick = race.tick + COUNTDOWN_TICKS;
    race.tick = race.countdownEndsAtTick! - 1;
    expect(countdownElapsed(race)).toBe(false);
    race.tick = race.countdownEndsAtTick!;
    expect(countdownElapsed(race)).toBe(true);
  });
});

describe("lap count", () => {
  it("lets the host choose in the lobby", () => {
    const race = lobby(HOST, GUEST);
    setLapCount(race, HOST, 3, [1, 3]);
    expect(race.lapCount).toBe(3);
  });

  it("tells a guest they are not the host, whatever the phase", () => {
    const race = lobby(HOST, GUEST);
    race.phase = "racing";
    expect(refusal(() => setLapCount(race, GUEST, 3, [1, 3]))).toBe("NOT_HOST");
  });

  it("refuses the host once the lobby has closed", () => {
    const race = lobby(HOST);
    setReady(race, HOST, true);
    expect(refusal(() => setLapCount(race, HOST, 3, [1, 3]))).toBe("MALFORMED_MESSAGE");
    expect(race.lapCount).toBe(1);
  });
});

const MODES = [
  { id: "floors-20", laps: [1, 3] },
  { id: "floors-50", laps: [1] },
  { id: "infinite", laps: [1], clocks: [60, 180, 300] },
] as const;

describe("mode (race-options spec §3.2)", () => {
  it("starts on the default mode", () => {
    expect(lobby(HOST).modeId).toBe("floors-20");
  });

  it("lets the host choose in the lobby", () => {
    const race = lobby(HOST, GUEST);
    setMode(race, HOST, "infinite", MODES);
    expect(race.modeId).toBe("infinite");
  });

  it("tells a guest they are not the host", () => {
    expect(refusal(() => setMode(lobby(HOST, GUEST), GUEST, "floors-50", MODES))).toBe("NOT_HOST");
  });

  it("refuses the host once the lobby has closed", () => {
    const race = lobby(HOST);
    setReady(race, HOST, true);
    expect(refusal(() => setMode(race, HOST, "floors-50", MODES))).toBe("MALFORMED_MESSAGE");
    expect(race.modeId).toBe("floors-20");
  });

  it("refuses a mode the catalog does not have", () => {
    expect(refusal(() => setMode(lobby(HOST), HOST, "sprint", MODES))).toBe("MALFORMED_MESSAGE");
  });

  it("drops the lap count to 1 when the new mode does not offer it", () => {
    const race = lobby(HOST);
    setLapCount(race, HOST, 3, [1, 3]);
    setMode(race, HOST, "floors-50", MODES);
    expect(race.lapCount).toBe(1);
  });

  it("keeps the lap count when the new mode offers it", () => {
    const race = lobby(HOST);
    setLapCount(race, HOST, 3, [1, 3]);
    setMode(race, HOST, "floors-20", MODES);
    expect(race.lapCount).toBe(3);
  });

  it("refuses a lap count the mode does not offer", () => {
    const race = lobby(HOST);
    setMode(race, HOST, "floors-50", MODES);
    expect(refusal(() => setLapCount(race, HOST, 3, [1]))).toBe("MALFORMED_MESSAGE");
  });

  it("survives race again", () => {
    const race = lobby(HOST);
    setMode(race, HOST, "infinite", MODES);
    race.phase = "finished";
    expect(nextRace(race).modeId).toBe("infinite");
  });
});

describe("Survival's clock (survival spec §5)", () => {
  const CLOCKS = [60, 180, 300];

  it("starts at the default and lets the host pick an offered clock", () => {
    const race = lobby(HOST, GUEST);
    expect(race.clockSeconds).toBe(180);
    setClock(race, HOST, 60, CLOCKS);
    expect(race.clockSeconds).toBe(60);
  });

  it("refuses a guest", () => {
    expect(refusal(() => setClock(lobby(HOST, GUEST), GUEST, 60, CLOCKS))).toBe("NOT_HOST");
  });

  it("refuses a clock the mode does not offer, and any clock outside the lobby", () => {
    expect(refusal(() => setClock(lobby(HOST), HOST, 90, CLOCKS))).toBe("MALFORMED_MESSAGE");
    const racing = lobby(HOST);
    racing.phase = "racing";
    expect(refusal(() => setClock(racing, HOST, 60, CLOCKS))).toBe("MALFORMED_MESSAGE");
  });

  it("resets to the default when the new mode does not offer it", () => {
    const race = lobby(HOST);
    race.clockSeconds = 90;
    setMode(race, HOST, "infinite", MODES);
    expect(race.clockSeconds).toBe(180);
  });

  it("resets to the mode's first clock when it does not offer the default", () => {
    const race = lobby(HOST);
    race.clockSeconds = 90;
    setMode(race, HOST, "short", [{ id: "short", laps: [1], clocks: [60, 120] }]);
    expect(race.clockSeconds).toBe(60);
  });

  it("keeps an offered clock across a mode change and into the next race", () => {
    const race = lobby(HOST);
    setClock(race, HOST, 300, CLOCKS);
    setMode(race, HOST, "floors-20", MODES);
    setMode(race, HOST, "infinite", MODES);
    race.phase = "finished";
    expect(nextRace(race).clockSeconds).toBe(300);
  });
});

describe("starting a race", () => {
  it("puts every racer back on the start, keeping status and readiness", () => {
    const race = lobby(HOST, GUEST);
    setReady(race, HOST, true);
    setReady(race, GUEST, true);
    race.phase = "countdown";
    race.countdownEndsAtTick = race.tick + COUNTDOWN_TICKS;
    race.players[GUEST]!.status = "ghost";
    race.players[HOST]!.x += 100;
    race.tick = race.countdownEndsAtTick!;

    const started = startRace(race);

    expect(started.phase).toBe("racing");
    expect(started.raceStartedAtTick).toBe(race.tick);
    expect(started.countdownEndsAtTick).toBeUndefined();
    expect(started.players[HOST]!.x).toBe(spawnPosition(race.course, race.tuning).x);
    expect(started.players[HOST]!.ready).toBe(true);
    expect(started.players[GUEST]!.status).toBe("ghost");
  });

  it("leaves the race it started from untouched", () => {
    const race = lobby(HOST);
    setReady(race, HOST, true);
    race.phase = "countdown";
    race.countdownEndsAtTick = race.tick + COUNTDOWN_TICKS;
    race.players[HOST]!.x += 100;
    const movedX = race.players[HOST]!.x;

    startRace(race);

    expect(race.phase).toBe("countdown");
    expect(race.players[HOST]!.x).toBe(movedX);
  });
});

describe("racing again", () => {
  it("keeps the stage for the next lobby, and drops the song", () => {
    const race = lobby(HOST);
    race.phase = "finished";
    race.stageId = "snow-shrine";
    race.songId = "whats-next";
    const next = nextRace(race);
    expect(next.stageId).toBe("snow-shrine");
    expect(next.songId).toBeUndefined();
  });

  it("keeps what the roulette landed on lately, so ? can steer clear of it", () => {
    const race = lobby(HOST);
    race.phase = "finished";
    race.recentPicks = { stage: ["rooftops", "snow-shrine"], song: ["unseen"] };
    expect(nextRace(race).recentPicks).toEqual({ stage: ["rooftops", "snow-shrine"], song: ["unseen"] });
  });

  it("opens a fresh lobby on the same clock, without the DNS racers", () => {
    const race = lobby(HOST, GUEST);
    race.phase = "finished";
    race.tick = 5_000;
    race.lapCount = 3;
    race.players[GUEST]!.status = "dns";

    const next = nextRace(race);

    expect(next.phase).toBe("lobby");
    // The same course until the next select chooses a stage; the room seed kept.
    expect(next.seed).toBe(race.seed);
    expect(next.roomSeed).toBe(race.roomSeed);
    expect(next.tick).toBe(5_000);
    expect(next.lapCount).toBe(3);
    expect(next.hostId).toBe(HOST);
    expect(Object.keys(next.players)).toEqual([HOST]);
    expect(next.players[HOST]!.ready).toBe(false);
  });

  it("carries a dropped racer over as a ghost, on the same deadline", () => {
    const race = lobby(HOST, GUEST);
    race.phase = "finished";
    race.players[GUEST]!.status = "ghost";
    race.players[GUEST]!.ghostDeadlineTick = 1_234;

    const next = nextRace(race);

    expect(next.players[GUEST]!.status).toBe("ghost");
    expect(next.players[GUEST]!.ghostDeadlineTick).toBe(1_234);
    expect(next.players[HOST]!.status).toBe("connected");
    expect(next.players[HOST]!.ghostDeadlineTick).toBeUndefined();
  });

  it("keeps the host id even when the host did not make the roster", () => {
    // The room re-homes the host, because only the room knows who is seated.
    const race = lobby(HOST, GUEST);
    race.phase = "finished";
    race.players[HOST]!.status = "dns";
    expect(nextRace(race).hostId).toBe(HOST);
  });

  it("refuses while a race is still running", () => {
    const race = lobby(HOST);
    race.phase = "racing";
    expect(refusal(() => nextRace(race))).toBe("MALFORMED_MESSAGE");
  });
});

describe("choosing the next host", () => {
  it("prefers the longest-seated player who is still connected", () => {
    const race = lobby(HOST, GUEST, THIRD);
    race.players[GUEST]!.status = "ghost";
    expect(nextHost(race, [GUEST, THIRD])).toBe(THIRD);
  });

  it("falls back to the longest-seated player when nobody is connected", () => {
    const race = lobby(HOST, GUEST, THIRD);
    race.players[GUEST]!.status = "ghost";
    race.players[THIRD]!.status = "dns";
    expect(nextHost(race, [GUEST, THIRD])).toBe(GUEST);
  });

  it("finds nobody when no seat is taken", () => {
    expect(nextHost(lobby(HOST), [])).toBeUndefined();
  });
});
