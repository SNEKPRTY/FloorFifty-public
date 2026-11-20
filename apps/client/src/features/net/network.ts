/**
 * The network port.
 *
 * Declared here, beside the screen lifecycle that depends on it, and
 * implemented over Socket.IO by the lobby task. A screen may only express
 * intent through this interface: there is no method that sets a position, a
 * lap, a standing, or a winner, because a client does not own any of them.
 */

import type { DeviceClass, IdleWarning, InputFrame, RoomSnapshot, ServerError } from "@floor-fifty/shared/common/protocol";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { SeedChoice } from "@floor-fifty/shared/room/select";
import type { ErrorDetail } from "./error-view";

export type ConnectionState = "offline" | "connecting" | "connected" | "reconnecting";

/**
 * A failure as the client carries it: the server's code and log message, and
 * where the client knows more than the code says, a detail. The words a player
 * reads are chosen from code and detail when shown (`features/screen/error-copy.ts`).
 */
export type NetworkError = ServerError & { readonly detail?: ErrorDetail };

/** What a boot-time reclaim of a stored seat came to. */
export type ResumeOutcome = "resumed" | "none" | "expired" | "cancelled";

export type NetworkListeners = {
  onSnapshot(snapshot: RoomSnapshot): void;
  onError(error: NetworkError): void;
  onConnectionState(state: ConnectionState): void;
  /**
   * The server replaced its content.
   *
   * Optional because it is an optimisation, not the mechanism: a client that
   * never hears it still notices on the next snapshot whose `contentRevision`
   * differs from its cache. Only a screen that is outside a room has any use
   * for it, because that is the case no snapshot covers.
   */
  onContentRevision?(contentRevision: string): void;
  /**
   * The room answered a clock probe: how long it took, and how early the
   * probe's tick was against the room's own clock (`null` when it carried none).
   */
  onPong?(pong: { id: number; rttMs: number; slack: number | null }): void;
  /** The finished race's replay arrived, deflated (race-options spec §6.4). */
  onReplay?(bytes: Uint8Array): void;
  /**
   * The room is about to close for want of anyone using it, or has been kept
   * open (`closesInSeconds` is then null) (audit B1).
   */
  onIdleWarning?(warning: IdleWarning): void;
};

export interface NetworkPort {
  createRoom(name: string): Promise<void>;
  joinRoom(code: string, name: string): Promise<void>;
  /** Seats you in the first open public room, or opens one (quick-match spec §7.1). */
  quickMatch(name: string): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  setLapCount(lapCount: 1 | 3): Promise<void>;
  /** The host's Survival clock, in seconds (survival spec §5). */
  setClock(seconds: number): Promise<void>;
  /** The host's race option (race-options spec §3.2). */
  setMode(modeId: string): Promise<void>;
  /**
   * What this device may pick. Remembered for the next join, where it rides in
   * the join options; while seated in a lobby, a change is reported at once.
   */
  setAccess(access: AccessSets): void;
  pickCharacter(characterId: string): Promise<void>;
  /** Your colour, if nobody else holds it (select spec §6.7). */
  pickColour(colour: SeatColour): Promise<void>;
  /** The host seats a CPU in the next open seat (CPU players spec §3.1). */
  addCpu(): Promise<void>;
  /** The host frees a CPU's seat. */
  removeCpu(playerId: string): Promise<void>;
  /** Moves your focus in the stage step to a stage, or "?" (select spec §5.2). */
  pickStage(stageId: string): Promise<void>;
  /** Your seed choice in the stage step (stage seeds spec §3.1). */
  pickSeed(seed: SeedChoice): Promise<void>;
  /** Moves your focus in the song step to a song, or "?" (select spec §5.2). */
  pickSong(songId: string): Promise<void>;
  /** Locks your focus in the current pick step. */
  lockIn(): Promise<void>;
  /** Says this device has loaded the chosen stage. */
  loaded(): Promise<void>;
  /**
   * Where the device's remembered colour is read from, for the join options:
   * the room gives it at the join if nobody holds it (select spec §6.7).
   */
  setColourSource(source: () => SeatColour | undefined): void;
  /** This device's class, sent in every join (unlockables spec §3). */
  setDeviceClass(deviceClass: DeviceClass): void;
  sendInput(input: InputFrame): void;
  /**
   * Sends a clock probe carrying the client's predicted tick, and returns its
   * id, or undefined when there is no room to probe. The answer arrives as
   * `onPong`.
   */
  sendPing(tick: number): number | undefined;
  /**
   * The round trip to the room, from recent probes, or undefined before one
   * has been answered. A race reads it once, at the start, to set its lead
   * before its own probes have had time to come back.
   */
  roundTripMs?(): number | undefined;
  raceAgain(): Promise<void>;
  /** Asks the room to send the finished race's replay again, after a reload (race-options spec §6.4). */
  getReplay(): Promise<void>;
  /** "Keep room open": answers the idle warning, giving the room a whole new deadline (audit B1). */
  keepRoomOpen(): Promise<void>;
  /**
   * The latest replay the room sent, deflated, kept in memory beside the room
   * until the next race counts down. Nothing is written to storage.
   */
  latestReplay(): Uint8Array | undefined;
  leaveRoom(): Promise<void>;
  /**
   * Reclaims a seat stored by an earlier page load, once.
   *
   * `"none"` when nothing is stored; `"expired"` when the server refused the
   * token, which is then forgotten; `"cancelled"` when a newer session intent
   * superseded this attempt (callers must not navigate). Never retries: the grace loop is for a
   * drop inside one page load, not for a reload.
   */
  resume?(): Promise<ResumeOutcome>;
  latestSnapshot(): RoomSnapshot | undefined;
  /**
   * The room's last finished snapshot, kept after another seat's Race again
   * has moved the room on, until the next race counts down. Results judge it
   * (unlockables spec §5.2) however late they mount. Optional: a port with no
   * room has none.
   */
  latestFinished?(): RoomSnapshot | undefined;
  /**
   * When the latest snapshot arrived, on `performance.now`'s clock. A reader
   * that picks the snapshot up later -- a screen that spent most of a second
   * building itself -- needs to know how old it already is.
   */
  latestSnapshotReceivedAt?(): number | undefined;
  subscribe(listeners: Partial<NetworkListeners>): () => void;
  /**
   * Bytes received off the socket since the port was created, for the netcode
   * overlay. Optional: a port with no socket has nothing to count.
   */
  wireBytesIn?(): number;
  readonly connectionState: ConnectionState;
  readonly localPlayerId: string | undefined;
  /** The joined room's code, which the lobby shows and a reconnect needs. */
  readonly roomCode: string | undefined;
}

/**
 * A port that does nothing.
 *
 * Used while booting, before a room exists, so that no screen has to hold an
 * optional network reference.
 */
export class OfflineNetwork implements NetworkPort {
  readonly connectionState: ConnectionState = "offline";
  readonly localPlayerId: string | undefined = undefined;
  readonly roomCode: string | undefined = undefined;

  private refuse(): Promise<never> {
    return Promise.reject(new Error("not connected to a room"));
  }

  createRoom(): Promise<void> {
    return this.refuse();
  }
  joinRoom(): Promise<void> {
    return this.refuse();
  }
  quickMatch(): Promise<void> {
    return this.refuse();
  }
  setReady(): Promise<void> {
    return this.refuse();
  }
  setLapCount(): Promise<void> {
    return this.refuse();
  }
  setClock(): Promise<void> {
    return this.refuse();
  }
  setMode(): Promise<void> {
    return this.refuse();
  }
  setAccess(): void {}
  pickCharacter(): Promise<void> {
    return this.refuse();
  }
  pickColour(): Promise<void> {
    return this.refuse();
  }
  addCpu(): Promise<void> {
    return this.refuse();
  }
  removeCpu(): Promise<void> {
    return this.refuse();
  }
  pickStage(): Promise<void> {
    return this.refuse();
  }
  pickSeed(): Promise<void> {
    return this.refuse();
  }
  pickSong(): Promise<void> {
    return this.refuse();
  }
  lockIn(): Promise<void> {
    return this.refuse();
  }
  loaded(): Promise<void> {
    return this.refuse();
  }
  setColourSource(): void {}
  setDeviceClass(): void {}
  sendInput(): void {}
  sendPing(): number | undefined {
    return undefined;
  }
  raceAgain(): Promise<void> {
    return this.refuse();
  }
  leaveRoom(): Promise<void> {
    return Promise.resolve();
  }
  latestSnapshot(): RoomSnapshot | undefined {
    return undefined;
  }
  getReplay(): Promise<void> {
    return this.refuse();
  }
  keepRoomOpen(): Promise<void> {
    return this.refuse();
  }
  latestReplay(): Uint8Array | undefined {
    return undefined;
  }
  subscribe(): () => void {
    return () => {};
  }
}
