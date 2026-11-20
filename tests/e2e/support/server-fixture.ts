/**
 * End-to-end server access.
 *
 * Playwright starts a real client and a real server; this is how a spec reaches
 * the server directly, to drive a race to its finish without spending a minute
 * of wall time climbing twenty floors by hand.
 *
 * The driver feeds valid inputs into the same simulation a keypress reaches. It
 * cannot set a winner, so a result a test observes is a result the server
 * genuinely produced.
 */

import type { ClockName } from "../../../apps/server/src/rooms/clock-hold";
import type { RoomReading } from "../../../apps/server/src/rooms/room-driver";

export type { ClockName, RoomReading };

export const SERVER_URL = process.env["FLOOR_FIFTY_SERVER_URL"] ?? "http://127.0.0.1:4100";
export const TEST_TOKEN = process.env["FLOOR_FIFTY_TEST_DRIVER_TOKEN"] ?? "e2e-driver-token";

export type DriveResult = {
  ticksDriven: number;
  phase: string;
  winnerId?: string;
  progress: { id: string; status: string; lap: number; progress: number }[];
};

/** Drives a room toward its finish and reports what the server decided. */
export async function driveRoom(
  roomCode: string,
  options: { ticks?: number; playerIds?: string[] } = {},
): Promise<DriveResult> {
  const response = await fetch(`${SERVER_URL}/__test__/drive`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-token": TEST_TOKEN },
    body: JSON.stringify({
      roomCode,
      ticks: options.ticks ?? 60 * 240,
      ...(options.playerIds === undefined ? {} : { playerIds: options.playerIds }),
    }),
  });

  if (!response.ok) {
    throw new Error(`room driver refused: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as DriveResult;
}

/** Waits for the server to answer its liveness probe. */
export async function waitForServer(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVER_URL}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the race server did not come up at ${SERVER_URL}`);
}

/** The driver answered, and said no. */
export class DriverRefusal extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    body: string,
  ) {
    super(`the test driver refused ${path}: ${status} ${body}`);
  }
}

/**
 * Asks the driver, again if the connection was reset under the request.
 *
 * Node's fetch reuses a keep-alive socket, and a server that closed it a moment
 * before answers the next request with ECONNRESET ("fetch failed"): the nightly
 * focused run lost a whole spec to one. What these routes are asked is a read,
 * or a hold that replaces what was held, so asking twice says the same thing.
 */
async function ask<T>(path: string, body: unknown): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${SERVER_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-token": TEST_TOKEN },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new DriverRefusal(path, response.status, await response.text());
    return (await response.json()) as T;
  }
  throw new Error(`the test driver did not answer ${path} in four tries: ${String(lastError)} (${String((lastError as { cause?: unknown })?.cause ?? "")})`);
}

/** What the room itself says it is doing: its phase, its own tick, its select step. */
export function readRoom(roomCode: string): Promise<RoomReading> {
  return ask<RoomReading>("/__test__/room", { roomCode });
}

/** Whether the server has a room with this code: the room's word against a page's. */
export async function roomExists(roomCode: string): Promise<boolean> {
  try {
    await readRoom(roomCode);
    return true;
  } catch (error) {
    if (error instanceof DriverRefusal && error.status === 404) return false;
    throw error;
  }
}

/**
 * Holds exactly `names` and lets every other clock run (server `clock-hold.ts`).
 *
 * A held step or countdown stays as it is for as long as a spec needs to look
 * at it, whatever the machine's pace; the room itself keeps ticking, so a
 * client that joins or returns is still seated. An empty list lets all go.
 */
export function holdRoomClocks(roomCode: string, names: readonly ClockName[]): Promise<RoomReading> {
  return ask<RoomReading>("/__test__/clock", { roomCode, hold: names });
}

/**
 * How long the room's own clock may stand still before a spec calls it stuck:
 * far past the longest stall the nightly's server logged (14.5 s), so reaching
 * it means the room stopped, not that the machine was busy.
 */
export const ROOM_STALL_MS = 45_000;

/**
 * Patience counted in the room's ticks, not the wall's.
 *
 * A room under a stalled process takes longer by the wall to reach the tick a
 * step ends on, and drops the time it could not catch up on, so "within ten
 * seconds" is a different question on every machine. Asked in ticks, the
 * answer is the same everywhere: the step ends on its tick, or the room is
 * broken. The wall only matters when the room stops ticking at all.
 */
export class RoomPatience {
  private startTick: number | undefined;
  private lastTick = Number.NEGATIVE_INFINITY;
  private lastTickAt = Date.now();

  constructor(
    private readonly roomCode: string,
    /** What the wait is for, in the failure's words. */
    private readonly what: string,
    /** The room ticks it may take. */
    private readonly ticks: number,
    /** How long by the wall the room's tick may stand still. */
    private readonly stallMs: number = ROOM_STALL_MS,
  ) {}

  /** Checks a supplied reading or reads the room; enforces its tick and stall bounds. */
  async check(reading?: RoomReading): Promise<RoomReading> {
    reading ??= await readRoom(this.roomCode);
    this.startTick ??= reading.tick;
    if (reading.tick !== this.lastTick) {
      this.lastTick = reading.tick;
      this.lastTickAt = Date.now();
    }
    const used = reading.tick - this.startTick;
    const where = `${reading.phase}${reading.step === undefined ? "" : `/${reading.step}`}, held: [${reading.held.join(", ")}]`;
    if (used > this.ticks) throw new Error(`${this.what}: the room ran ${used} ticks (of ${this.ticks}) and is still ${where}`);
    if (Date.now() - this.lastTickAt > this.stallMs) {
      throw new Error(`${this.what}: the room's clock stood still for ${this.stallMs / 1000} s at tick ${reading.tick}, ${where}`);
    }
    return reading;
  }
}

/** Waits until the room says `until`, within `ticks` of its own time. */
export async function waitForRoom(
  roomCode: string,
  until: (reading: RoomReading) => boolean,
  options: { what: string; ticks: number; pollMs?: number },
): Promise<RoomReading> {
  const patience = new RoomPatience(roomCode, options.what, options.ticks);
  for (;;) {
    const reading = await readRoom(roomCode);
    // A late poll can already show the requested state. Check success before
    // rejecting its elapsed ticks; only an unmet condition consumes patience.
    if (until(reading)) return reading;
    await patience.check(reading);
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
  }
}
