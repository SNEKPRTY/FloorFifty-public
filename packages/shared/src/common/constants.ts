/**
 * Invariants only.
 *
 * A value belongs here when changing it would invalidate determinism, protocol
 * framing, or room capacity. Nothing here is ever authorable by the content
 * pipeline; anything with a safe range belongs in `common/tuning.ts` instead.
 */

/** Fixed simulation frequency. Every `dt` in the simulation derives from this. */
export const TICK_HZ = 60;

/** Milliseconds per simulation tick. */
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds per simulation tick. Every `dt` in the simulation is this value. */
export const TICK_SECONDS = 1 / TICK_HZ;

/** Authority snapshot broadcast frequency. */
export const SNAPSHOT_HZ = 20;

/** Logical render viewport. Pixel art is letterboxed into this, never reflowed. */
export const VIEWPORT = { width: 960, height: 540 } as const;

/** Hard room capacity. */
export const MAX_PLAYERS = 4;

/**
 * An endless course's body window (race-options spec §5.4): floors this far
 * below and above each racer have a Planck body, and no others do. Rules, not
 * tunables, because which bodies exist changes how a contact resolves; they
 * reach `rulesetRevision` through `rulesetSchemaVersion`.
 */
export const FLOOR_WINDOW_BELOW = 6;
export const FLOOR_WINDOW_ABOVE = 8;
/** An endless course never grows past this many floors; a growth that would is a `SIMULATION_FAILURE`. 3:00 of the reference bot reaches about 220. */
export const ENDLESS_FLOOR_CAP = 1000;

/** Survival's clock when the host has not chosen one, in seconds (survival spec S2). */
export const DEFAULT_CLOCK_SECONDS = 180;

/**
 * Wire format version. A mismatch is refused during matchmaking, before a join.
 *
 * Nineteen, because a racer's edge waits for their first input (first-race
 * spec §2): each seat's snapshot carries `edgeWaitTicks`, and one tunable,
 * `SURVIVAL_START_WAIT_TICKS`, joined the ruleset. An eighteen client would
 * predict an edge the room is still holding.
 *
 * Eighteen, because a join carries the client's build (release readiness
 * §4.2): `buildId` and `rulesetRevision` ride the join options, a ruleset
 * difference is refused at the join, and the refusals SERVER_UPDATING and
 * SERVER_BUSY exist. A seventeen client never sends its build, and would read
 * either new refusal as a room that does not exist.
 *
 * Seventeen, because a stage pick carries a seed (stage seeds spec §3): each
 * pick row its `seed`, the select its `stageSeed` and `stageClassic`, and the
 * seat sends `pickSeed`. A sixteen client could never choose one, and would
 * build every random course as the stage's authored one.
 *
 * Sixteen, because Infinite became Survival (survival spec §3, §5): each
 * seat's snapshot carries `floorEdgeY` and `outAtTick`, the room its
 * `clockSeconds`, the host sends `setClock`, a `playerOut` event exists, and
 * seven tunables joined the ruleset. A fifteen client would predict respawns
 * the room no longer plays and never see its edge.
 *
 * Fifteen, because a seat can be a CPU (CPU players spec §3.1): each player
 * carries a `cpu` flag, and the host sends `addCpu` and `removeCpu`. A
 * fourteen client reads every CPU as a person and has no way to seat one.
 *
 * Fourteen, because the transport moved to Colyseus 0.18: its matchmaking
 * reply and its socket handshake changed shape, and a thirteen client cannot
 * read either. The server refuses an older version at the matchmaking request
 * (`matchmake-version-gate.ts`), so a tab left open across the deploy is told
 * to reload rather than that its room does not exist.
 *
 * Thirteen, because each seat's device class (phone, tablet or desktop) rides
 * the join options and the snapshot (unlockables spec §3): the two-devices
 * condition reads it, and a twelve server would refuse the new join key.
 *
 * Twelve, because a race has options and a replay (race-options spec §8): the
 * snapshot carries `modeId` and each racer's `bestFloor` and `bestFloorAtTick`,
 * the host sends `setMode`, a seat may ask `getReplay`, and the room sends the
 * finished race's `replay` as bytes. An eleven client knows none of it.
 *
 * Eleven, because a room is public or private: the snapshot carries `access`
 * and, in a public lobby, `startsAtTick` and `soloFromTick`; the join options
 * gain `quickMatch`; and a lone racer's Ready can be refused with
 * `STILL_SEARCHING`.
 *
 * Ten, because a racer's lap hold rides the wire (`holdUntilTick`) and two
 * tunables join the ruleset (`LAP_HOLD_TICKS`, `MOVING_FLOOR_CARRY`): a client
 * from before them would predict a lap and a ride the room no longer plays.
 *
 * Nine, because select gains the song and songReveal steps, with the song
 * result on the select state; songId joins the snapshot; and the command
 * pickSong arrives.
 *
 * Eight, because the select phase arrives: a room phase "select" with its
 * step, picks, stage result and loaded seats; stageId, roomSeed and
 * courseRevision on the snapshot; and the commands pickStage, lockIn and
 * loaded.
 *
 * Seven, because a player carries a colour of their choosing (colour), the
 * join options an optional colour, the room's to grant if nobody holds it,
 * and pickColour arrives (select spec §6.7).
 *
 * Six, because a seat carries its character (characterId), a race its round,
 * the join options an optional access report, and two commands arrive:
 * pickCharacter and reportAccess.
 *
 * Five, because a race's first input changed meaning. A racer stands on the
 * starting floor until it arrives, and the player snapshot carries
 * `awaitingInput` to say so; a version-4 client reads the field as absent and
 * predicts a bounce from the first tick that the room never makes.
 *
 * Four, because input changed meaning. A frame now carries the tick it takes
 * effect on and the room holds it until then; a version-3 client sends frames
 * without one, and every one of them would be refused as malformed.
 *
 * Three, because the transport changed. Two carried the snapshot's prediction
 * fields; three replaces snapshots with Colyseus schema patches, replaces the
 * acknowledgement envelope with correlated `commandResult` messages, and
 * replaces the seat token with Colyseus's reconnection token. A version-2
 * client cannot speak any of it, and refusing the join says so rather than
 * seating them into a room they will never render.
 */
export const PROTOCOL_VERSION = 19;

/**
 * How far ahead of the room a frame may be stamped.
 *
 * One second. A client leads the room by its round trip plus a little, so
 * anything past this is not a slow link but a clock that has lost track, and
 * holding the frame for it would hold the player's intent for longer than any
 * connection worth racing on.
 */
export const MAX_INPUT_LEAD_TICKS = TICK_HZ;

/**
 * Countdown between every player being ready and the race starting.
 *
 * Measured in ticks rather than milliseconds because the room clock, not the
 * wall clock, is what decides when it expires.
 */
export const COUNTDOWN_TICKS = 3 * TICK_HZ;

/*
 * A public room's two clocks (quick-match spec §5.2). Room-flow constants, like
 * the countdown: they never change a race, so they never reach `rulesetRevision`.
 */

/** From two racers connected to everyone made ready (D-Q1): 30 s. */
export const QUICK_MATCH_START_TICKS = 30 * TICK_HZ;
/** A lone racer in a public room may race alone after this search (D-Q2): 20 s. */
export const QUICK_MATCH_SEARCH_TICKS = 20 * TICK_HZ;

/*
 * The select phase's clocks (select spec §5.1). Room-flow constants, like the
 * countdown: they never change a race, so they never reach `rulesetRevision`.
 */

/** A pick step's clock (select spec D-S2): stage, then song, each 15 s. */
export const SELECT_STEP_TICKS = 15 * TICK_HZ;
/**
 * How long a reveal's result stays on screen once it lands: its art grows
 * out to fill the frame (0.6 s, `GROW` in the client's `motion`), its name
 * arrives, and the room holds on it for a second.
 */
export const REVEAL_RESULT_TICKS = 2 * TICK_HZ;
/** A roulette reveal: the spin (2.2 s and its landing, 2.5 s), then the result. */
export const REVEAL_TICKS = 150 + REVEAL_RESULT_TICKS;
/** A reveal with one seat: nothing to spin, just the result. */
export const SOLO_REVEAL_TICKS = REVEAL_RESULT_TICKS;
/** The most the room waits for every seat to load the chosen content. */
export const LOADING_TIMEOUT_TICKS = 10 * TICK_HZ;

/** The body a seat wears until it picks, and the one every seat can pick. */
export const DEFAULT_CHARACTER_ID = "ninja";

/** The mode a room starts on until its host chooses: the catalog's first (race-options spec §3.1). */
export const DEFAULT_MODE_ID = "floors-20";

/** A pick of "surprise me": resolved from the seat's accessible items on the roulette's RNG. */
export const RANDOM_PICK = "?";

/**
 * How long a finite race (20 or 50 floors) may run before it ends on the clock,
 * ranking the racers by the highest floor they reached (audit S11). A finite
 * race used to end only when someone finished the course, so a room with a
 * racer who never did stepped for ever and its replay recording grew without
 * bound. A good racer finishes in about a minute. Survival has its own clock
 * (`RACE_TIME_LIMIT_TICKS`). The Owner's number (2026-11-14): ten minutes.
 */
export const FINITE_RACE_TIME_LIMIT_TICKS = 10 * 60 * TICK_HZ;

/** How long a disconnected player stays a reconnectable ghost before a DNS. */
export const RECONNECT_GRACE_TICKS = 30 * TICK_HZ;

/**
 * How long a room whose first player has not arrived is kept for them (audit
 * B1). The matchmaker has reserved the seat and the socket is on its way, but
 * a create over HTTP that never connects holds a room slot for this long, so it
 * is shorter than a dropped player's grace. The Owner's number.
 */
export const UNARRIVED_ROOM_TICKS = 10 * TICK_HZ;

/**
 * How long a lobby, select or results room may go without a command from any
 * seat before the server closes it (audit B1). A room with a player in it never
 * expired, so tabs left on a lobby or results screen held a room slot for ever.
 * A countdown or a race is never closed by this. The Owner's number.
 */
export const ROOM_IDLE_TICKS = 10 * 60 * TICK_HZ;

/**
 * How long before an idle room closes its players are told (audit B1, the
 * warning): one minute, or half the deadline for a deadline under two minutes.
 * Any command from any seat, `stillHere` included, gives the room a whole new
 * deadline and arms the warning again.
 */
export const IDLE_WARNING_TICKS = 60 * TICK_HZ;

/**
 * Milliseconds between schema patches.
 *
 * The same twenty hertz the snapshot broadcast ran at, expressed the way
 * Colyseus asks for it. Derived rather than written as `50` so the two cannot
 * drift apart.
 */
export const PATCH_RATE_MS = 1000 / SNAPSHOT_HZ;

/**
 * How many command results a seat remembers.
 *
 * A retry of a correlated command must receive the same answer rather than
 * mutating twice, and a client that could make the server remember an
 * unbounded number of request ids would have found a memory leak with a name.
 */
export const COMMAND_RESULT_HISTORY = 64;

/**
 * What one seat may ask of its room (audit B2): a command is a button press,
 * and a player makes a few a second at most (a ready toggle, a pick, a lock-in).
 * A burst of ten covers a fast run through the select screens; five a second
 * is more than a hand can press. Anything past it is dropped without an answer,
 * so a script that loops on commands costs the room a counter, not a parse, a
 * state projection and a reply each. Measured on the room clock. The Owner's
 * numbers (2026-11-14).
 */
export const COMMAND_BUDGET = { burst: 10, perSecond: 5 } as const;

/**
 * The most messages of any kind one socket may send a room in a second, before
 * Colyseus closes it with an error (audit B2). The outer guard behind the
 * command and input budgets, which are what limit a flood; Colyseus's own
 * default is no limit. A racing client sends one input a tick (60) and four
 * pings, and a stall of a second or two flushes its queued frames beside the
 * live ones, so this sits well above that: dropping a real player on a weak
 * phone network is worse than the room this gives an attacker. A closed seat is
 * held for the reconnect grace. The Owner's number (2026-11-14, "7b").
 */
export const MAX_MESSAGES_PER_SECOND = 200;

/** Longest request id a correlated command may carry. */
export const REQUEST_ID_MAX_LENGTH = 64;

/**
 * The public server's limits per address and overall (release readiness
 * §6.1). A burst, then one more per refill. Four players behind one router,
 * with the reconnects a weak signal brings, fit inside every one of them.
 */
export const RATE_LIMITS = {
  /** Opening a room: Create room, and Find a race, which may open one. */
  create: { burst: 3, refillMs: 20_000 },
  /** Taking a seat by code. Code guessing meets this. */
  join: { burst: 10, refillMs: 2_000 },
  /**
   * Find a race, which fills a listed room or opens one. Its own bucket: four
   * players behind one router, with a retry each, fit in the burst, and one
   * address opens rooms through it no faster than through Create room.
   */
  findRace: { burst: 8, refillMs: 10_000 },
  /** Reclaiming a held seat, kept apart from joins so a flaky family is never locked out. */
  reconnect: { burst: 10, refillMs: 2_000 },
  /** Operational telemetry from one address (§7.1). */
  telemetry: { burst: 20, refillMs: 3_000 },
} as const;

/** Addresses the rate buckets remember at most; the least recently seen is forgotten first. */
export const RATE_BUCKET_MAX_KEYS = 10_000;

/**
 * Rooms one address may have open at once, counted by who created them (audit
 * B1). Four players behind one router share one room, or two. Without it two
 * addresses could hold every `MAX_ROOMS` slot. The Owner's number.
 */
export const MAX_ROOMS_PER_ADDRESS = 3;

/** Open sockets from one address: four players and their reconnects. */
export const MAX_SOCKETS_PER_IP = 16;

/** Sockets beyond four per room that the server holds for joins in flight. */
export const SOCKET_HEADROOM = 64;

/** The largest matchmaking request body; join options are a few hundred bytes. */
export const MATCHMAKE_BODY_LIMIT_BYTES = 4_096;

/** The largest WebSocket message, pinned so a library upgrade cannot move it. */
export const WS_MAX_PAYLOAD_BYTES = 4_096;

/** The largest telemetry event body (§7.1). */
export const TELEMETRY_BODY_LIMIT_BYTES = 2_048;
