<script lang="ts">
  /**
   * The touch controls, drawn (Controls tab): one small picture per gesture,
   * in a carousel so the tab keeps the height of the keyboard and controller
   * lists beside it. Each picture is a phone held the way the player holds
   * theirs -- upright, or on its side in the landscape form factors -- with the
   * thumb doing the one thing its caption says; the demo plays on CSS, and
   * under reduced motion each is a still frame. Starts on the buttons when
   * those are on.
   */
  import * as m from "../../paraglide/messages.js";
  import IconButton from "../kit/IconButton.svelte";
  import { onMount } from "svelte";

  let { mode = "swipe" }: { mode?: "swipe" | "buttons" } = $props();

  const SLIDES = [
    { id: "steer", caption: m.tutorial_touch_steer },
    { id: "fall", caption: m.tutorial_touch_fast_fall },
    { id: "restart", caption: m.tutorial_touch_restart },
    { id: "buttons", caption: m.tutorial_touch_buttons_hint },
  ] as const;

  let track: HTMLElement | undefined = $state();
  // svelte-ignore state_referenced_locally
  let index = $state(mode === "buttons" ? SLIDES.length - 1 : 0);

  function go(next: number, smooth = true): void {
    index = (next + SLIDES.length) % SLIDES.length;
    track?.scrollTo?.({ left: index * track.clientWidth, behavior: smooth ? "smooth" : "instant" });
  }

  /** A swipe on the track itself moves the dots with it. */
  function onScroll(): void {
    if (track === undefined || track.clientWidth === 0) return;
    index = Math.round(track.scrollLeft / track.clientWidth);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft") go(index - 1);
    else if (event.key === "ArrowRight") go(index + 1);
    else return;
    event.preventDefault();
  }

  // Opens on the slide it starts at, with no scroll to watch.
  onMount(() => {
    if (index !== 0) go(index, false);
  });
</script>

<div class="ff-guide" data-testid="touch-guide" role="region" aria-roledescription={m.select_carousel()} aria-label={m.a11y_touch_controls()}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="ff-guide__track" bind:this={track} onscroll={onScroll} onkeydown={onKey} tabindex="0">
    {#each SLIDES as slide, i (slide.id)}
      <figure
        class="ff-guide__slide"
        data-slide={slide.id}
        role="group"
        aria-roledescription={m.select_slide()}
        aria-label={m.a11y_slide_position({ position: i + 1, total: SLIDES.length })}
        aria-hidden={i !== index}
      >
        <!-- Both pictures; the device's orientation shows the one held. -->
        <svg viewBox="0 0 160 80" class="ff-guide__art ff-guide__art--landscape" aria-hidden="true">
          <!-- The phone, on its side. -->
          <rect x="20" y="8" width="120" height="64" rx="10" class="ff-guide__phone" />
          <rect x="28" y="12" width="104" height="56" rx="4" class="ff-guide__screen" />
          <!-- The HUD's three chips across the top. -->
          <rect x="59" y="15" width="12" height="7" rx="2" class="ff-guide__chip" />
          <rect x="74" y="15" width="12" height="7" rx="2" class="ff-guide__chip" class:ff-guide__chip--hot={slide.id === "restart"} />
          <rect x="89" y="15" width="12" height="7" rx="2" class="ff-guide__chip" />
          <!-- A few floors across the wider course, and the racer. -->
          <rect x="36" y="36" width="18" height="3" rx="1" class="ff-guide__floor" />
          <rect x="62" y="44" width="20" height="3" rx="1" class="ff-guide__floor" />
          <rect x="88" y="31" width="16" height="3" rx="1" class="ff-guide__floor" />
          <rect x="112" y="40" width="14" height="3" rx="1" class="ff-guide__floor" />
          <rect x="94" y="25" width="5" height="6" rx="1" class="ff-guide__racer" />

          {#if slide.id === "steer"}
            <rect x="28" y="40" width="104" height="28" class="ff-guide__zone" />
            <!-- Sideways, the left thumb steers and the right one falls. -->
            <path d="M38 56 h28 M38 56 l4 -3 M38 56 l4 3 M66 56 l-4 -3 M66 56 l-4 3" class="ff-guide__arrow" />
            <circle cx="52" cy="56" r="6" class="ff-guide__thumb ff-guide__thumb--steer" />
          {:else if slide.id === "fall"}
            <path d="M110 36 v24 M110 60 l-4 -4 M110 60 l4 -4" class="ff-guide__arrow" />
            <circle cx="110" cy="36" r="6" class="ff-guide__thumb ff-guide__thumb--fall" />
          {:else if slide.id === "restart"}
            <circle cx="80" cy="18.5" r="7" class="ff-guide__ripple" />
            <circle cx="80" cy="30" r="6" class="ff-guide__thumb ff-guide__thumb--tap" />
          {:else}
            <!-- Move under the left thumb; fast fall in from the right edge. -->
            <rect x="32" y="55" width="10" height="10" rx="3" class="ff-guide__button" />
            <rect x="44" y="55" width="10" height="10" rx="3" class="ff-guide__button ff-guide__button--pressed" />
            <rect x="112" y="55" width="10" height="10" rx="3" class="ff-guide__button" />
            <path d="M38.5 57.5 l-3 2.5 l3 2.5 M47.5 57.5 l3 2.5 l-3 2.5 M114 58.5 l3 3 l3 -3" class="ff-guide__glyph" />
          {/if}
        </svg>
        <svg viewBox="0 0 160 120" class="ff-guide__art ff-guide__art--upright" aria-hidden="true">
          <!-- The phone, held upright. -->
          <rect x="52" y="4" width="56" height="112" rx="10" class="ff-guide__phone" />
          <rect x="56" y="12" width="48" height="96" rx="4" class="ff-guide__screen" />
          <!-- The HUD's three chips across the top. -->
          <rect x="59" y="15" width="12" height="7" rx="2" class="ff-guide__chip" />
          <rect x="74" y="15" width="12" height="7" rx="2" class="ff-guide__chip" class:ff-guide__chip--hot={slide.id === "restart"} />
          <rect x="89" y="15" width="12" height="7" rx="2" class="ff-guide__chip" />
          <!-- A few floors and the racer. -->
          <rect x="60" y="40" width="16" height="3" rx="1" class="ff-guide__floor" />
          <rect x="82" y="52" width="18" height="3" rx="1" class="ff-guide__floor" />
          <rect x="64" y="66" width="20" height="3" rx="1" class="ff-guide__floor" />
          <rect x="88" y="46" width="5" height="6" rx="1" class="ff-guide__racer" />

          {#if slide.id === "steer"}
            <rect x="56" y="60" width="48" height="48" class="ff-guide__zone" />
            <path d="M66 94 h28 M66 94 l4 -3 M66 94 l4 3 M94 94 l-4 -3 M94 94 l-4 3" class="ff-guide__arrow" />
            <circle cx="80" cy="94" r="6" class="ff-guide__thumb ff-guide__thumb--steer" />
          {:else if slide.id === "fall"}
            <path d="M80 70 v26 M80 96 l-4 -4 M80 96 l4 -4" class="ff-guide__arrow" />
            <circle cx="80" cy="72" r="6" class="ff-guide__thumb ff-guide__thumb--fall" />
          {:else if slide.id === "restart"}
            <circle cx="80" cy="18.5" r="7" class="ff-guide__ripple" />
            <circle cx="80" cy="30" r="6" class="ff-guide__thumb ff-guide__thumb--tap" />
          {:else}
            <rect x="59" y="94" width="10" height="10" rx="3" class="ff-guide__button" />
            <rect x="71" y="94" width="10" height="10" rx="3" class="ff-guide__button ff-guide__button--pressed" />
            <rect x="91" y="94" width="10" height="10" rx="3" class="ff-guide__button" />
            <path d="M65.5 96.5 l-3 2.5 l3 2.5 M74.5 96.5 l3 2.5 l-3 2.5 M93 97.5 l3 3 l3 -3" class="ff-guide__glyph" />
          {/if}
        </svg>
        <figcaption class="ff-aq-body">{slide.caption()}</figcaption>
      </figure>
    {/each}
  </div>

  <div class="ff-guide__nav">
    <IconButton icon="chevron-left" label={m.a11y_previous()} data-testid="touch-guide-prev" onclick={() => go(index - 1)} />
    <div class="ff-guide__dots">
      {#each SLIDES as slide, i (slide.id)}
        <button
          type="button"
          class="ff-guide__dot"
          data-motion="none"
          aria-label={m.a11y_show_slide({ position: i + 1, total: SLIDES.length })}
          aria-current={i === index}
          onclick={() => go(i)}
        ></button>
      {/each}
    </div>
    <IconButton icon="chevron-right" label={m.a11y_next()} data-testid="touch-guide-next" onclick={() => go(index + 1)} />
  </div>
</div>

<style>
  .ff-guide {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .ff-guide__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 100%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    border-radius: var(--ff-control-radius);
  }
  .ff-guide__track::-webkit-scrollbar {
    display: none;
  }
  .ff-guide__track:focus-visible {
    outline: 2px solid var(--ff-plain);
    outline-offset: 2px;
  }

  .ff-guide__slide {
    display: grid;
    justify-items: center;
    gap: 6px;
    margin: 0;
    padding: 8px;
    scroll-snap-align: start;
    text-align: center;
  }

  .ff-guide__art {
    width: 160px;
    height: 120px;
  }
  /* Shorter on its side: a phone held sideways has the least height to give.
     Each picture shows the phone the way the player holds theirs, so the
     device's orientation picks one; a fact about the hand, not a layout. */
  .ff-guide__art--landscape {
    height: 80px;
    display: none;
  }
  @media (orientation: landscape) {
    .ff-guide__art--landscape {
      display: block;
    }
    .ff-guide__art--upright {
      display: none;
    }
  }

  .ff-guide__phone {
    fill: var(--ff-text);
  }
  .ff-guide__screen {
    fill: var(--ff-panel-fill);
  }
  .ff-guide__chip {
    fill: var(--ff-aq-white);
    stroke: var(--ff-panel-border);
    stroke-width: 0.6;
  }
  .ff-guide__chip--hot {
    stroke: var(--ff-plain);
    stroke-width: 1.2;
  }
  .ff-guide__floor {
    fill: var(--ff-panel-border);
  }
  .ff-guide__racer {
    fill: var(--ff-plain);
  }
  .ff-guide__zone {
    fill: color-mix(in srgb, var(--ff-glow) 22%, transparent);
  }
  .ff-guide__arrow,
  .ff-guide__glyph {
    fill: none;
    stroke: var(--ff-text-2);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ff-guide__glyph {
    stroke: var(--ff-text);
  }
  .ff-guide__thumb {
    fill: color-mix(in srgb, var(--ff-plain) 70%, transparent);
    stroke: var(--ff-aq-white);
    stroke-width: 1.2;
  }
  .ff-guide__button {
    fill: var(--ff-aq-white);
    stroke: var(--ff-panel-border);
    stroke-width: 0.8;
  }
  .ff-guide__button--pressed {
    fill: color-mix(in srgb, var(--ff-glow) 35%, var(--ff-aq-white));
    stroke: var(--ff-plain);
  }
  .ff-guide__ripple {
    fill: none;
    stroke: var(--ff-plain);
    stroke-width: 1;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
  }

  .ff-guide__thumb--steer {
    animation: ff-guide-steer 2.4s ease-in-out infinite;
  }
  .ff-guide__thumb--fall {
    animation: ff-guide-fall 1.6s ease-in infinite;
  }
  .ff-guide__thumb--tap {
    animation: ff-guide-tap 1.8s ease-out infinite;
  }
  .ff-guide__ripple {
    animation: ff-guide-ripple 1.8s ease-out infinite;
  }

  @keyframes ff-guide-steer {
    0%,
    100% {
      transform: translateX(0);
    }
    30% {
      transform: translateX(-12px);
    }
    70% {
      transform: translateX(12px);
    }
  }
  @keyframes ff-guide-fall {
    0%,
    15% {
      transform: translateY(0);
      opacity: 1;
    }
    60% {
      transform: translateY(22px);
      opacity: 1;
    }
    100% {
      transform: translateY(22px);
      opacity: 0;
    }
  }
  @keyframes ff-guide-tap {
    0% {
      transform: translateY(8px);
      opacity: 0;
    }
    30%,
    60% {
      transform: translateY(-9px);
      opacity: 1;
    }
    100% {
      transform: translateY(-9px);
      opacity: 0;
    }
  }
  @keyframes ff-guide-ripple {
    0%,
    35% {
      transform: scale(0.6);
      opacity: 0;
    }
    40% {
      opacity: 0.9;
    }
    100% {
      transform: scale(1.8);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-guide__thumb--steer,
    .ff-guide__thumb--fall,
    .ff-guide__thumb--tap {
      animation: none;
    }
    .ff-guide__thumb--tap {
      transform: translateY(-9px);
    }
    .ff-guide__ripple {
      animation: none;
      opacity: 0.6;
    }
  }

  .ff-guide__nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .ff-guide__dots {
    display: flex;
  }
  /* A 44 px target around an 8 px dot. */
  .ff-guide__dot {
    position: relative;
    width: 24px;
    height: var(--ff-aq-target);
    padding: 0;
    background: none;
    border: 0;
    cursor: var(--ff-cursor-hot);
  }
  .ff-guide__dot::after {
    content: "";
    position: absolute;
    inset: 50% auto auto 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ff-text-2) 45%, transparent);
  }
  .ff-guide__dot[aria-current="true"]::after {
    background: var(--ff-plain);
  }
</style>
