/**
 * The presentation contract.
 *
 * Screens, flow events, presentation events, and presentation actions are all
 * named here, in code, and authored content may only choose among them. That
 * asymmetry is the whole point: `flow.toml` and `events.toml` pick which of
 * these code-owned capabilities are wired to which, and can never introduce a
 * screen, an event name, a payload shape, or an executable behaviour.
 *
 * Nothing in this file is generated and nothing in it is an authored value.
 * The `FLOW_TARGETS` and `PRESENTATION_ROUTE_CAPABILITIES` tables are positive
 * capability lists -- what the implementations are prepared to do -- not a
 * copy of the shipped graph.
 *
 * The imports are type-only by necessity: `common/protocol.ts` names
 * `RevisionHash` from `content/game-content.ts`, so a value import in either
 * direction would close a runtime cycle. `verbatimModuleSyntax` erases these.
 */

import type { PlayerId } from "../common/ids";
import type { ServerErrorCode } from "../common/protocol";

/** Every screen the client implements. Content selects; it never adds. */
export const SCREEN_IDS = ["Splash", "MainMenu", "Lobby", "Gameplay", "GameEnd", "Tutorial", "Replay"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

/** Every navigation fact a flow action may resolve. */
export const FLOW_EVENTS = [
  "splashComplete",
  "resumeRoom",
  "play",
  "back",
  "roomRacing",
  "raceFinished",
  "recoverToMenu",
  "leaveRace",
  "raceAgain",
  "returnToMenu",
  "tutorial",
  "tutorialToTitle",
  "tutorialToLobby",
  "watchReplay",
  "replayExit",
  "replayExitToRoom",
] as const;
export type FlowEvent = (typeof FLOW_EVENTS)[number];

/** How a flow edge changes screens (race-flow spec §7.1). Code-owned, like screens and events. */
export const TRANSITION_STYLES = ["cut", "fade", "liquid"] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

export type FlowTransition = {
  readonly from: ScreenId;
  readonly event: FlowEvent;
  readonly to: ScreenId;
  /** Absent is a cut. */
  readonly transition?: TransitionStyle | undefined;
};

export type PresentationFlow = {
  readonly entry: ScreenId;
  readonly transitions: readonly FlowTransition[];
};

/**
 * Presentation events and their payloads.
 *
 * A payload carries only what an action is entitled to read. Authored content
 * cannot declare, interpolate, filter, or transform any of it.
 */
export type PresentationEventMap = {
  readonly "app.splash-ready": Readonly<Record<string, never>>;
  /** The race is under way: published as its countdown begins, which happens on the stage (race-flow spec §3). */
  readonly "room.racing": Readonly<Record<string, never>>;
  readonly "room.finished": { readonly winnerId?: PlayerId };
  readonly "room.recovery-required": { readonly code: ServerErrorCode };
  readonly "ui.race-again-settled": Readonly<Record<string, never>>;
  readonly "ui.return-to-menu-settled": Readonly<Record<string, never>>;
  /** Splash reclaimed a seat an earlier page load held (launch polish §3.1.6). */
  readonly "app.room-resumed": Readonly<Record<string, never>>;
  /** The title's Play. */
  readonly "ui.play-requested": Readonly<Record<string, never>>;
  /** The lobby's Back. */
  readonly "ui.back-requested": Readonly<Record<string, never>>;
  /** The pause overlay's Leave race, once the seat is given up. */
  readonly "ui.leave-race-settled": Readonly<Record<string, never>>;
  /** The title's quick action, or the lobby's first-Play offer (launch polish §3.1.4). */
  readonly "ui.tutorial-requested": Readonly<Record<string, never>>;
  /** The tutorial closed toward the title: Exit from there, or Back to title. */
  readonly "ui.tutorial-closed-to-title": Readonly<Record<string, never>>;
  /** The tutorial closed toward the lobby: Exit from there, or Race now. */
  readonly "ui.tutorial-closed-to-lobby": Readonly<Record<string, never>>;
  /** Results' Watch replay, once the replay has been checked against this client's content (race-options spec §7.1). */
  readonly "ui.watch-replay": Readonly<Record<string, never>>;
  /** The replay closed back to results. */
  readonly "ui.replay-exit": Readonly<Record<string, never>>;
  /** The replay closed toward the room, which had moved on to the ready room or beyond. */
  readonly "ui.replay-exit-to-room": Readonly<Record<string, never>>;
};

export type PresentationEventName = keyof PresentationEventMap;

/**
 * The same names as runtime values, for schemas and enumeration.
 *
 * `satisfies` rather than a bare literal so that adding a key to the map
 * without adding it here fails the build instead of silently shrinking what
 * the compiler will accept.
 */
export const PRESENTATION_EVENT_NAMES = [
  "app.splash-ready",
  "room.racing",
  "room.finished",
  "room.recovery-required",
  "ui.race-again-settled",
  "ui.return-to-menu-settled",
  "app.room-resumed",
  "ui.play-requested",
  "ui.back-requested",
  "ui.leave-race-settled",
  "ui.tutorial-requested",
  "ui.tutorial-closed-to-title",
  "ui.tutorial-closed-to-lobby",
  "ui.watch-replay",
  "ui.replay-exit",
  "ui.replay-exit-to-room",
] as const satisfies readonly PresentationEventName[];

/** Every action a route may name. Each is implemented and registered in code. */
export const PRESENTATION_ACTION_IDS = [
  "flow.splash-complete",
  "flow.room-racing",
  "flow.race-finished",
  "flow.recover-to-menu",
  "flow.race-again",
  "flow.return-to-menu",
  "flow.resume-room",
  "flow.play",
  "flow.back",
  "flow.leave-race",
  "flow.tutorial",
  "flow.tutorial-to-title",
  "flow.tutorial-to-lobby",
  "flow.watch-replay",
  "flow.replay-exit",
  "flow.replay-exit-to-room",
] as const;
export type PresentationActionId = (typeof PRESENTATION_ACTION_IDS)[number];

export type PresentationRoute = {
  readonly source: PresentationEventName;
  /** Ascending execution order within one source. Declaration order is noise. */
  readonly order: number;
  readonly action: PresentationActionId;
};

export type PresentationRouting = { readonly routes: readonly PresentationRoute[] };

/** Flow and routing are replaced together or not at all. */
export type PresentationConfig = {
  readonly flow: PresentationFlow;
  readonly routing: PresentationRouting;
};

/**
 * Where a screen is prepared to go for a given flow event.
 *
 * The capability boundary between data and code. A destination absent from a
 * pair's list is one the source screen's implementation has never been written
 * to leave for, so authored content may not select it.
 */
export const FLOW_TARGETS = {
  Splash: { splashComplete: ["MainMenu"], resumeRoom: ["Lobby"] },
  // The title. Rooms are formed in the lobby it leads to (launch polish §3.1.1).
  MainMenu: { play: ["Lobby"], tutorial: ["Tutorial"] },
  Lobby: { back: ["MainMenu"], roomRacing: ["Gameplay"], raceFinished: ["GameEnd"], tutorial: ["Tutorial"] },
  Gameplay: { raceFinished: ["GameEnd"], recoverToMenu: ["MainMenu"], leaveRace: ["MainMenu"] },
  GameEnd: {
    raceAgain: ["Lobby"],
    returnToMenu: ["MainMenu"],
    roomRacing: ["Gameplay"],
    watchReplay: ["Replay"],
  },
  // Offline, so it closes back to where it was opened (launch polish §3.1.4).
  Tutorial: { tutorialToTitle: ["MainMenu"], tutorialToLobby: ["Lobby"] },
  // The viewer is the client's own (D-O6): it leaves for results, or for the
  // room once the room has moved on.
  Replay: { replayExit: ["GameEnd"], replayExitToRoom: ["Lobby"] },
} as const;

/** Which actions each presentation source may be routed to. */
export const PRESENTATION_ROUTE_CAPABILITIES = {
  "app.splash-ready": ["flow.splash-complete"],
  "room.racing": ["flow.room-racing"],
  "room.finished": ["flow.race-finished"],
  "room.recovery-required": ["flow.recover-to-menu"],
  "ui.race-again-settled": ["flow.race-again"],
  "ui.return-to-menu-settled": ["flow.return-to-menu"],
  "app.room-resumed": ["flow.resume-room"],
  "ui.play-requested": ["flow.play"],
  "ui.back-requested": ["flow.back"],
  "ui.leave-race-settled": ["flow.leave-race"],
  "ui.tutorial-requested": ["flow.tutorial"],
  "ui.tutorial-closed-to-title": ["flow.tutorial-to-title"],
  "ui.tutorial-closed-to-lobby": ["flow.tutorial-to-lobby"],
  "ui.watch-replay": ["flow.watch-replay"],
  "ui.replay-exit": ["flow.replay-exit"],
  "ui.replay-exit-to-room": ["flow.replay-exit-to-room"],
} as const satisfies Record<PresentationEventName, readonly PresentationActionId[]>;

/**
 * The subset of capabilities an artifact must actually wire.
 *
 * A later optional action extends `PRESENTATION_ROUTE_CAPABILITIES` alone; an
 * accessibility-required pairing extends this too.
 */
export const PRESENTATION_ROUTE_REQUIREMENTS = [
  ["app.splash-ready", "flow.splash-complete"],
  ["room.racing", "flow.room-racing"],
  ["room.finished", "flow.race-finished"],
  ["room.recovery-required", "flow.recover-to-menu"],
  ["ui.race-again-settled", "flow.race-again"],
  ["ui.return-to-menu-settled", "flow.return-to-menu"],
  ["app.room-resumed", "flow.resume-room"],
  ["ui.play-requested", "flow.play"],
  ["ui.back-requested", "flow.back"],
  ["ui.leave-race-settled", "flow.leave-race"],
  ["ui.tutorial-requested", "flow.tutorial"],
  ["ui.tutorial-closed-to-title", "flow.tutorial-to-title"],
  ["ui.tutorial-closed-to-lobby", "flow.tutorial-to-lobby"],
  ["ui.watch-replay", "flow.watch-replay"],
  ["ui.replay-exit", "flow.replay-exit"],
  ["ui.replay-exit-to-room", "flow.replay-exit-to-room"],
] as const satisfies readonly (readonly [PresentationEventName, PresentationActionId])[];
