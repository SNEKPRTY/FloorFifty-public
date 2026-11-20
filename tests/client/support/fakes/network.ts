import type { InputFrame, RoomSnapshot, ServerError } from "@floor-fifty/shared/common/protocol";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type {
  ConnectionState,
  NetworkListeners,
  NetworkPort,
  ResumeOutcome,
} from "../../../../apps/client/src/features/net/network";
import { settleUi } from "./ui";

export class FakeNetwork implements NetworkPort {
  connectionState: ConnectionState = "offline";
  localPlayerId: string | undefined = undefined;
  /** Set once a room is joined, exactly as the real manager does. */
  roomCode: string | undefined = undefined;

  readonly sentInputs: InputFrame[] = [];
  readonly calls: string[] = [];
  private snapshot: RoomSnapshot | undefined;
  private readonly listeners: Partial<NetworkListeners>[] = [];

  /** Set to make the next room command fail, as a server refusal would. */
  nextFailure: ServerError | undefined = undefined;

  private refuseIfAsked(): void {
    const failure = this.nextFailure;
    if (failure === undefined) return;
    this.nextFailure = undefined;
    throw Object.assign(new Error(failure.message), failure);
  }

  async createRoom(name: string): Promise<void> {
    this.calls.push(`createRoom:${name}`);
    this.refuseIfAsked();
    this.connectionState = "connected";
    this.roomCode = "ABC123";
    this.localPlayerId = "room-p1";
  }
  async quickMatch(name: string): Promise<void> {
    this.calls.push(`quickMatch:${name}`);
    this.refuseIfAsked();
    this.connectionState = "connected";
    this.roomCode = "ABC123";
    this.localPlayerId = "room-p1";
  }
  async joinRoom(code: string, name: string): Promise<void> {
    this.calls.push(`joinRoom:${code}:${name}`);
    this.refuseIfAsked();
    this.connectionState = "connected";
    this.roomCode = code;
    this.localPlayerId = "room-p2";
  }
  async setReady(ready: boolean): Promise<void> {
    this.calls.push(`setReady:${ready}`);
    this.refuseIfAsked();
  }
  async setLapCount(lapCount: 1 | 3): Promise<void> {
    this.calls.push(`setLapCount:${lapCount}`);
    this.refuseIfAsked();
  }
  async setClock(seconds: number): Promise<void> {
    this.calls.push(`setClock:${seconds}`);
    this.refuseIfAsked();
  }
  async setMode(modeId: string): Promise<void> {
    this.calls.push(`setMode:${modeId}`);
    this.refuseIfAsked();
  }
  access: AccessSets | undefined = undefined;
  setAccess(access: AccessSets): void {
    this.access = access;
    this.calls.push(`setAccess:${access.characters.join(",")}`);
  }
  async pickCharacter(characterId: string): Promise<void> {
    this.calls.push(`pickCharacter:${characterId}`);
    this.refuseIfAsked();
  }
  setColourSource(): void {}
  setDeviceClass(): void {}
  async addCpu(): Promise<void> {
    this.calls.push("addCpu");
    this.refuseIfAsked();
  }
  async removeCpu(playerId: string): Promise<void> {
    this.calls.push(`removeCpu:${playerId}`);
    this.refuseIfAsked();
  }
  async pickColour(colour: SeatColour): Promise<void> {
    this.calls.push(`pickColour:${colour}`);
    this.refuseIfAsked();
  }
  async pickStage(stageId: string): Promise<void> {
    this.calls.push(`pickStage:${stageId}`);
    this.refuseIfAsked();
  }
  async pickSeed(seed: "random" | "classic" | number): Promise<void> {
    this.calls.push(`pickSeed:${seed}`);
    this.refuseIfAsked();
  }
  async pickSong(songId: string): Promise<void> {
    this.calls.push(`pickSong:${songId}`);
    this.refuseIfAsked();
  }
  async lockIn(): Promise<void> {
    this.calls.push("lockIn");
    this.refuseIfAsked();
  }
  async loaded(): Promise<void> {
    this.calls.push("loaded");
    this.refuseIfAsked();
  }
  sendInput(input: InputFrame): void {
    this.sentInputs.push(input);
  }
  /** Probes sent, by tick; nothing answers them unless a test does. */
  readonly sentPings: number[] = [];
  sendPing(tick: number): number | undefined {
    this.sentPings.push(tick);
    return this.sentPings.length;
  }
  async raceAgain(): Promise<void> {
    this.calls.push("raceAgain");
  }
  /** The replay the fake room last sent; `deliverReplay` sets it. */
  replay: Uint8Array | undefined = undefined;
  /** How many `getReplay` asks to refuse before one is accepted, as a room mid-reconnect would. */
  refuseReplayAsks = 0;
  async getReplay(): Promise<void> {
    this.calls.push("getReplay");
    if (this.refuseReplayAsks > 0) {
      this.refuseReplayAsks -= 1;
      throw new Error("the room is not reachable");
    }
  }
  latestReplay(): Uint8Array | undefined {
    return this.replay;
  }
  /** The room sending the finished race's replay (race-options spec §6.4). */
  deliverReplay(bytes: Uint8Array): void {
    this.replay = bytes;
    for (const listener of [...this.listeners]) listener.onReplay?.(bytes);
    settleUi();
  }
  async keepRoomOpen(): Promise<void> {
    this.calls.push("keepRoomOpen");
    this.refuseIfAsked();
  }
  /** The room warning that it is about to close, or saying it was kept open (`null`). */
  emitIdleWarning(closesInSeconds: number | null): void {
    for (const listener of [...this.listeners]) listener.onIdleWarning?.({ closesInSeconds });
    settleUi();
  }
  /** What the next boot-time `resume` reports; nothing is stored by default. */
  resumeOutcome: ResumeOutcome = "none";
  async resume(): Promise<ResumeOutcome> {
    this.calls.push("resume");
    return this.resumeOutcome;
  }
  async leaveRoom(): Promise<void> {
    this.calls.push("leaveRoom");
    this.roomCode = undefined;
    this.localPlayerId = undefined;
    // As the real manager does: leaving tells its listeners it is offline.
    this.emitConnectionState("offline");
  }
  latestSnapshot(): RoomSnapshot | undefined {
    return this.snapshot;
  }
  private finished: RoomSnapshot | undefined = undefined;
  latestFinished(): RoomSnapshot | undefined {
    return this.finished;
  }
  subscribe(listeners: Partial<NetworkListeners>): () => void {
    this.listeners.push(listeners);
    return () => {
      const index = this.listeners.indexOf(listeners);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  /**
   * How many listeners are currently attached.
   *
   * Exposed so a test can assert that something which subscribes also lets go.
   * A leaked subscription is invisible in every other assertion -- the object
   * under test keeps working -- right up until a discarded one reacts to a
   * snapshot meant for its replacement.
   */
  get subscriberCount(): number {
    return this.listeners.length;
  }

  /** Delivers a snapshot as the transport would. */
  emitSnapshot(snapshot: RoomSnapshot): void {
    this.snapshot = snapshot;
    // As the real manager keeps it: retired when the next race counts down.
    if (snapshot.phase === "countdown" || snapshot.phase === "racing") this.finished = undefined;
    if (snapshot.phase === "finished") this.finished = snapshot;
    for (const listener of [...this.listeners]) listener.onSnapshot?.(snapshot);
    settleUi();
  }

  emitError(error: ServerError): void {
    for (const listener of [...this.listeners]) listener.onError?.(error);
    settleUi();
  }

  /** Delivers the server's content-replaced notification. */
  emitContentRevision(contentRevision: string): void {
    for (const listener of [...this.listeners]) listener.onContentRevision?.(contentRevision);
    settleUi();
  }

  /** Answers a probe, as the room would. */
  emitPong(pong: { id: number; rttMs: number; slack: number | null }): void {
    for (const listener of [...this.listeners]) listener.onPong?.(pong);
  }

  emitConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    for (const listener of [...this.listeners]) listener.onConnectionState?.(state);
    settleUi();
  }
}
