/**
 * The juice the director reads, fresh every frame (polish spec §4.1).
 *
 * Normally that is just the content the race started with. Under
 * `?dev=juice` it also asks the server for the newest content once a second,
 * so a save to `content/juice.toml` under `pnpm dev` (whose server recompiles
 * on save) is felt in the running race within about a second. A failed
 * refresh keeps the last good artifact: the port still holds it.
 */

import type { JuiceTuning } from "@floor-fifty/shared/content/game-content";
import type { ContentPort } from "../../net/content";

/** How often `?dev=juice` asks the server for the newest content. */
export const LIVE_TUNING_MS = 1_000;

export class LiveTuning {
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  /**
   * The juice the race began with. Without `?dev=juice` this is all it ever
   * reads, for the reason the scene holds its stage: a content refresh
   * mid-race must not change how the race looks.
   */
  private readonly held: JuiceTuning | undefined;

  constructor(
    private readonly content: Pick<ContentPort, "current" | "refresh">,
    private readonly enabled: boolean,
  ) {
    this.held = LiveTuning.read(content);
    this.timer = enabled
      ? setInterval(() => {
          this.content.refresh().catch(() => undefined);
        }, LIVE_TUNING_MS)
      : undefined;
  }

  /** The juice to draw with, or nothing before any content has loaded: then nothing plays. */
  juice(): JuiceTuning | undefined {
    return this.enabled ? LiveTuning.read(this.content) : this.held;
  }

  private static read(content: Pick<ContentPort, "current">): JuiceTuning | undefined {
    return content.current()?.content.juice;
  }

  destroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }
}
