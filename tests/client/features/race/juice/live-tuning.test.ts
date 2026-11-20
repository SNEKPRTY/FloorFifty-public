// @vitest-environment node
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { juiceLiveTuningFor } from "../../../../../apps/client/src/lib/juice-flags";
import { LiveTuning } from "../../../../../apps/client/src/features/race/juice/live-tuning";

const withHitStop = (artifact: GameContent, hitStopMs: number): GameContent => ({
  ...artifact,
  content: {
    ...artifact.content,
    juice: { ...artifact.content.juice, slam: { ...artifact.content.juice.slam, hitStopMs } },
  },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("?dev=juice", () => {
  it("is on only in a dev build that asks for it", () => {
    expect(juiceLiveTuningFor("?dev=juice", true)).toBe(true);
    expect(juiceLiveTuningFor("?dev=unlock-all&dev=juice", true)).toBe(true);
    expect(juiceLiveTuningFor("?dev=juice", false)).toBe(false);
    expect(juiceLiveTuningFor("", true)).toBe(false);
    expect(juiceLiveTuningFor("?dev=juicebox", true)).toBe(false);
  });
});

describe("LiveTuning", () => {
  it("refreshes once a second while enabled, and reads the newest artifact", async () => {
    vi.useFakeTimers();
    let artifact = GENERATED_CONTENT;
    const content = { current: () => artifact, refresh: vi.fn(async () => artifact) };
    const live = new LiveTuning(content, true);
    expect(live.juice()!.slam.hitStopMs).toBe(50);

    artifact = withHitStop(artifact, 80);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(content.refresh).toHaveBeenCalledTimes(1);
    expect(live.juice()!.slam.hitStopMs).toBe(80);

    live.destroy();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(content.refresh).toHaveBeenCalledTimes(1);
  });

  it("never polls when disabled", async () => {
    vi.useFakeTimers();
    const content = { current: () => GENERATED_CONTENT, refresh: vi.fn(async () => GENERATED_CONTENT) };
    const live = new LiveTuning(content, false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(content.refresh).not.toHaveBeenCalled();
    live.destroy();
  });

  it("when disabled, holds the juice the race began with, as the scene holds its stage", () => {
    let artifact = GENERATED_CONTENT;
    const live = new LiveTuning({ current: () => artifact, refresh: async () => artifact }, false);
    artifact = withHitStop(artifact, 80);
    expect(live.juice()!.slam.hitStopMs).toBe(50);
    live.destroy();
  });

  it("reports no juice, rather than failing, before any content has loaded", () => {
    const live = new LiveTuning({ current: () => undefined, refresh: async () => GENERATED_CONTENT }, false);
    expect(live.juice()).toBeUndefined();
    live.destroy();
  });

  it("keeps the last good juice through a failed refresh", async () => {
    vi.useFakeTimers();
    const content = {
      current: () => GENERATED_CONTENT,
      refresh: vi.fn(async (): Promise<GameContent> => {
        throw new Error("offline");
      }),
    };
    const live = new LiveTuning(content, true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(content.refresh).toHaveBeenCalledTimes(2);
    expect(live.juice()!.slam.hitStopMs).toBe(50);
    live.destroy();
  });
});
