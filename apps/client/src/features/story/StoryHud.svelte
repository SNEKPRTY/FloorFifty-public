<script lang="ts">
  /**
   * The story's HUD over the climb (story mode v2 spec, "In the climb"). It
   * never stops play and never takes a press: everything here is
   * `pointer-events: none`, so the touch controls under it keep every finger.
   *
   * Top, under the race HUD's band: the glim counter under the floor counter,
   * the objective chip in the middle, the wind chip under it. At an edge: the
   * pointer toward a friend to go down to, or the nearest shut lamp. Low in
   * the field, above the thumbs: the control chip and the bark line with its
   * speaker's portrait. Over the field: the wind's streaks, the "Safe spot"
   * word and the lava's glow. Under reduced motion nothing slides, flies,
   * streams or springs; every word, chip and glow still shows.
   */
  import * as m from "../../paraglide/messages.js";
  import { GLYPHS } from "../i18n/glyphs";
  import { inputMethod } from "../platform/input-method.svelte";
  import { reducedMotion } from "../kit/motion";
  import Panel from "../kit/Panel.svelte";
  import GlimIcon from "./GlimIcon.svelte";
  import { GLYPH_FOR_CHIP, chipWords } from "./control-chip";
  import { FLIGHT_MS, type StoryHudModel, type StoryHudOptions } from "./story-hud.svelte";

  let { model, prompts, settings, onLanded }: StoryHudOptions & { model: StoryHudModel; onLanded: (id: number) => void } = $props();

  const glyph = $derived(
    inputMethod.method === "gamepad" && model.chip !== undefined ? GLYPHS[inputMethod.family][GLYPH_FOR_CHIP[model.chip]]() : undefined,
  );
  const words = $derived(
    model.chip === undefined ? undefined : chipWords(prompts, model.chip, inputMethod.method, settings.value.input.touchMode, glyph),
  );

  let counter = $state<HTMLElement | undefined>();

  /** A glim's flight to the counter: from where it was taken, over 350 ms, then the counter pops. */
  function fly(node: HTMLElement, flight: { id: number; left: number; top: number }) {
    const frame = node.offsetParent?.getBoundingClientRect();
    const target = counter?.getBoundingClientRect();
    if (frame === undefined || target === undefined || reducedMotion() || typeof node.animate !== "function") {
      onLanded(flight.id);
      return;
    }
    const toLeft = target.left - frame.left + 14;
    const toTop = target.top - frame.top + target.height / 2;
    const animation = node.animate(
      [
        { transform: `translate(${flight.left}px, ${flight.top}px) scale(1.4)` },
        { transform: `translate(${(flight.left + toLeft) / 2}px, ${Math.min(flight.top, toTop) - 40}px) scale(1.1)`, offset: 0.45 },
        { transform: `translate(${toLeft}px, ${toTop}px) scale(0.8)` },
      ],
      { duration: FLIGHT_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0.4)", fill: "forwards" },
    );
    animation.onfinish = () => onLanded(flight.id);
    return { destroy: () => animation.cancel() };
  }

  /** The counter's pop on each glim that lands: a quick spring, none under reduced motion. */
  function pop(node: HTMLElement, pops: number) {
    let last = pops;
    return {
      update(next: number) {
        if (next === last) return;
        last = next;
        if (reducedMotion() || typeof node.animate !== "function") return;
        node.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)", offset: 0.35 }, { transform: "scale(0.96)", offset: 0.7 }, { transform: "scale(1)" }], {
          duration: 320,
          easing: "ease-out",
        });
      },
    };
  }

  const streaks = Array.from({ length: 12 }, (_, index) => ({ top: 8 + ((index * 37) % 84), delay: (index * 173) % 900, width: 40 + ((index * 53) % 70) }));
</script>

{#if !model.hidden && !model.paused}
  <div class="ff-story-hud" data-testid="story-hud" style="--story-top: {model.top}px; --story-left: {model.left}px;">
    {#if model.wind !== undefined}
      <div
        class="ff-story-hud__streaks"
        class:ff-story-hud__streaks--left={model.wind.direction < 0}
        class:ff-story-hud__streaks--warned={!model.wind.blowing}
        class:ff-story-hud__streaks--snow={model.snow}
        data-testid="story-streaks"
        aria-hidden="true"
      >
        {#each streaks as streak, index (index)}
          <span style="top: {streak.top}%; width: {streak.width}px; animation-delay: -{streak.delay}ms; --i: {(index * 8) % 90};"></span>
        {/each}
      </div>
    {/if}

    {#key model.lavaPulses}
      {#if model.lavaPulses > 0}<div class="ff-story-hud__lava" data-testid="story-lava-glow" aria-hidden="true"></div>{/if}
    {/key}

    <span class="ff-story-hud__counter-anchor" bind:this={counter} use:pop={model.glimPops}>
      <Panel as="span" tone="hud" arrive="none" leave="none" class="ff-story-hud__chip ff-story-hud__glims" data-testid="story-glims">
        <GlimIcon class="ff-story-hud__glim-icon" />
        <span class="ff-story-hud__value">{model.glims.carried}/{model.glims.total}</span>
        <span class="sr-only">{m.story_glims_count({ count: model.glims.carried, total: model.glims.total })}</span>
      </Panel>
    </span>

    <div class="ff-story-hud__centre">
      {#if model.objective !== undefined}
        {#key model.objective}
          <Panel as="p" tone="hud" arrive="none" leave="none" class="ff-story-hud__chip ff-story-hud__objective" data-testid="story-objective" aria-live="polite">
            {model.objective}
          </Panel>
        {/key}
      {/if}
      {#if model.wind !== undefined}
        <Panel as="p" tone="hud" arrive="none" leave="none" class="ff-story-hud__chip ff-story-hud__wind" data-testid="story-wind">
          <span class="ff-story-hud__arrow" aria-hidden="true">{model.wind.direction > 0 ? "→" : "←"}</span>
          {m.story_wind()}
        </Panel>
      {/if}
    </div>

    {#if model.pointer !== undefined}
      <div
        class="ff-story-hud__pointer ff-story-hud__pointer--{model.pointer.direction}"
        style="left: {model.pointer.left}px;"
        data-testid="story-pointer"
        data-direction={model.pointer.direction}
      >
        <span class="ff-story-hud__pointer-arrow" aria-hidden="true">{model.pointer.direction === "down" ? "▼" : "▲"}</span>
        <Panel as="span" tone="hud" arrive="none" leave="none" class="ff-story-hud__chip ff-story-hud__pointer-chip">
          {model.pointer.floors === 1 ? m.story_floor_away() : m.story_floors_away({ count: model.pointer.floors })}
        </Panel>
      </div>
    {/if}

    {#key model.safeSpots}
      {#if model.safeSpots > 0}
        <p class="ff-story-hud__word" data-testid="story-safe-spot">{m.story_safe_spot()}</p>
      {/if}
    {/key}

    <div class="ff-story-hud__low">
      {#if words !== undefined}
        {#key model.chip}
          <Panel as="p" tone="hud" leave="none" data-testid="story-chip" class="ff-story-hud__control ff-aq-body m-0 px-12 py-4 font-ui text-aq-ink">
            {words.before}{#if words.glyph !== undefined}<kbd class="ff-keycap">{words.glyph}</kbd>{/if}{words.after}
          </Panel>
        {/key}
      {/if}
      {#if model.line !== undefined}
        {#key model.line}
          <Panel as="section" tone="hud" leave="none" aria-live="polite" data-testid="story-line" class="ff-story-hud__line font-ui text-aq-ink">
            {#if model.line.portrait !== undefined}
              <img class="ff-story-hud__portrait" src={model.line.portrait} alt="" width="40" height="40" draggable="false" />
            {/if}
            <p class="ff-aq-body m-0">
              {#if model.line.speaker !== undefined}<strong>{model.line.speaker}:</strong>{/if}
              {model.line.text}
            </p>
          </Panel>
        {/key}
      {/if}
    </div>

    {#each model.flights as flight (flight.id)}
      <span class="ff-story-hud__flight" use:fly={flight}><GlimIcon /></span>
    {/each}
  </div>
{/if}


<style>
  .ff-story-hud {
    position: absolute;
    inset: 0;
    z-index: 9;
    pointer-events: none;
    overflow: hidden;
  }

  .ff-story-hud__counter-anchor {
    position: absolute;
    top: var(--story-top);
    left: var(--story-left);
    display: inline-block;
    transform-origin: 20% 50%;
  }
  :global(.ff-story-hud__chip) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    margin: 0;
    font-size: var(--ff-type-hint);
    color: var(--ff-text);
    white-space: nowrap;
  }
  :global(.ff-story-hud__glim-icon) {
    width: 18px;
    height: 18px;
    shape-rendering: crispEdges;
    image-rendering: pixelated;
  }
  .ff-story-hud__value {
    font-size: var(--ff-hud-numeral);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .ff-story-hud__centre {
    position: absolute;
    top: var(--story-top);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  /*
   * The objective says itself when it changes, then steps aside after a few
   * seconds: it stood over the climb and hid a friend's name (review R14).
   * The Floors chip keeps the goal, and the pointer the way.
   */
  :global(.ff-story-hud__objective) {
    font-size: var(--ff-type-body);
    animation:
      ff-story-slide 200ms ease-out both,
      ff-story-step-aside 500ms ease-in 5s forwards;
  }
  @keyframes ff-story-step-aside {
    to {
      opacity: 0;
      visibility: hidden;
    }
  }
  :global(.ff-story-hud__wind) {
    animation: ff-story-slide 200ms ease-out both;
  }
  .ff-story-hud__arrow {
    font-size: var(--ff-hud-numeral);
    line-height: 1;
  }

  .ff-story-hud__pointer {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .ff-story-hud__pointer--down {
    bottom: max(24%, 6rem);
    flex-direction: column-reverse;
  }
  .ff-story-hud__pointer--up {
    top: calc(var(--story-top) + 72px);
  }
  .ff-story-hud__pointer-arrow {
    font-size: 24px;
    line-height: 1;
    color: #f9c22b;
    text-shadow:
      0 2px 0 #2e222f,
      0 -2px 0 #2e222f,
      2px 0 0 #2e222f,
      -2px 0 0 #2e222f;
    animation: ff-story-nudge-down 700ms ease-in-out infinite alternate;
  }
  .ff-story-hud__pointer--up .ff-story-hud__pointer-arrow {
    animation-name: ff-story-nudge-up;
  }

  .ff-story-hud__low {
    position: absolute;
    inset-inline: 0;
    /* Low on the screen, clear of the floors the player is about to land on; above the thumbs on touch. */
    bottom: max(6%, 24px, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-inline: max(var(--ff-gutter), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px), var(--ff-host-reserved-right, 0px));
  }
  /*
   * A short, wide screen: the game's frame runs past the screen's foot, so its
   * "low" was off the bottom (review 2, R5, 1280x480). The words sit low on
   * the screen itself instead; touch still lifts them above the thumbs below.
   */
  @media (max-height: 560px) {
    .ff-story-hud__low {
      position: fixed;
      bottom: max(16px, env(safe-area-inset-bottom));
    }
  }
  @media (pointer: coarse) {
    .ff-story-hud__low {
      bottom: calc(var(--ff-touch-size) + 40px + env(safe-area-inset-bottom));
    }
  }
  /*
   * A phone held upright: the game's frame ends well above the screen's foot,
   * so its "low" was the middle of the screen, under the racer (review R14).
   * The words sit low on the whole screen instead, still above the thumbs.
   */
  @media (pointer: coarse) and (max-aspect-ratio: 3/4) {
    .ff-story-hud__low {
      position: fixed;
      bottom: calc(var(--ff-touch-size) + 24px + env(safe-area-inset-bottom));
    }
  }
  :global(.ff-story-hud__control) {
    font-size: var(--ff-type-hint);
  }
  :global(.ff-story-hud__line) {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(34rem, 100%);
    padding: 8px 14px 8px 8px;
    font-size: var(--ff-type-hint);
    text-align: left;
  }
  .ff-story-hud__portrait {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 2px solid #2e222f;
    background: #3e3546;
    image-rendering: pixelated;
  }

  .ff-story-hud__word {
    position: absolute;
    top: 36%;
    left: 50%;
    margin: 0;
    font-size: var(--ff-type-title);
    color: #30e1b9;
    text-shadow:
      0 3px 0 #2e222f,
      0 -2px 0 #2e222f,
      2px 0 0 #2e222f,
      -2px 0 0 #2e222f;
    transform: translateX(-50%);
    animation: ff-story-word 1400ms ease-out both;
  }

  .ff-story-hud__lava {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: 28%;
    background: linear-gradient(to top, color-mix(in srgb, #e83b3b 55%, transparent), transparent);
    animation: ff-story-glow 700ms ease-out both;
  }

  .ff-story-hud__streaks {
    position: absolute;
    inset: 0;
  }
  .ff-story-hud__streaks span {
    position: absolute;
    left: -15%;
    height: 2px;
    background: #c7dcd0;
    opacity: 0.55;
    animation: ff-story-streak 900ms linear infinite;
  }
  .ff-story-hud__streaks--snow span {
    height: 3px;
    background: #ffffff;
  }
  .ff-story-hud__streaks--warned span {
    opacity: 0.3;
    animation-duration: 1400ms;
  }
  .ff-story-hud__streaks--left span {
    left: auto;
    right: -15%;
    animation-name: ff-story-streak-left;
  }

  .ff-story-hud__flight {
    position: absolute;
    top: -9px;
    left: -9px;
    width: 18px;
    height: 18px;
    shape-rendering: crispEdges;
    filter: drop-shadow(0 0 4px #fbb954);
  }
  .ff-story-hud__flight :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  @keyframes ff-story-slide {
    from {
      transform: translateY(-8px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes ff-story-nudge-down {
    from {
      transform: translateY(-3px);
    }
    to {
      transform: translateY(3px);
    }
  }
  @keyframes ff-story-nudge-up {
    from {
      transform: translateY(3px);
    }
    to {
      transform: translateY(-3px);
    }
  }
  @keyframes ff-story-word {
    0% {
      transform: translateX(-50%) scale(0.6);
      opacity: 0;
    }
    18% {
      transform: translateX(-50%) scale(1.12);
      opacity: 1;
    }
    30% {
      transform: translateX(-50%) scale(1);
    }
    80% {
      opacity: 1;
    }
    100% {
      transform: translateX(-50%) translateY(-12px);
      opacity: 0;
    }
  }
  @keyframes ff-story-glow {
    0% {
      opacity: 0;
    }
    25% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes ff-story-streak {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(140vw);
    }
  }
  @keyframes ff-story-streak-left {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-140vw);
    }
  }

  /* Reduced motion: nothing slides, nudges, streams or springs; every word and glow still shows. */
  @media (prefers-reduced-motion: reduce) {
    :global(.ff-story-hud__objective) {
      animation: ff-story-step-aside 1ms linear 5s forwards;
    }
    :global(.ff-story-hud__wind),
    .ff-story-hud__pointer-arrow,
    .ff-story-hud__streaks span {
      animation: none;
    }
    .ff-story-hud__streaks span {
      left: calc(var(--i, 0) * 1%);
    }
    .ff-story-hud__word {
      animation: ff-story-glow 1400ms linear both;
    }
  }
</style>
