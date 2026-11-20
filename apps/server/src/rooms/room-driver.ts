/**
 * The test room driver.
 *
 * End-to-end tests need a race to finish in seconds rather than in the minute a
 * human ascent takes. This drives an existing room to that finish the only
 * legitimate way: by feeding valid input frames into the same simulation a
 * player's keypresses reach, tick after tick.
 *
 * What it must never do is fabricate a result. It cannot set a position, a lap,
 * a standing, or a winner, and there is no code path here that writes one. If
 * the simulation does not produce a finish, the test does not get one.
 *
 * It is mounted only when a token is configured, which normal production
 * startup does not do.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { InputFrame } from "@floor-fifty/shared/common/protocol";
import type { InputOutcome } from "./room-telemetry";
import type { RaceState } from "@floor-fifty/shared/common/state";
import type { SelectStep } from "@floor-fifty/shared/room/select";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { progressOf } from "@floor-fifty/shared/simulation/endless";
import { isClockName, type ClockName } from "./clock-hold";
import type { RaceRoom } from "./race-room";

/** How many ticks one request may drive, so a bad call cannot hang the server. */
const MAX_TICKS = 60 * 60 * 5;

export type DriveRequest = {
  roomCode: string;
  /** Players to steer. Anyone omitted simply stands still. */
  playerIds?: string[];
  /** Upper bound; driving stops early when the race finishes. */
  ticks: number;
};

export type DriveResult = {
  ticksDriven: number;
  phase: string;
  winnerId?: string;
  /**
   * Each player's ascent progress when driving stopped.
   *
   * A drive that ends without a finish is nearly always a steering problem, and
   * a bare "still racing" gives a test author nothing to go on.
   */
  progress: { id: string; status: string; lap: number; progress: number }[];
};

/**
 * What the driver needs of a room, whichever room implementation it is.
 *
 * Both rooms expose exactly this, so one driving loop serves both transports
 * and the frames it feeds reach the same simulation a keypress reaches. The
 * tick is passed in because the two name that method differently and neither
 * name is the driver's business.
 */
export type DrivableRoom = {
  readonly raceState: RaceState;
  seatedPlayerIds(): PlayerId[];
  submitInput(
    playerId: PlayerId,
    input: InputFrame,
    metered: boolean,
  ): { outcome: InputOutcome; slack?: number };
};

/** Drives a room with real inputs until it finishes or the budget runs out. */
export function driveRoom(room: DrivableRoom, request: DriveRequest, step: () => void): DriveResult {
  const budget = Math.min(request.ticks, MAX_TICKS);
  const steered = (request.playerIds ?? room.seatedPlayerIds()) as PlayerId[];
  // One controller per player, because recovering from a stalled ascent needs
  // memory of how long that player has gone without a new floor.
  const controllers = new Map(steered.map((id) => [id, createClimbController(id)]));

  let driven = 0;
  for (let tick = 0; tick < budget; tick += 1) {
    if (room.raceState.phase === "finished") break;

    if (room.raceState.phase === "racing") {
      for (const playerId of steered) {
        // Numbered after whatever the seat has already sent, so a second
        // drive request -- or a player who pressed a key first -- continues
        // the sequence instead of being refused for repeating it.
        const sequence = (room.raceState.players[playerId]?.lastSequence ?? 0) + 1;
        const intent = controllers.get(playerId)?.next(room.raceState, sequence);
        if (intent === undefined) continue;
        // Unmetered, because the driver supplies a frame every tick; every
        // other check the real path makes still applies. Stamped for the very
        // next tick, which is the one it is about to step.
        // A refusal is the room's business, and never the driver's to escape.
        room.submitInput(playerId, { ...intent, tick: room.raceState.tick + 1 }, false);
      }
    }

    step();
    driven += 1;
  }

  const state = room.raceState;
  return {
    ticksDriven: driven,
    phase: state.phase,
    ...(state.winnerId === undefined ? {} : { winnerId: state.winnerId }),
    progress: Object.values(state.players).map((player) => ({
      id: player.id,
      status: player.status,
      lap: player.lap,
      progress: progressOf(state, player),
    })),
  };
}

/** Constant-time token comparison, so the endpoint cannot be probed. */
function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export const TEST_DRIVER_PATH = "/__test__/drive";
/** Reads a room: where its clock is and what it is doing. */
export const TEST_ROOM_PATH = "/__test__/room";
/** Holds a room's clocks (`clock-hold.ts`), or lets them go. */
export const TEST_CLOCK_PATH = "/__test__/clock";

/**
 * What a spec may ask of a room and be told about it.
 *
 * Read from the room's own state, never from a client's copy, so a spec that
 * waits on it is waiting on what the room decided and not on how fast a browser
 * heard of it. The ticks are the room's, which keep to its clock and not the
 * wall's: a room under a stalled process takes longer by the wall to reach the
 * tick a step ends on, and a spec that counts ticks is as patient as it needs to be.
 */
export type RoomReading = {
  phase: RaceState["phase"];
  /** The room's own tick. */
  tick: number;
  /** The select step, while the room is in select. */
  step?: SelectStep;
  /** The tick the select step ends on (held clocks push it back). */
  stepEndsAtTick?: number;
  /** The tick the countdown ends on, while the room is counting. */
  countdownEndsAtTick?: number;
  /** The clocks held now (`clock-hold.ts`). */
  held: ClockName[];
  seats: { id: string; status: string; cpu: boolean; x: number; y: number; vx: number; vy: number; input: { sequence: number; left: boolean; right: boolean; fastFall: boolean } }[];
};

export function readRoom(room: RaceRoom): RoomReading {
  const race = room.raceState;
  return {
    phase: race.phase,
    tick: race.tick,
    ...(race.select === undefined ? {} : { step: race.select.step, stepEndsAtTick: race.select.endsAtTick }),
    ...(race.countdownEndsAtTick === undefined ? {} : { countdownEndsAtTick: race.countdownEndsAtTick }),
    held: room.heldClocks(),
    seats: Object.values(race.players).map((player) => {
      // This protected test-only reading copies the in-force queue; reading must never consume it.
      const input = room["inputQueue"]["seats"].get(player.id)?.held;
      return { id: player.id, status: player.status, cpu: player.cpu, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
        input: { sequence: input?.sequence ?? 0, left: input?.left ?? false, right: input?.right ?? false, fastFall: input?.fastFall ?? false } };
    }),
  };
}

const TEST_PATHS: readonly string[] = [TEST_DRIVER_PATH, TEST_ROOM_PATH, TEST_CLOCK_PATH];

/**
 * Builds the driver's request handler for a Colyseus server.
 *
 * The room is found through the matchmaker rather than a registry this
 * process keeps, because under Colyseus the matchmaker *is* the registry --
 * one that also works across processes. Rooms step through `stepOnce`, the
 * public seam the room tests use.
 */
export function createColyseusTestDriver(
  token: string | undefined,
): ((request: IncomingMessage, response: ServerResponse) => Promise<boolean>) | undefined {
  if (token === undefined || token.length === 0) return undefined;

  return async (request, response) => {
    const path = request.url;
    if (path === undefined || !TEST_PATHS.includes(path)) return false;

    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (request.method !== "POST") {
      send(405, { error: "POST only" });
      return true;
    }
    if (!tokenMatches(request.headers["x-test-token"] as string | undefined, token)) {
      send(403, { error: "forbidden" });
      return true;
    }

    let body: DriveRequest & { hold?: unknown };
    try {
      body = (await readBody(request)) as DriveRequest & { hold?: unknown };
    } catch {
      send(400, { error: "invalid body" });
      return true;
    }

    const room = matchMaker.getLocalRoomById(body.roomCode) as unknown as RaceRoom | undefined;
    if (room === undefined) {
      send(404, { error: "no such room" });
      return true;
    }

    if (path === TEST_ROOM_PATH) {
      send(200, readRoom(room));
      return true;
    }

    if (path === TEST_CLOCK_PATH) {
      // The whole list or nothing: a name that is not a clock must not leave
      // some of the others held.
      const names = body.hold;
      if (!Array.isArray(names) || !names.every(isClockName)) {
        send(400, { error: "hold wants a list of clock names" });
        return true;
      }
      room.holdClocks(names);
      send(200, readRoom(room));
      return true;
    }

    send(200, driveRoom(room, body, () => room.stepOnce()));
    return true;
  };
}
