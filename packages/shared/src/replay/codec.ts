/**
 * A replay's bytes (race-options spec §6.3), before deflate: a JSON header,
 * then change-only tracks as varint deltas. Phase 4b saves and shares exactly
 * these bytes, deflated, so the layout is a format: `REPLAY_FORMAT` moves with
 * any change to it.
 *
 * 1. The header as UTF-8 JSON, prefixed with its byte length (u32 LE).
 * 2. Per seat, in `header.seats` order: an entry count, then per entry a tick
 *    delta (from the previous entry, the first from GO), a flag byte, and --
 *    unless the seat left the input map -- a zigzag sequence delta.
 * 3. The room track: a count, then a tick delta, a seat index and a status byte.
 * 4. The checks: a count, then a tick delta and the hash (u32 LE).
 * 5. The final tick's delta from GO, then the final hash (u32 LE).
 */

import type { PlayerId } from "../common/ids";
import type { HeldInput, PlayerStatus } from "../common/protocol";
import { REPLAY_FORMAT, type InputEntry, type Replay, type ReplayCheck, type ReplayHeader, type RoomEntry } from "./replay";

// Global in Node and in every browser; this package's lib has no DOM, so the
// two members the codec uses are declared here rather than pulling DOM in.
declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };
declare const TextDecoder: { new (label: string, options: { fatal: boolean }): { decode(bytes: Uint8Array): string } };

export class ReplayFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayFormatError";
  }
}

const FLAG = { left: 1, right: 2, fastFall: 4, reset: 8, absent: 128 } as const;
const STATUSES: readonly PlayerStatus[] = ["connected", "ghost", "dns"];

/** The largest sequence step the codec writes; the room's never come close (`input-queue.ts`). */
const MAX_SEQUENCE_STEP = 2 ** 31;

const refuse = (message: string): never => {
  throw new ReplayFormatError(message);
};

/** The header's shape, checked before anything reads it; a format, not a schema library. */
function assertHeader(header: unknown): asserts header is ReplayHeader {
  const value = header as Partial<ReplayHeader> | null;
  if (value === null || typeof value !== "object") refuse("the replay's header is not an object");
  const fine =
    Array.isArray(value!.seats) &&
    value!.seats.every((seat) => typeof seat === "string") &&
    typeof value!.stageId === "string" &&
    typeof value!.modeId === "string" &&
    typeof value!.rulesetRevision === "string" &&
    typeof value!.courseRevision === "string" &&
    (value!.lapCount === 1 || value!.lapCount === 3) &&
    typeof value!.go === "object" &&
    value!.go !== null &&
    Number.isSafeInteger(value!.go.tick);
  if (!fine) refuse("the replay's header is malformed");
}

class Writer {
  private readonly bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  varint(value: number): void {
    let rest = value;
    while (rest >= 0x80) {
      this.byte((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.byte(rest);
  }

  zigzag(value: number): void {
    this.varint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  u32(value: number): void {
    for (let i = 0; i < 4; i += 1) this.byte(Math.floor(value / 2 ** (8 * i)));
  }

  raw(bytes: Uint8Array): void {
    for (const value of bytes) this.byte(value);
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private at = 0;

  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.at >= this.bytes.length) throw new ReplayFormatError("the replay ends early");
    return this.bytes[this.at++]!;
  }

  varint(): number {
    let value = 0;
    for (let scale = 1; ; scale *= 0x80) {
      const next = this.byte();
      value += (next & 0x7f) * scale;
      if (next < 0x80) return value;
      if (scale > 2 ** 42) throw new ReplayFormatError("a number in the replay is too long");
    }
  }

  zigzag(): number {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  u32(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) value += this.byte() * 2 ** (8 * i);
    return value;
  }

  raw(length: number): Uint8Array {
    if (this.at + length > this.bytes.length) throw new ReplayFormatError("the replay ends early");
    const slice = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return slice;
  }

  end(): void {
    if (this.at !== this.bytes.length) throw new ReplayFormatError("the replay has bytes after its end");
  }
}

const flagsOf = (frame: HeldInput | null): number =>
  frame === null
    ? FLAG.absent
    : (frame.left ? FLAG.left : 0) |
      (frame.right ? FLAG.right : 0) |
      (frame.fastFall ? FLAG.fastFall : 0) |
      (frame.reset ? FLAG.reset : 0);

export function encodeReplay(replay: Replay): Uint8Array {
  const out = new Writer();
  const header = new TextEncoder().encode(JSON.stringify(replay.header));
  out.u32(header.length);
  out.raw(header);
  const go = replay.header.go.tick;

  for (const seat of replay.header.seats) {
    const entries = replay.inputs[seat] ?? [];
    out.varint(entries.length);
    let tick = go;
    let sequence = 0;
    for (const entry of entries) {
      if (entry.tick < tick) refuse("an input entry goes back in time");
      out.varint(entry.tick - tick);
      tick = entry.tick;
      out.byte(flagsOf(entry.frame));
      if (entry.frame !== null) {
        if (Math.abs(entry.frame.sequence - sequence) > MAX_SEQUENCE_STEP) refuse("a sequence step is too large");
        out.zigzag(entry.frame.sequence - sequence);
        sequence = entry.frame.sequence;
      }
    }
  }

  out.varint(replay.room.length);
  let roomTick = go;
  for (const entry of replay.room) {
    if (entry.tick < roomTick) refuse("a room entry goes back in time");
    const seat = replay.header.seats.indexOf(entry.playerId);
    const status = STATUSES.indexOf(entry.status);
    if (seat < 0) refuse("a room entry names a seat the header does not");
    if (status < 0) refuse("a room entry has an unknown status");
    out.varint(entry.tick - roomTick);
    roomTick = entry.tick;
    out.varint(seat);
    out.byte(status);
  }

  out.varint(replay.checks.length);
  let checkTick = go;
  for (const check of replay.checks) {
    if (check.tick < checkTick) refuse("a check goes back in time");
    out.varint(check.tick - checkTick);
    checkTick = check.tick;
    out.u32(check.hash);
  }

  out.varint(replay.finalTick - go);
  out.u32(replay.finalHash);
  return out.done();
}

export function decodeReplay(bytes: Uint8Array): Replay {
  const input = new Reader(bytes);
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.raw(input.u32())));
  } catch (error) {
    if (error instanceof ReplayFormatError) throw error;
    throw new ReplayFormatError("the replay's header is not readable");
  }
  if ((header as { format?: unknown } | null)?.format !== REPLAY_FORMAT) {
    throw new ReplayFormatError(`unknown replay format ${String((header as { format?: unknown } | null)?.format)}`);
  }
  assertHeader(header);
  const go = header.go.tick;

  const inputs = {} as Record<PlayerId, InputEntry[]>;
  for (const seat of header.seats) {
    const entries: InputEntry[] = [];
    let tick = go;
    let sequence = 0;
    for (let count = input.varint(); count > 0; count -= 1) {
      tick += input.varint();
      const flags = input.byte();
      if ((flags & FLAG.absent) !== 0) {
        entries.push({ tick, frame: null });
        continue;
      }
      sequence += input.zigzag();
      entries.push({
        tick,
        frame: {
          sequence,
          left: (flags & FLAG.left) !== 0,
          right: (flags & FLAG.right) !== 0,
          fastFall: (flags & FLAG.fastFall) !== 0,
          reset: (flags & FLAG.reset) !== 0,
        },
      });
    }
    inputs[seat] = entries;
  }

  const room: RoomEntry[] = [];
  let roomTick = go;
  for (let count = input.varint(); count > 0; count -= 1) {
    roomTick += input.varint();
    const playerId = header.seats[input.varint()];
    const status = STATUSES[input.byte()];
    if (playerId === undefined || status === undefined) throw new ReplayFormatError("a room entry names no seat or status");
    room.push({ tick: roomTick, playerId, status });
  }

  const checks: ReplayCheck[] = [];
  let checkTick = go;
  for (let count = input.varint(); count > 0; count -= 1) {
    checkTick += input.varint();
    checks.push({ tick: checkTick, hash: input.u32() });
  }

  const finalTick = go + input.varint();
  const finalHash = input.u32();
  input.end();

  const ticks = [...Object.values(inputs).flat(), ...room, ...checks].map((entry) => entry.tick);
  if (ticks.some((tick) => tick > finalTick)) throw new ReplayFormatError("a track runs past the final tick");
  return { header, inputs, room, checks, finalTick, finalHash };
}
