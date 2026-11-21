/**
 * The story bot (story mode v2, U3) in Node: `playChapter` runs a chapter
 * through the run's own input sample, with no picture, using the client's
 * `storyBot` for its hands.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { asRevision, type StoryChapter } from "@floor-fifty/shared/content/game-content";
import { StoryRun } from "../../../../../apps/client/src/features/story/story-run";
import type { StoryEvent } from "../../../../../apps/client/src/features/story/director";
import { floorAt } from "../../../../../apps/client/src/features/story/rules";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";

export const STORY = GENERATED_CONTENT.content.story;
export const chapterNamed = (id: string): StoryChapter => STORY.chapters.find((chapter) => chapter.id === id)!;

import { storyBot, type BotOptions } from "../../../../../apps/client/src/features/story/story-bot";

export { storyBot, type BotOptions };

const revisions = { contentRevision: asRevision("c".repeat(64)), rulesetRevision: asRevision("r".repeat(64)) };

export type BotRun = {
  readonly run: StoryRun;
  /** Every story event, with the tick it came on. */
  readonly events: readonly (StoryEvent & { readonly tick: number })[];
  /** One entry per tick: what the bot saw after it. */
  readonly trace: readonly TraceRow[];
  readonly ticks: number;
};

export type TraceRow = {
  readonly tick: number;
  readonly phase: string;
  readonly out: boolean;
  readonly playerFloor: number;
  readonly lavaY: number | undefined;
  /** Units a second the lava is rising this tick. */
  readonly lavaRise: number | undefined;
  readonly actors: readonly { readonly id: string; readonly floor: number; readonly y: number; readonly leash: boolean }[];
  readonly racePhase: RaceState["phase"];
  readonly raceTick: number;
  readonly player: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly grounded: boolean };
  readonly intent: { readonly left: boolean; readonly right: boolean; readonly fastFall: boolean };
};

export function playChapter(chapter: StoryChapter, options: BotOptions = {}): BotRun {
  let intent = { left: false, right: false, fastFall: false, reset: false };
  const run = new StoryRun({
    chapter,
    actors: STORY.actors,
    tuning: GENERATED_CONTENT.content.baseTuning,
    revisions,
    sample: () => intent,
    names: { you: "You", actor: (id) => id },
  });
  const events: (StoryEvent & { tick: number })[] = [];
  const trace: TraceRow[] = [];
  const maxTicks = options.maxTicks ?? 60 * 60 * 6;
  const bot = storyBot(chapter, options);

  for (let tick = 0; tick < maxTicks && !run.director.done; tick += 1) {
    const director = run.director;
    const playerId = run.playerId;
    intent = bot(run, tick);
    run.advance(TICK_MS);
    for (const event of run.takeStoryEvents()) events.push({ ...event, tick });
    const after = run.state;
    trace.push({
      tick,
      phase: director.phase.id,
      out: director.out,
      playerFloor: director.playerFloor,
      lavaY: director.lavaEdge?.y,
      lavaRise: director.lavaEdge?.rise,
      actors: director.actors.list.map((actor) => ({
        id: actor.id,
        floor: floorAt(after, after.players[actor.playerId]!.y),
        y: after.players[actor.playerId]!.y,
        leash: actor.leash,
      })),
      racePhase: after.phase,
      raceTick: after.tick,
      player: (({ x, y, vx, vy, grounded }) => ({ x, y, vx, vy, grounded }))(after.players[playerId]!),
      intent,
    });
  }
  return { run, events, trace, ticks: trace.length };
}
