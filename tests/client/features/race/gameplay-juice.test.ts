/**
 * Racer juice on screen (polish spec §4): the scene hears a bounce in what it
 * draws and answers it with dust in the world.
 */

import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { SNAPSHOT_INTERVAL_TICKS } from "../../../../apps/client/src/lib/constants";
import { shippedContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const FRAME_MS = 1000 / 60;

/** A remote racer falling until tick 36, then bouncing. */
const remoteAt = (tick: number) =>
  snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: REMOTE_ID, x: 40, y: 200, vy: tick < 36 ? -300 : 268 })] });

describe("racer juice in a race", () => {
  it("throws dust in the world when a remote racer's drawn fall turns into a rise", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort() });
    const dust = () => gameplay.screen["scene"]!.view.dustLayer.children[0]!.children.filter((child) => child.visible);

    let most = 0;
    for (let tick = 0; tick <= 60; tick += SNAPSHOT_INTERVAL_TICKS) {
      gameplay.network.emitSnapshot(remoteAt(tick));
      for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
        gameplay.screen.draw(FRAME_MS);
        most = Math.max(most, dust().length);
      }
    }
    expect(most, "the bounce threw its puff").toBe(GENERATED_CONTENT.content.juice.bounce.dust.count);
  });

  it("pops the HUD and cues ui.pop once for the local racer's authoritative floor, when the picture reaches it", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: LOCAL_ID });
    const landed = {
      id: `24:floorLanded:${LOCAL_ID}:f1`,
      tick: 24,
      type: "floorLanded",
      playerId: LOCAL_ID,
      floorId: "f1",
      floorIndex: 1,
    } as RaceEvent;
    const localAt = (tick: number, events: RaceEvent[] = []) =>
      snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: LOCAL_ID })], events });

    for (let tick = 0; tick <= 60; tick += SNAPSHOT_INTERVAL_TICKS) {
      // The batch carrying the event arrives twice, as a reconnect delivers it.
      gameplay.network.emitSnapshot(localAt(tick, tick === 24 || tick === 27 ? [landed] : []));
      for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) gameplay.screen.draw(FRAME_MS);
    }
    expect(gameplay.screen["scene"]!["hud"].floorsPop).toBe(1);
    expect(gameplay.audio.calls.filter((call) => call.startsWith("cue:ui.pop:"))).toEqual([`cue:ui.pop:ui:${landed.id}`]);
  });
});

describe("a slam replaces the landing it lands on (Wonder spec §3.2)", () => {
  type Turn = "none" | "bounce" | "slam";
  /**
   * Draws until the screen has a scene and a netcode, then hands one frame a
   * predicted local landing and draws `turns.length` frames, each frame's
   * drawn turn as given: the drawn racer turns a tick after the landing is
   * drained, as the live race draws it.
   */
  async function landing(turns: Turn[]) {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: LOCAL_ID });
    for (let tick = 0; tick <= 12; tick += SNAPSHOT_INTERVAL_TICKS) {
      gameplay.network.emitSnapshot(snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: LOCAL_ID })] }));
      gameplay.screen.draw(FRAME_MS);
    }
    const netcode = gameplay.screen["netcode"]!;
    const scene = gameplay.screen["scene"]!;
    const landed = { id: "14:floorLanded:local:f3", tick: 14, type: "floorLanded", playerId: LOCAL_ID, floorId: "f3", floorIndex: 3 } as RaceEvent;
    let drained = false;
    netcode.drainPredictedEvents = () => (drained ? [] : ((drained = true), [landed]));
    let frame = -1;
    const turn = (): Turn => turns[frame] ?? "none";
    const heardLanding: boolean[] = [];
    const draw = scene.draw.bind(scene);
    scene.draw = (...args: Parameters<typeof scene.draw>) => {
      heardLanding.push(args[5] === true);
      draw(...args);
    };
    const moment = (kind: "bounce" | "slam") => ({ kind, playerId: LOCAL_ID, x: 0, y: 0, fromX: 0, key: `${LOCAL_ID}:${kind}` });
    Object.defineProperty(scene, "localSlammed", { get: () => turn() === "slam" });
    Object.defineProperty(scene, "juiceFrame", {
      get: () => ({ moments: turn() === "none" ? [] : [moment(turn() as "bounce" | "slam")], reached: [], localSlammed: turn() === "slam" }),
    });
    gameplay.audio.calls.length = 0;
    const landingsByFrame: number[] = [];
    for (frame = 0; frame < turns.length; frame += 1) {
      gameplay.screen.draw(FRAME_MS);
      landingsByFrame.push(gameplay.audio.calls.filter((call) => call.startsWith("cue:sfx.land")).length);
    }
    return { heardLanding, landingsByFrame };
  }

  it("holds the landing until the drawn racer turns, and tells those draws a landing is coming", async () => {
    const { heardLanding, landingsByFrame } = await landing(["none", "bounce", "none"]);
    expect(landingsByFrame).toEqual([0, 1, 1]);
    expect(heardLanding).toEqual([true, true, false]);
  });

  it("drops the landing when the drawn turn a tick later is a slam", async () => {
    const { landingsByFrame } = await landing(["none", "slam", "none", "none", "none", "none"]);
    expect(landingsByFrame.at(-1)).toBe(0);
  });

  it("drops the landing when the slam comes on the same frame", async () => {
    const { landingsByFrame } = await landing(["slam", "none"]);
    expect(landingsByFrame.at(-1)).toBe(0);
  });

  it("plays a landing no turn answers within four frames, never later", async () => {
    const { landingsByFrame } = await landing(["none", "none", "none", "none", "none", "none"]);
    expect(landingsByFrame).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe("the stage answering the race (Wonder spec §6.3)", () => {
  it("jolts the near city when a racer slams", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort() });
    const slamming = (tick: number) =>
      snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: REMOTE_ID, x: 40, y: 200, vy: tick < 36 ? -1341 : 268 })] });
    let most = 0;
    for (let tick = 0; tick <= 60; tick += SNAPSHOT_INTERVAL_TICKS) {
      gameplay.network.emitSnapshot(slamming(tick));
      for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
        gameplay.screen.draw(FRAME_MS);
        most = Math.max(most, Math.abs(gameplay.screen["scene"]!.view.stageMotion?.jolt ?? 0));
      }
    }
    expect(most).toBeGreaterThan(0);
  });
});

describe("set pieces in a race (Wonder spec §6.4)", () => {
  it("plays a stage's set piece at the gate's call: weather in the sky, and none for a floor with no piece", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort() });
    gameplay.network.emitSnapshot(snapshotAt(0, { phase: "racing", players: [playerSnapshot({ id: REMOTE_ID })] }));
    gameplay.screen.draw(FRAME_MS);
    const scene = gameplay.screen["scene"]!;
    expect(scene.forceSetPiece(33)).toBe(false);
    expect(scene.forceSetPiece(45)).toBe(true);
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(FRAME_MS);
    expect(scene.view.skyParticles.live).toBeGreaterThan(0);
  });
});

describe("set pieces and the beat layer across a race's life", () => {
  it("starts the stage's story over on a rewind", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort() });
    const at = (tick: number) => snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: REMOTE_ID })] });
    gameplay.network.emitSnapshot(at(30));
    gameplay.screen.draw(FRAME_MS);
    const scene = gameplay.screen["scene"]!;
    expect(scene.forceSetPiece(45)).toBe(true);
    scene.draw(at(40), FRAME_MS);
    expect(scene["setPieceClock"].active?.floor).toBe(45);
    // The timeline jumps back, as a replay's rewind does.
    scene.draw(at(5), FRAME_MS);
    expect(scene["setPieceClock"].active).toBeUndefined();
  });

  it("leaves no beat layer on the stage once the race is gone", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort() });
    gameplay.network.emitSnapshot(snapshotAt(0, { phase: "racing", players: [playerSnapshot({ id: REMOTE_ID })] }));
    gameplay.screen.draw(FRAME_MS);
    const world = gameplay.screen["scene"]!["context"].stage.world;
    expect(world.children.some((child) => child.label === "juice-beat-layer")).toBe(true);
    gameplay.screen.exit();
    expect(world.children.some((child) => child.label === "juice-beat-layer")).toBe(false);
  });
});

describe("the pop-up words in a race (Wonder spec §5)", () => {
  /** The words drawn in the world now. */
  const shownWords = (gameplay: Awaited<ReturnType<typeof gameplayWithFakeNetwork>>) =>
    gameplay.screen["scene"]!.view.wordLayer.children.flatMap((root) => root.children.filter((child) => child.visible)).map((word) => ({ text: word.label }));

  it("says SLAM! above a racer whose drawn fall turns into a rise", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort() });
    const slamming = (tick: number) =>
      snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: REMOTE_ID, x: 40, y: 200, vy: tick < 36 ? -1341 : 268 })] });
    const seen = new Set<string>();
    for (let tick = 0; tick <= 60; tick += SNAPSHOT_INTERVAL_TICKS) {
      gameplay.network.emitSnapshot(slamming(tick));
      for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
        gameplay.screen.draw(FRAME_MS);
        for (const word of shownWords(gameplay)) seen.add(word.text);
      }
    }
    expect(seen).toContain("SLAM!");
  });

  it("counts the local racer's floor streak, with its rising sting", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: LOCAL_ID });
    const landed = (tick: number, floorIndex: number) =>
      ({ id: `${tick}:floorLanded:${LOCAL_ID}:f${floorIndex}`, tick, type: "floorLanded", playerId: LOCAL_ID, floorId: `f${floorIndex}`, floorIndex }) as RaceEvent;
    const seen = new Set<string>();
    for (let tick = 0; tick <= 60; tick += SNAPSHOT_INTERVAL_TICKS) {
      const events = tick === 12 ? [landed(12, 1)] : tick === 24 ? [landed(24, 2)] : tick === 36 ? [landed(36, 3)] : [];
      gameplay.network.emitSnapshot(snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: LOCAL_ID })], events }));
      for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
        gameplay.screen.draw(FRAME_MS);
        for (const word of shownWords(gameplay)) seen.add(word.text);
      }
    }
    expect(seen).toContain("×3");
    expect(gameplay.audio.calls.some((call) => call.startsWith("cue:sfx.streakStep:"))).toBe(true);
  });

  it("stamps LAP 2! in a three-lap race, and leaves the lap to the race announcer's own line", async () => {
    const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: LOCAL_ID });
    const lapped = { id: `24:lapCompleted:${LOCAL_ID}:1`, tick: 24, type: "lapCompleted", playerId: LOCAL_ID, lap: 1 } as RaceEvent;
    const beats = new Set<string>();
    const announced = new Set<string>();
    for (let tick = 0; tick <= 48; tick += SNAPSHOT_INTERVAL_TICKS) {
      gameplay.network.emitSnapshot(
        snapshotAt(tick, { phase: "racing", lapCount: 3, players: [playerSnapshot({ id: LOCAL_ID })], events: tick === 24 ? [lapped] : [] }),
      );
      for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
        gameplay.screen.draw(FRAME_MS);
        const scene = gameplay.screen["scene"]!;
        for (const root of scene.view.beatLayer.children) for (const child of root.children) if (child.visible) beats.add(child.label);
        announced.add(scene["hud"]["announcement"] as string);
      }
    }
    expect(beats).toContain("LAP 2!");
    expect([...announced].some((line) => line.includes("LAP 2!"))).toBe(false);
    expect(gameplay.audio.calls.some((call) => call.startsWith("cue:sfx.stamp:"))).toBe(true);
  });
});

it("carries a real predictor wall collision through the screen into sparks, brace and scuff", async () => {
  const { freshRaceState, PLAYER_ID } = await import("../../../shared/support/race");
  const { stateToSnapshot } = await import("../../support/snapshots");
  const state = freshRaceState();
  const floor = state.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
  const player = state.players[PLAYER_ID]!;
  player.x = floor.x - (state.tuning.FLOOR_WIDTH + state.tuning.PLAYER_WIDTH) / 2 + 1;
  player.y = floor.y;
  player.vy = 0;
  const game = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: PLAYER_ID, latestSnapshot: stateToSnapshot(state, []) });
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    let particles = 0;
    for (let frame = 0; frame < 6; frame++) {
      game.screen.draw(FRAME_MS);
      particles = Math.max(particles, game.screen["scene"]!["juice"].liveParticles);
    }
    expect(game.audio.calls.some((call) => call.startsWith("cue:sfx.wallScuff:"))).toBe(true);
    expect(particles).toBeGreaterThan(0);
    expect(Math.abs(game.screen["scene"]!["juice"]["lean"].drawnOf(PLAYER_ID, FRAME_MS * 2))).toBeGreaterThan(0);
  } finally { window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" })); game.screen.exit(); }
});
