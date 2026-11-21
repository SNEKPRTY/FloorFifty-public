<script lang="ts">
  /**
   * The cutscene player (story mode v2 spec, "The cutscene player"). Letterbox
   * bars, the panel moving as its row says, and the dialogue box: the
   * speaker's portrait in its own glass frame, their name on a chip in their
   * colour, and the line typing out. A press anywhere (a tap, a click, Space,
   * Enter, the pad's confirm) finishes the line, and the next goes on;
   * "Skip", Escape or the pad's back ends it. Nothing advances by itself.
   *
   * The model is `CutscenePlayer`; the clock is handed in, so the screen's own
   * ticker drives it and a test steps it. Under reduced motion nothing pans,
   * types or fades. A panel that fails to load leaves the words on the sky.
   */
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import * as m from "../../paraglide/messages.js";
  import Panel from "../kit/Panel.svelte";
  import Button from "../kit/Button.svelte";
  import GlimIcon from "./GlimIcon.svelte";
  import { CutscenePlayer, type CutscenePanelView } from "./cutscene";

  let {
    panels,
    glims = 0,
    clock,
    reduced,
    paused = false,
    onTick,
    onDone,
  }: {
    panels: readonly CutscenePanelView[];
    /** The glims the player carried, which rise over a panel marked for them. */
    glims?: number;
    /** Calls `step` with the milliseconds of each frame; returns its own stop. */
    clock: (step: (ms: number) => void) => () => void;
    reduced: boolean;
    /** While paused the clock is not heard and presses do nothing. */
    paused?: boolean;
    onTick: () => void;
    onDone: (skipped: boolean) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const player = new CutscenePlayer({ panels }, reduced);
  let frame = $state(0);
  let failed = $state<ReadonlySet<string>>(new Set());
  let ended = false;
  let advance = $state<HTMLButtonElement | undefined>();

  const panelIndex = $derived((frame, player.panel));
  const panelNow = $derived(panels[panelIndex]);
  const lineNow = $derived((frame, panelNow?.lines[player.line]));
  const shown = $derived((frame, player.shown));
  const whole = $derived((frame, player.whole));

  function settle(): void {
    frame += 1;
    if (player.done && !ended) {
      ended = true;
      onDone(player.skipped);
    }
  }

  function press(): void {
    if (paused || ended) return;
    player.press();
    settle();
  }

  function skip(): void {
    if (paused || ended) return;
    player.skip();
    settle();
  }

  onMount(() => {
    advance?.focus({ preventScroll: true });
    const stop = clock((ms) => {
      if (paused || ended) return;
      const ticks = player.advance(ms);
      if (ticks > 0) onTick();
      frame += 1;
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      skip();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  });

  /** The panel's move at this moment: a push scales, a pan slides the spare picture. */
  const artStyle = $derived.by(() => {
    void frame;
    const panel = panelNow;
    if (panel === undefined) return "";
    const share = player.moveShare;
    const at = panel.move.from + (panel.move.to - panel.move.from) * share;
    if (panel.move.kind === "push") return `transform: scale(${at.toFixed(4)});`;
    return `object-position: ${(at * 100).toFixed(2)}% 50%; transform: scale(1.06);`;
  });

  /** The rising glims: each from the bottom, at its own place and time, to stay as a light. */
  const rising = $derived(
    Array.from({ length: glims }, (_, index) => ({
      left: 6 + ((index * 37) % 88),
      top: 8 + ((index * 53) % 46),
      delay: index * 140,
      size: 14 + ((index * 7) % 3) * 4,
    })),
  );
</script>

<div class="ff-cutscene" class:ff-cutscene--still={reduced} data-testid="story-cutscene">
  <div class="ff-cutscene__stage">
    {#key panelIndex}
      <div class="ff-cutscene__panel" transition:fade={{ duration: reduced ? 0 : 400 }} data-testid="story-cutscene-panel" data-panel={panelIndex}>
        {#if panelNow?.src !== undefined && !failed.has(panelNow.src)}
          <!-- On an upright screen the whole picture shows, over a soft wash of itself: the speaker is never cropped away. -->
          <img class="ff-cutscene__wash" src={panelNow.src} alt="" draggable="false" aria-hidden="true" />
          <img
            class="ff-cutscene__art"
            src={panelNow.src}
            alt=""
            draggable="false"
            style={artStyle}
            onerror={() => (failed = new Set([...failed, panelNow!.src!]))}
          />
        {/if}
        {#if panelNow?.glims === true}
          <div class="ff-cutscene__glims" aria-hidden="true">
            {#each rising as glim, index (index)}
              <span
                class="ff-cutscene__glim"
                data-testid="story-rising-glim"
                style="left: {glim.left}%; top: {glim.top}%; width: {glim.size}px; height: {glim.size}px; animation-delay: {glim.delay}ms;"
              >
                <GlimIcon />
              </span>
            {/each}
          </div>
          <Panel as="p" tone="hud" arrive={reduced ? "none" : "rise"} leave="none" class="ff-cutscene__lit" data-testid="story-glims-lit">
            {glims === 1 ? m.story_glim_lit() : m.story_glims_lit({ count: glims })}
          </Panel>
        {/if}
      </div>
    {/key}
  </div>
  <div class="ff-cutscene__bar ff-cutscene__bar--top" aria-hidden="true"></div>
  <div class="ff-cutscene__bar ff-cutscene__bar--bottom" aria-hidden="true"></div>

  <!-- The whole picture is the advance: a tap or click anywhere, or Space and Enter on it. -->
  <button bind:this={advance} type="button" data-motion="none" class="ff-cutscene__advance" data-testid="story-cutscene-advance" aria-label={m.instructions_next()} onclick={press}></button>

  <Button kind="ghost" class="ff-cutscene__skip" data-testid="story-cutscene-skip" data-sfx="back" onclick={skip}>{m.gate_skip()}</Button>

  {#if lineNow !== undefined}
    <div class="ff-cutscene__box-frame">
      <Panel as="section" arrive="none" leave="none" class="ff-cutscene__box {lineNow.speaker === undefined ? 'ff-cutscene__box--narrator' : ''}" data-testid="story-cutscene-box">
        {#if lineNow.portrait !== undefined}
          <span class="ff-cutscene__portrait-frame">
            <img class="ff-cutscene__portrait" src={lineNow.portrait} alt="" width="128" height="128" draggable="false" data-testid="story-cutscene-portrait" />
          </span>
        {/if}
        <div class="ff-cutscene__words">
          {#if lineNow.speaker !== undefined}
            <span class="ff-cutscene__name ff-colour-{lineNow.colour ?? 'gold'}" data-testid="story-cutscene-speaker">{lineNow.speaker}</span>
          {/if}
          <p class="ff-cutscene__line" data-testid="story-cutscene-line">
            <span>{lineNow.text.slice(0, shown)}</span><span class="ff-cutscene__unshown" aria-hidden="true">{lineNow.text.slice(shown)}</span>
          </p>
          <!-- The whole line, read out once, as it is: the typing is for the eyes. -->
          <span class="sr-only" aria-live="polite">{lineNow.speaker === undefined ? "" : `${lineNow.speaker}: `}{lineNow.text}</span>
        </div>
        {#if whole}
          <span class="ff-cutscene__more" aria-hidden="true" data-testid="story-cutscene-more">▼</span>
        {/if}
      </Panel>
    </div>
  {/if}
</div>

<style>
  .ff-cutscene {
    /* The whole window, past the game's frame on a tall phone: a cutscene is the only thing on screen. */
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: hidden;
    background: #2e222f;
    user-select: none;
  }

  .ff-cutscene__stage {
    position: absolute;
    inset: 11% 0;
    overflow: hidden;
    /* The sky behind a panel that has not come, or never will. */
    background: #323353;
  }
  .ff-cutscene__panel {
    position: absolute;
    inset: 0;
  }
  .ff-cutscene__art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    transform-origin: 50% 50%;
    will-change: transform;
  }

  .ff-cutscene__wash {
    display: none;
  }
  /*
   * Upright (a phone held tall): a 16:9 panel covering the stage was cut to
   * its middle third and blown up past sharp, so a speaker at the side was
   * gone (review R4). The whole picture shows instead, its width the screen's,
   * high in the stage, clear of the words box, over a dim, blurred copy.
   */
  @media (max-aspect-ratio: 1/1) {
    .ff-cutscene__wash {
      display: block;
      position: absolute;
      inset: -8%;
      width: 116%;
      height: 116%;
      object-fit: cover;
      filter: blur(14px) brightness(0.45) saturate(0.8);
    }
    .ff-cutscene__art {
      object-fit: contain;
      object-position: 50% 30% !important;
      image-rendering: auto;
    }
  }

  .ff-cutscene__bar {
    position: absolute;
    inset-inline: 0;
    height: 11%;
    background: #2e222f;
    pointer-events: none;
    animation: ff-cutscene-bar 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .ff-cutscene__bar--top {
    top: 0;
    --from: -100%;
  }
  .ff-cutscene__bar--bottom {
    bottom: 0;
    --from: 100%;
  }

  .ff-cutscene__advance {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    border: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ff-cutscene__advance:focus-visible {
    outline: none;
  }

  :global(.ff-cutscene__skip) {
    position: absolute;
    z-index: 1;
    top: max(12px, env(safe-area-inset-top));
    right: max(var(--ff-gutter, 16px), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
  }

  .ff-cutscene__box-frame {
    position: absolute;
    inset-inline: 0;
    bottom: max(3%, env(safe-area-inset-bottom));
    display: flex;
    justify-content: center;
    padding-inline: max(var(--ff-gutter, 16px), env(safe-area-inset-left), env(safe-area-inset-right), var(--ff-host-reserved-left, 0px), var(--ff-host-reserved-right, 0px));
    pointer-events: none;
  }
  :global(.ff-cutscene__box) {
    position: relative;
    display: flex;
    align-items: center;
    gap: 20px;
    width: min(100%, 980px);
    min-height: 152px;
    padding: 12px 52px 12px 12px;
  }
  :global(.ff-cutscene__box--narrator) {
    justify-content: center;
    padding-inline: 52px;
    text-align: center;
  }
  .ff-cutscene__portrait-frame {
    flex: none;
    display: block;
    padding: 4px;
    border: 2px solid rgba(199, 220, 208, 0.4);
    border-radius: 12px;
    background: rgba(62, 53, 70, 0.7);
  }
  .ff-cutscene__portrait {
    display: block;
    width: 128px;
    height: 128px;
    image-rendering: pixelated;
  }
  .ff-cutscene__words {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  :global(.ff-cutscene__box--narrator) .ff-cutscene__words {
    align-items: center;
  }
  .ff-cutscene__name {
    padding: 2px 12px;
    border-radius: 999px;
    background: var(--ff-seat-colour, #f9c22b);
    color: #2e222f;
    font-size: var(--ff-type-body);
    font-weight: 600;
  }
  .ff-cutscene__line {
    margin: 0;
    color: #ffffff;
    font-size: var(--ff-type-title);
    line-height: 1.35;
  }
  /* The rest of the line holds its place, unseen, so the words never jump as they type. */
  .ff-cutscene__unshown {
    visibility: hidden;
  }
  .ff-cutscene__more {
    position: absolute;
    right: 20px;
    bottom: 12px;
    color: #f9c22b;
    font-size: var(--ff-type-hint);
    animation: ff-cutscene-more 900ms ease-in-out infinite;
  }

  .ff-cutscene__glims {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .ff-cutscene__glim {
    position: absolute;
    display: block;
    filter: drop-shadow(0 0 6px #fbb954);
    animation: ff-cutscene-rise 2400ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }
  .ff-cutscene__glim :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  :global(.ff-cutscene__lit) {
    position: absolute;
    top: 16px;
    left: 50%;
    margin: 0;
    padding: 6px 16px;
    transform: translateX(-50%);
    color: #fbff86;
    font-size: var(--ff-type-body);
    white-space: nowrap;
  }

  @keyframes ff-cutscene-bar {
    from {
      transform: translateY(var(--from));
    }
  }
  @keyframes ff-cutscene-more {
    50% {
      transform: translateY(3px);
      opacity: 0.6;
    }
  }
  @keyframes ff-cutscene-rise {
    from {
      transform: translateY(70vh) scale(0.6);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
  }

  @media (max-width: 480px), (max-height: 480px) {
    .ff-cutscene__portrait {
      width: 96px;
      height: 96px;
    }
    :global(.ff-cutscene__box) {
      min-height: 120px;
      gap: 12px;
    }
    .ff-cutscene__line {
      font-size: var(--ff-type-body);
    }
  }

  /* Reduced motion: no pan, no push, no typing, no fade, nothing rises; every word and light still shows. */
  .ff-cutscene--still .ff-cutscene__art {
    transform: none !important;
  }
  .ff-cutscene--still .ff-cutscene__bar,
  .ff-cutscene--still .ff-cutscene__more,
  .ff-cutscene--still .ff-cutscene__glim {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .ff-cutscene__bar,
    .ff-cutscene__more,
    .ff-cutscene__glim {
      animation: none;
    }
  }
</style>
