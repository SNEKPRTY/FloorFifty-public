<script lang="ts">
  /**
   * A character on the title's rooftop (select spec §6.1, amended again
   * 2026-09-30): one cell of the race's own sheet, drawn in the DOM at a
   * whole-number scale, standing on the title's ledge and facade art.
   *
   * A change to `cue` plays `move` (the drop or the hop) and then idles; cue
   * 0 plays nothing. `held` stops on idle's first frame: a locked or DLC
   * character, waiting. The facade hangs below the ledge as far as the
   * parent lets it; the parent clips it.
   *
   * The sheet is a CSS background, which never says it failed: a probe
   * watches it, and a dropped request is drawn again from its retry.
   */
  import { untrack } from "svelte";
  import { productionArt, watchImage } from "../../lib/image-retry";
  import { reducedMotion } from "../kit/motion";
  import { IDLE_FRAMES, SHEET, sequence, type StageFrame, type StageMove } from "./stage-motion";

  let {
    sheet,
    scale,
    tone = "colour",
    held = false,
    random = false,
    move = "drop",
    cue = 0,
  }: {
    sheet: string | undefined;
    scale: number;
    tone?: "colour" | "dimmed" | "grey";
    held?: boolean;
    random?: boolean;
    move?: StageMove;
    cue?: number;
  } = $props();

  let frame = $state<StageFrame>(IDLE_FRAMES[0]!);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function play(frames: readonly StageFrame[], then: () => void): void {
    clearTimeout(timer);
    let index = 0;
    const next = (): void => {
      const current = frames[index++];
      if (current === undefined) {
        then();
        return;
      }
      frame = current;
      timer = setTimeout(next, current.ms);
    };
    next();
  }

  function idle(): void {
    if (held) {
      clearTimeout(timer);
      frame = IDLE_FRAMES[0]!;
      return;
    }
    play(IDLE_FRAMES, idle);
  }

  // Only the cue replays; `held` is read when the move ends, and a view that
  // changes it always comes with a cue.
  $effect(() => {
    const kind = move;
    const at = cue;
    untrack(() => play(at === 0 ? [] : sequence(kind, reducedMotion()), idle));
    return () => clearTimeout(timer);
  });

  const cell = $derived(SHEET.frame * scale);

  /** The retry this sheet is drawn from, once its first request has failed. */
  let retried = $state<{ sheet: string; url: string } | undefined>();
  const drawn = $derived(sheet !== undefined && retried?.sheet === sheet ? retried.url : sheet);
  $effect(() => {
    const watched = sheet;
    if (watched === undefined) return;
    return watchImage(watched, (url) => (retried = { sheet: watched, url }));
  });

  const FACADE = productionArt("menu-facade.png");
  const LEDGE_SLAB = productionArt("menu-ledge-slab.png");
</script>

<div class="ff-stage" data-testid="character-stage" data-tone={tone} style:--ff-stage-scale={scale} aria-hidden="true">
  <div class="ff-stage__roof">
    <span class="ff-stage__facade" style:background-image={`url(${FACADE})`}></span>
    <span class="ff-stage__ledge" style:background-image={`url(${LEDGE_SLAB})`}></span>
  </div>
  {#if random}
    <span data-testid="stage-random" class="ff-stage__random">?</span>
  {:else}
    <span
      data-testid="stage-sprite"
      data-frame={`${frame.row}:${frame.column}`}
      class="ff-stage__sprite"
      style:background-image={drawn === undefined ? undefined : `url("${drawn}")`}
      style:background-size={`${SHEET.columns * cell}px ${SHEET.rows * cell}px`}
      style:background-position={`${-frame.column * cell}px ${-frame.row * cell}px`}
      style:translate={`-50% ${-frame.lift * scale}px`}
    ></span>
  {/if}
  {#if frame.dust === true}<span data-testid="stage-dust" class="ff-stage__dust"></span>{/if}
</div>

<style>
  /* The sprite at its scale; the title's rooftop plate at a quarter of it,
     so the 96 px plate reads as a parapet under a 32 px body, not a wall.
     The standing line is 38 plate pixels above the plate's foot, as the
     title's racers stand. */
  .ff-stage {
    --ff-stage-unit: calc(var(--ff-stage-scale) * 1px);
    --ff-ledge-unit: calc(var(--ff-stage-scale) * 0.25px);
    --ff-stand: calc(38 * var(--ff-ledge-unit));
    position: relative;
    height: 100%;
    min-height: calc(32 * var(--ff-stage-unit) + 96 * var(--ff-ledge-unit));
  }
  /* A soft light behind the character, as the boards draw it. */
  .ff-stage::before {
    content: "";
    position: absolute;
    left: 50%;
    bottom: var(--ff-stand);
    width: calc(56 * var(--ff-stage-unit));
    height: calc(56 * var(--ff-stage-unit));
    translate: -50% 25%;
    border-radius: 50%;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--ff-panel-border) 65%, transparent), transparent);
  }
  .ff-stage__roof {
    position: absolute;
    left: var(--ff-roof-left, 6%);
    right: var(--ff-roof-right, 6%);
    bottom: 0;
    height: calc(96 * var(--ff-ledge-unit));
  }
  .ff-stage__facade {
    position: absolute;
    top: calc(72 * var(--ff-ledge-unit));
    left: 4%;
    right: 4%;
    height: 200vh;
    background-size: calc(140 * var(--ff-ledge-unit)) calc(144 * var(--ff-ledge-unit));
    image-rendering: pixelated;
  }
  .ff-stage__ledge {
    position: absolute;
    inset: 0;
    background-size: calc(310 * var(--ff-ledge-unit)) 100%;
    background-repeat: round no-repeat;
    image-rendering: pixelated;
  }
  .ff-stage__sprite,
  .ff-stage__random {
    position: absolute;
    z-index: 1;
    left: 50%;
    bottom: var(--ff-stand);
    width: calc(32 * var(--ff-stage-unit));
    height: calc(32 * var(--ff-stage-unit));
  }
  .ff-stage__sprite {
    background-repeat: no-repeat;
    image-rendering: pixelated;
  }
  .ff-stage__random {
    display: grid;
    place-items: center;
    translate: -50% 0;
    font: 600 max(var(--ff-type-hint), round(down, calc(20 * var(--ff-stage-unit)), var(--ff-type-hint))) / 1 var(--ff-font-ui);
    color: var(--ff-text);
  }
  /* Two pearl pixels either side of the feet, on the landing's first frame. */
  .ff-stage__dust {
    position: absolute;
    z-index: 2;
    left: 50%;
    bottom: var(--ff-stand);
    width: calc(3 * var(--ff-stage-unit));
    height: calc(2 * var(--ff-stage-unit));
    translate: calc(-50% - 11 * var(--ff-stage-unit)) 0;
    /* Ink, not a panel: two pixels of dust. */
    background: var(--ff-panel-border);
    box-shadow: calc(22 * var(--ff-stage-unit)) 0 var(--ff-panel-border);
  }
  [data-tone="dimmed"] .ff-stage__sprite {
    filter: saturate(0.5) brightness(0.72);
  }
  [data-tone="grey"] .ff-stage__sprite {
    filter: grayscale(1) opacity(0.75);
  }
</style>
