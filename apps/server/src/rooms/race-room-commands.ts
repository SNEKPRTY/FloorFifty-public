/**
 * The room's message dispatch: every client message's handler, and the
 * machinery that answers correlated commands exactly once.
 *
 * Split out of `race-room.ts`, which is the room's lifecycle and clock; this
 * is its switchboard. The handlers are table-driven over the rules modules
 * (`lobby-rules`, `character-rules`, `select-rules`, `cpu-rules`), so what a
 * command *does* lives there and what a command *is* lives here.
 *
 * The import of `RaceRoom` is type-only: the room imports this module at
 * runtime, never the reverse.
 */

import type { Client } from "@colyseus/core";
import type { LapCount, PlayerId } from "@floor-fifty/shared/common/ids";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  type InputFrame,
  type Pong,
} from "@floor-fifty/shared/common/protocol";
import {
  inputFrameSchema,
  parseCommand,
  pingSchema,
  pickCharacterCommandSchema,
  pickColourCommandSchema,
  pickSeedCommandSchema,
  pickSongCommandSchema,
  pickStageCommandSchema,
  lockInCommandSchema,
  loadedCommandSchema,
  addCpuCommandSchema,
  removeCpuCommandSchema,
  raceAgainCommandSchema,
  getReplayCommandSchema,
  stillHereCommandSchema,
  reportAccessCommandSchema,
  setClockCommandSchema,
  setLapCountCommandSchema,
  setModeCommandSchema,
  setReadyCommandSchema,
} from "@floor-fifty/shared/common/schemas";
import { setClock, setLapCount, setMode, setReady } from "./lobby-rules";
import { applyCharacterFallback, pickCharacter, pickColour } from "./character-rules";
import { lockIn, markLoaded, pickFocus, pickSeed } from "./select-rules";
import { addCpu, fillsOnReady, removeCpu } from "./cpu-rules";
import { requestIdOf } from "./command-ledger";
import { RoomCommandError } from "./room-errors";
import type { RaceRoom } from "./race-room";

/**
 * The closest two pings from one seat may be.
 *
 * A client probes four times a second. This leaves room for that and refuses
 * a client that would turn the probe into a way to make the room send.
 */
const MIN_PING_INTERVAL_MS = 50;

/**
 * Every client message that expects an answer.
 *
 * All of them but the two fire-and-forget streams, `input` and `ping`, which
 * are only worth anything on the tick they arrive. Derived from
 * `CLIENT_MESSAGES`, so a new message is a compile error here until the room
 * has a handler for it.
 */
// `getReplay` answers with bytes to the asking client, so it is registered
// beside the table rather than in it (race-options spec §6.4).
type CommandMessage = Exclude<(typeof CLIENT_MESSAGES)[keyof typeof CLIENT_MESSAGES], "input" | "ping" | "getReplay">;

/** Runs one command for the seat that sent it. Refuses by throwing. */
type CommandHandler = (playerId: PlayerId, payload: unknown) => void;

/**
 * Registers every message a client may originate.
 *
 * Creation and joining are absent by construction: they are matchmaking
 * calls, so a socket cannot ask a room it is already seated in to seat it
 * again somewhere else.
 */
export function registerRoomHandlers(room: RaceRoom): void {
  onClientMessage(room, CLIENT_MESSAGES.input, (client, payload) => receiveInput(room, client, payload));
  onClientMessage(room, CLIENT_MESSAGES.ping, (client, payload) => answerPing(room, client, payload));

  const commands: Record<CommandMessage, CommandHandler> = {
    setReady: (playerId, payload) => {
      const { ready } = parseCommand(setReadyCommandSchema, payload);
      // A lone public racer's Ready is Race CPUs: the seats fill first (spec D-C3).
      if (ready && fillsOnReady(room.race, playerId)) room.fillWithCpus();
      setReady(room.race, playerId, ready);
      room.evaluate();
    },
    setLapCount: (playerId, payload) => {
      const { lapCount } = parseCommand(setLapCountCommandSchema, payload);
      setLapCount(room.race, playerId, lapCount as LapCount, room.offeredLaps());
    },
    setClock: (playerId, payload) => {
      const { seconds } = parseCommand(setClockCommandSchema, payload);
      setClock(room.race, playerId, seconds, room.offeredClocks());
    },
    setMode: (playerId, payload) => {
      const { modeId } = parseCommand(setModeCommandSchema, payload);
      setMode(room.race, playerId, modeId, room.content.content.modes);
    },
    raceAgain: (_playerId, payload) => {
      parseCommand(raceAgainCommandSchema, payload);
      room.raceAgain();
    },
    pickCharacter: (playerId, payload) => {
      const { characterId } = parseCommand(pickCharacterCommandSchema, payload);
      pickCharacter(room.race, playerId, characterId, room.access.of(playerId));
    },
    pickColour: (playerId, payload) => {
      const { colour } = parseCommand(pickColourCommandSchema, payload);
      pickColour(room.race, playerId, colour);
    },
    reportAccess: (playerId, payload) => {
      const { access } = parseCommand(reportAccessCommandSchema, payload);
      if (room.race.phase !== "lobby") {
        throw new RoomCommandError("MALFORMED_MESSAGE", "access is reported in the ready room");
      }
      applyCharacterFallback(room.race, playerId, room.access.set(playerId, access));
    },
    pickStage: (playerId, payload) => {
      const { stageId } = parseCommand(pickStageCommandSchema, payload);
      pickFocus(room.race, playerId, "stage", stageId, room.access.of(playerId));
    },
    pickSong: (playerId, payload) => {
      const { songId } = parseCommand(pickSongCommandSchema, payload);
      pickFocus(room.race, playerId, "song", songId, room.access.of(playerId));
    },
    pickSeed: (playerId, payload) => {
      const { seed } = parseCommand(pickSeedCommandSchema, payload);
      pickSeed(room.race, playerId, seed);
    },
    lockIn: (playerId, payload) => {
      parseCommand(lockInCommandSchema, payload);
      lockIn(room.race, playerId);
    },
    loaded: (playerId, payload) => {
      parseCommand(loadedCommandSchema, payload);
      markLoaded(room.race, playerId);
    },
    addCpu: (playerId, payload) => {
      parseCommand(addCpuCommandSchema, payload);
      addCpu(room.race, playerId, () => room.allocatePlayerId(), room.cpuCharacters());
      room.syncLock();
      room.evaluate();
    },
    // Keep room open: it changes nothing. `runCommand` has already counted it as
    // activity, which is the whole of its work (audit B1).
    stillHere: (_playerId, payload) => {
      parseCommand(stillHereCommandSchema, payload);
    },
    removeCpu: (playerId, payload) => {
      const { playerId: target } = parseCommand(removeCpuCommandSchema, payload);
      removeCpu(room.race, playerId, asPlayerId(target));
      room.syncLock();
      room.evaluate();
    },
  };
  for (const [type, handler] of Object.entries(commands)) {
    onClientMessage(room, type, (client, payload) => runCommand(room, client, payload, handler));
  }
  // Beside the table: it answers the seat with bytes, so it needs the client.
  onClientMessage(room, CLIENT_MESSAGES.getReplay, (client, payload) =>
    runCommand(room, client, payload, () => {
      parseCommand(getReplayCommandSchema, payload);
      if (room.replayBytes === undefined) {
        throw new RoomCommandError("MALFORMED_MESSAGE", "no replay is kept for this race");
      }
      // A replay is tens to hundreds of kilobytes, and a request is forty bytes:
      // one on request per connection per race (audit B2). The finish already
      // sent it to every seat; this is for a seat that reloaded.
      if (!room.claimReplayFor(client)) {
        throw new RoomCommandError("RATE_LIMITED", "the replay was already sent to this connection");
      }
      client.sendBytes(SERVER_MESSAGES.replay, room.replayBytes);
    }),
  );
}

/**
 * Registers a client message handler inside an error boundary (audit A01).
 *
 * Colyseus calls a message handler outside any try/catch of its own, so an
 * error a handler lets escape reaches the process, and the production server
 * exits on an uncaught error (`process-safety.ts`): one bad message would end
 * every race on the box. Handlers are written to refuse bad input without
 * throwing; this is the backstop for a bug that still throws. The message is
 * dropped and logged, and the room keeps serving its other seats.
 *
 * Only messages are guarded here. The tick is not: a room whose simulation
 * fails has its own halt path (`SimulationInvariantError`), and an unknown
 * tick failure should still stop the process rather than run on in an
 * unknown state.
 */
function onClientMessage(
  room: RaceRoom,
  type: string,
  handler: (client: Client, payload: unknown) => void,
): void {
  room.onMessage(type, (client, payload) => {
    try {
      handler(client, payload);
    } catch (error) {
      room.telemetry.messageFailed(type, error);
    }
  });
}

/**
 * One input frame: fire and forget.
 *
 * A frame is only meaningful for the tick it belongs to, so there is no
 * answer to correlate and nothing to wait on. A malformed or over-budget
 * frame is dropped and counted, never answered with a disconnect.
 */
function receiveInput(room: RaceRoom, client: Client, payload: unknown): void {
  const playerId = room.seats.playerOf(client.sessionId);
  if (playerId === undefined) return;
  let frame: InputFrame;
  try {
    frame = parseCommand(inputFrameSchema, payload);
  } catch {
    room.telemetry.input("rejected-malformed");
    return;
  }
  const result = room.submitInput(playerId, frame, true);
  room.telemetry.input(result.outcome, result.slack);
}

/**
 * A clock probe, answered at once and never after a patch: a probe's whole
 * value is how long it took. Bounded per seat, and a malformed one is
 * dropped silently.
 */
function answerPing(room: RaceRoom, client: Client, payload: unknown): void {
  if (room.seats.playerOf(client.sessionId) === undefined) return;
  const now = performance.now();
  const last = room.lastPingAt.get(client.sessionId);
  if (last !== undefined && now - last < MIN_PING_INTERVAL_MS) return;
  room.lastPingAt.set(client.sessionId, now);
  let ping: { id: number; tick: number };
  try {
    ping = parseCommand(pingSchema, payload);
  } catch {
    return;
  }
  room.telemetry.ping();
  const pong: Pong = { id: ping.id, slack: ping.tick < 0 ? null : ping.tick - room.nowTicks(now) };
  client.send(SERVER_MESSAGES.pong, pong);
}

/**
 * Runs a correlated command for the seat that sent it, and answers it.
 *
 * A message from a session without a seat, or without a request id, is
 * ignored: there is nobody to act for, or no way to address the answer. A
 * dropped request id is counted in the room's telemetry.
 * A replayed answer changed nothing, so it publishes nothing.
 */
function runCommand(
  room: RaceRoom,
  client: Client,
  payload: unknown,
  run: CommandHandler,
): void {
  const playerId = room.seats.playerOf(client.sessionId);
  if (playerId === undefined) return;
  // Before anything is read from the payload: a flood costs a counter, not a
  // parse, a projection and an answer each (audit B2).
  if (!room.commandMeter.spend(playerId, room.race.tick)) {
    room.telemetry.commandThrottled();
    return;
  }
  room.noteActivity();
  const requestId = requestIdOf(payload);
  if (requestId === undefined) {
    room.telemetry.requestIdDropped();
    return;
  }

  const { result, replayed } = room.ledger.answer(client.sessionId, requestId, () =>
    run(playerId, payload),
  );
  client.send(SERVER_MESSAGES.commandResult, result);
  if (!replayed) room.project();
}
