/**
 * Wire validation.
 *
 * Nothing reaches a room, a simulation, or a nameplate without passing through
 * here first. Schemas are strict, so an unrecognised field is a rejection
 * rather than a silent strip: a client attempting to smuggle a position, score,
 * or winner must fail loudly.
 */

import { z } from "zod";
import { PROTOCOL_VERSION, REQUEST_ID_MAX_LENGTH } from "./constants";
import type { AccessSets } from "../content/access";
import type { PlayerName } from "./ids";
import { SEAT_COLOURS, type SeatColour } from "./seats";
import { DEVICE_CLASSES, type DeviceClass } from "./protocol";
import { SEED_MAX, SEED_MIN } from "../room/select";
import { BUILD_ID_PATTERN, DEV_BUILD_ID } from "./build";

/** A release's build id, or `dev`. */
const BUILD_ID_OR_DEV = new RegExp(`^(?:${DEV_BUILD_ID}|${BUILD_ID_PATTERN.source.slice(1, -1)})$`);

export type ProtocolErrorCode = "MALFORMED_MESSAGE" | "VERSION_MISMATCH";

/** A rejection a caller can branch on rather than pattern-match on a string. */
export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export const ROOM_CODE_LENGTH = 6;
/**
 * Characters a player can read off a screen and type without ambiguity.
 * `I`, `O`, `0` and `1` are omitted for exactly that reason. The server deals
 * codes from it, and a pad player steps through it letter by letter.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PLAYER_NAME_MAX_LENGTH = 16;

/**
 * The only player-authored string in the system.
 *
 * Restricting it to letters, digits, spaces, hyphens, and underscores at the
 * parser is what keeps every later consumer -- nameplate, roster, results row,
 * leaderboard entry -- from needing an escaping rule of its own.
 */
export const playerNameSchema = z
  .string()
  .trim()
  .min(1, "name must not be empty")
  .max(PLAYER_NAME_MAX_LENGTH, `name must be at most ${PLAYER_NAME_MAX_LENGTH} characters`)
  .regex(/^[\p{L}\p{N} _-]+$/u, "name may contain only letters, digits, spaces, hyphens, and underscores")
  .transform((value) => value as PlayerName);

/** Room codes are compared case-insensitively but stored uppercase. */
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`), "invalid room code");

export const lapCountSchema = z.union([z.literal(1), z.literal(3)]);

export const inputFrameSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    left: z.boolean(),
    right: z.boolean(),
    fastFall: z.boolean(),
    reset: z.boolean(),
  })
  .strict();

/**
 * A clock probe. `tick` is fractional, or -1 before the client has a clock;
 * anything else is refused rather than answered with a slack computed from
 * nonsense.
 */
export const pingSchema = z
  .object({
    id: z.number().int().nonnegative(),
    tick: z.number().finite().min(-1),
  })
  .strict();

const contentIdOnWire = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);
const ACCESS_LIST_MAX = 256;

/** A seat's report of what it may pick (spec §4.3); the server trusts and intersects it. */
export const accessSchema = z
  .object({
    stages: z.array(contentIdOnWire).max(ACCESS_LIST_MAX),
    songs: z.array(contentIdOnWire).max(ACCESS_LIST_MAX),
    characters: z.array(contentIdOnWire).max(ACCESS_LIST_MAX),
  })
  .strict();

/**
 * What a client presents at matchmaking.
 *
 * Validated before a seat exists, which is the whole point: a name that could
 * not be rendered and a protocol a room could not speak are both refused
 * before they occupy one of four places.
 */
export const joinOptionsSchema = z
  .object({
    name: playerNameSchema,
    protocolVersion: z.number().int(),
    access: accessSchema.optional(),
    /** The colour this device remembers; the room gives it if nobody holds it (select spec §6.7). */
    colour: z.enum(SEAT_COLOURS).optional(),
    /** Read only when the room is created: `true` opens it to strangers (quick-match spec §4.1). */
    quickMatch: z.boolean().optional(),
    /** The seat's device, decided at boot (unlockables spec §3). */
    deviceClass: z.enum(DEVICE_CLASSES).optional(),
    /**
     * The client's build, compared at the join (release readiness §4.2).
     * Both reach the journal on a build skew, so each is held to its own
     * shape: a newline or a brace could otherwise forge a log line.
     */
    buildId: z.string().regex(BUILD_ID_OR_DEV).optional(),
    rulesetRevision: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/).optional(),
  })
  .strict();

export type JoinOptions = {
  name: PlayerName;
  protocolVersion: number;
  access?: AccessSets;
  colour?: SeatColour;
  quickMatch?: boolean;
  deviceClass?: DeviceClass;
  buildId?: string;
  rulesetRevision?: string;
};

/**
 * The refusal a client on another protocol version gets. Every client, old
 * ones included, reads "protocol version" in it as VERSION_MISMATCH and asks
 * the player to reload, so the words are part of the wire.
 */
export function protocolMismatchMessage(clientVersion: number): string {
  return `unsupported protocol version ${clientVersion}; this server speaks version ${PROTOCOL_VERSION}`;
}

export function parseJoinOptions(value: unknown): JoinOptions {
  const result = joinOptionsSchema.safeParse(value);
  if (!result.success) {
    throw new ProtocolError(
      "MALFORMED_MESSAGE",
      result.error.issues[0]?.message ?? "invalid join options",
      result.error,
    );
  }
  if (result.data.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError("VERSION_MISMATCH", protocolMismatchMessage(result.data.protocolVersion));
  }
  const { name, protocolVersion, access, colour, quickMatch, deviceClass, buildId, rulesetRevision } = result.data;
  return {
    name,
    protocolVersion,
    ...(access === undefined ? {} : { access }),
    ...(colour === undefined ? {} : { colour }),
    ...(quickMatch === undefined ? {} : { quickMatch }),
    ...(deviceClass === undefined ? {} : { deviceClass }),
    ...(buildId === undefined ? {} : { buildId }),
    ...(rulesetRevision === undefined ? {} : { rulesetRevision }),
  };
}

/**
 * A client-generated correlation id.
 *
 * ASCII, bounded, and unique within a client session. It addresses an answer
 * and grants no authority whatsoever: nothing downstream branches on its
 * value.
 */
export const requestIdSchema = z
  .string()
  .min(1)
  .max(REQUEST_ID_MAX_LENGTH)
  .regex(/^[\x20-\x7e]+$/, "a request id must be printable ASCII");

export const setReadyCommandSchema = z
  .object({ requestId: requestIdSchema, ready: z.boolean() })
  .strict();

export const setLapCountCommandSchema = z
  .object({ requestId: requestIdSchema, lapCount: lapCountSchema })
  .strict();

export const setClockCommandSchema = z
  .object({ requestId: requestIdSchema, seconds: z.number().int().positive() })
  .strict();

export const setModeCommandSchema = z
  .object({ requestId: requestIdSchema, modeId: contentIdOnWire })
  .strict();

export const raceAgainCommandSchema = z.object({ requestId: requestIdSchema }).strict();

export const getReplayCommandSchema = z.object({ requestId: requestIdSchema }).strict();
export const stillHereCommandSchema = z.object({ requestId: requestIdSchema }).strict();

export const pickCharacterCommandSchema = z
  .object({ requestId: requestIdSchema, characterId: z.union([contentIdOnWire, z.literal("?")]) })
  .strict();

export const pickColourCommandSchema = z.object({ requestId: requestIdSchema, colour: z.enum(SEAT_COLOURS) }).strict();

export const reportAccessCommandSchema = z.object({ requestId: requestIdSchema, access: accessSchema }).strict();

/** The seat's focus in the stage step: a stage, or "?" for the roulette's own draw. */
export const pickStageCommandSchema = z
  .object({ requestId: requestIdSchema, stageId: z.union([contentIdOnWire, z.literal("?")]) })
  .strict();
/** The seat's focus in the song step: a song, or "?" for the roulette's own draw. */
export const pickSongCommandSchema = z
  .object({ requestId: requestIdSchema, songId: z.union([contentIdOnWire, z.literal("?")]) })
  .strict();
/** The seat's seed choice in the stage step (stage seeds spec §3.1). */
export const pickSeedCommandSchema = z
  .object({
    requestId: requestIdSchema,
    seed: z.union([z.literal("random"), z.literal("classic"), z.number().int().min(SEED_MIN).max(SEED_MAX)]),
  })
  .strict();
/** Locks the seat's focus in the current pick step. */
export const lockInCommandSchema = z.object({ requestId: requestIdSchema }).strict();
/** The seat has loaded the chosen content. */
export const loadedCommandSchema = z.object({ requestId: requestIdSchema }).strict();

export const addCpuCommandSchema = z.object({ requestId: requestIdSchema }).strict();

export const removeCpuCommandSchema = z
  .object({ requestId: requestIdSchema, playerId: z.string().min(1).max(64) })
  .strict();

/** Parses a room command, reporting a malformed one the way a room renders it. */
export function parseCommand<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T; error?: z.ZodError } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new ProtocolError(
      "MALFORMED_MESSAGE",
      result.error?.issues[0]?.message ?? "invalid command",
      result.error,
    );
  }
  return result.data;
}
