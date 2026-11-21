/**
 * The local story run (story mode v2): paced on fixed ticks by the render
 * clock, drawn as a room's snapshot, with the chapter's actors as racers and
 * the story's lava as the player's edge.
 */

import { describe, expect, it } from "vitest";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { StoryRun, raceToSnapshot, type StoryRunOptions } from "../../../../apps/client/src/features/story/story-run";
import { actorPlayerId } from "../../../../apps/client/src/features/story/actors";
import { STORY_RULES } from "../../../../apps/client/src/features/story/rules";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { chapterNamed } from "./support/story-bot";

const revisions = { contentRevision: asRevision("c".repeat(64)), rulesetRevision: asRevision("r".repeat(64)) };
const idle = () => ({ left: false, right: false, fastFall: false, reset: false });

/** A run of a chapter whose held input the test sets, as a player's hands would. */
function controlled(id = "lowtown", extra: Partial<StoryRunOptions> = {}) {
  const held = idle();
  const run = new StoryRun({
    chapter: chapterNamed(id),
    actors: GENERATED_CONTENT.content.story.actors,
    tuning: GENERATED_CONTENT.content.baseTuning,
    revisions,
    sample: () => ({ ...held }),
    names: { you: "You", actor: (actor) => `name-${actor}` },
    ...extra,
  });
  /** Steps `ticks` ticks, five a frame at most, as the render clock would. */
  const play = (ticks: number) => {
    let snapshot = run.advance(0);
    for (let left = ticks; left > 0; left -= 5) snapshot = run.advance(TICK_MS * Math.min(5, left));
    return snapshot;
  };
  return { run, held, play };
}

describe("the local story run", () => {
  it("draws the player in their remembered colour and character, and the actors as authored, flagged CPU", () => {
    const plain = controlled().run;
    const dressed = controlled("lowtown", { colour: "violet", characterId: "frog" }).run;
    const you = (run: StoryRun) => run.advance(0).players.find((player) => player.id === run.playerId)!;
    expect(you(plain)).toMatchObject({ colour: "scarlet", characterId: "ninja", name: "You", cpu: false });
    expect(you(dressed)).toMatchObject({ colour: "violet", characterId: "frog" });
    const frog = plain.advance(0).players.find((player) => player.id === actorPlayerId("frog"))!;
    const authored = GENERATED_CONTENT.content.story.actors["frog"]!;
    expect(frog).toMatchObject({ name: "name-frog", characterId: authored.characterId, colour: authored.colour, cpu: true });
    plain.dispose();
    dressed.dispose();
  });

  it("plays each chapter on its own seed, with one racer for the player and one for each actor", () => {
    for (const chapter of GENERATED_CONTENT.content.story.chapters) {
      const { run } = controlled(chapter.id);
      const snapshot = run.advance(0);
      expect(snapshot.seed).toBe(chapter.seed);
      expect(snapshot.players).toHaveLength(1 + chapter.actors.length);
      expect(snapshot.phase).toBe("racing");
      run.dispose();
    }
  });

  it("never holds the run still: it steps on fixed ticks from the first frame", () => {
    const { run } = controlled();
    expect(run.advance(TICK_MS * 3 + 1).tick).toBe(3);
    run.dispose();
  });

  it("caps catch-up after a long frame", () => {
    const { run } = controlled();
    expect(run.advance(5_000).tick).toBe(5);
    run.dispose();
  });

  it("freezes while paused, and drops the time spent paused", () => {
    const { run } = controlled();
    run.advance(TICK_MS);
    run.setPaused(true);
    expect(run.advance(TICK_MS * 4).tick).toBe(1);
    run.setPaused(false);
    expect(run.advance(TICK_MS).tick).toBe(2);
    run.dispose();
  });

  it("projects a race state into the snapshot shape the view already draws", () => {
    const { run } = controlled();
    const snapshot = run.advance(TICK_MS);
    expect(snapshot.platforms).toHaveLength(snapshot.floorCount);
    expect(snapshot.contentRevision).toBe(revisions.contentRevision);
    expect(raceToSnapshot(run.state, [], revisions).tick).toBe(snapshot.tick);
    run.dispose();
  });

  it("reports each tick's race events once, on the frame that stepped them", () => {
    const { run, held } = controlled();
    held.right = true;
    const events: RaceEvent[] = [];
    for (let frame = 0; frame < 120; frame += 1) {
      events.push(...run.advance(TICK_MS).events);
      expect(run.advance(0).events).toEqual([]);
    }
    expect(events.some((event) => event.type === "floorLanded")).toBe(true);
    run.dispose();
  });

  it("hands over the story's events once each: the chapter's start lines come first", () => {
    const { run } = controlled();
    const first = run.takeStoryEvents();
    expect(first.some((event) => event.kind === "say")).toBe(true);
    expect(run.takeStoryEvents()).toEqual([]);
    run.dispose();
  });

  it("ignores the manual reset: the story has its own way back", () => {
    const { run, held } = controlled();
    run.advance(TICK_MS);
    held.reset = true;
    const events: RaceEvent[] = [];
    for (let frame = 0; frame < 10; frame += 1) events.push(...run.advance(TICK_MS).events);
    expect(events.some((event) => event.type === "playerReset")).toBe(false);
    run.dispose();
  });

  it("sends a player who climbs the whole course back to the start rather than finishing", () => {
    const { run } = controlled();
    run.advance(TICK_MS);
    const state = run.state;
    state.players[run.playerId]!.visitedFloorIds = state.course.floors.map((floor) => floor.id);
    const events: RaceEvent[] = [];
    for (let frame = 0; frame < 10; frame += 1) events.push(...run.advance(TICK_MS).events);
    const snapshot = run.advance(0);
    expect(events.some((event) => event.type === "raceFinished")).toBe(false);
    expect(snapshot.phase).toBe("racing");
    expect(snapshot.standings).toEqual([]);
    expect(run.advance(TICK_MS).tick).toBe(snapshot.tick + 1);
    run.dispose();
  });
});

describe("the story's lava as the player's edge", () => {
  it("has no edge in a chapter without lava", () => {
    const { run } = controlled("lowtown");
    expect(run.edge).toBeUndefined();
    run.dispose();
  });

  it("carries the lava under the player in the snapshot, and stands still while OUT! shows", () => {
    const { run, held, play } = controlled("snow");
    const local = () => run.advance(0).players.find((player) => player.id === run.playerId)!;
    expect(run.edge).toBeDefined();
    expect(local().floorEdgeY).toBe(run.edge!.y);
    // Pressed once, then hands off: the lava waits for that first press, then comes up and catches her.
    held.right = true;
    play(1);
    held.right = false;
    for (let ticks = 0; ticks < 60 * 60 && !run.out; ticks += 1) play(1);
    expect(run.out).toBe(true);
    const tick = run.advance(0).tick;
    expect(run.advance(TICK_MS * 3).tick).toBe(tick);
    play(STORY_RULES.caughtTicks);
    expect(run.out).toBe(false);
    expect(run.edge).toBeDefined();
    run.dispose();
  });
});
