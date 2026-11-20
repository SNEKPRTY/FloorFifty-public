<script lang="ts">
  /**
   * The cover over a phone held sideways outside fullscreen (`landscape-gate.ts`).
   *
   * Mounted once for the life of the tab, over every screen and every modal,
   * and empty whenever the gate is open. Where the browser can hide its bar,
   * one tap on the cover's button does it (and asks for a landscape lock);
   * swiping out of fullscreen mid-race brings the cover back over the race,
   * which runs on underneath. Where it cannot, the cover says how to play.
   */
  import * as m from "../../paraglide/messages.js";
  import { onMount } from "svelte";
  import { fullscreenSupport, isFullscreen, toggleFullscreen, type FullscreenSupport } from "../platform/fullscreen";
  import { landscapeGate } from "./landscape-gate";
  import { formFactor } from "../platform/viewport-tracking.svelte";
  import Button from "../kit/Button.svelte";
  import Panel from "../kit/Panel.svelte";

  let {
    support = fullscreenSupport(),
    media = (query: string) => window.matchMedia(query),
  }: { support?: FullscreenSupport; media?: (query: string) => MediaQueryList } = $props();

  let fullscreen = $state(isFullscreen());
  let coarse = $state(false);
  let installed = $state(false);

  onMount(() => {
    const coarseQuery = media("(pointer: coarse)");
    const installedQuery = media("(display-mode: standalone), (display-mode: fullscreen)");
    const sync = (): void => {
      fullscreen = isFullscreen();
      coarse = coarseQuery.matches;
      installed = installedQuery.matches;
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    coarseQuery.addEventListener("change", sync);
    installedQuery.addEventListener("change", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      coarseQuery.removeEventListener("change", sync);
      installedQuery.removeEventListener("change", sync);
    };
  });

  const gate = $derived(landscapeGate({ formFactor: formFactor.current, coarse, support, fullscreen, installed }));

  let button: HTMLButtonElement | undefined = $state();
  // The pad and keyboard land on the one thing the cover offers.
  $effect(() => button?.focus({ preventScroll: true }));
</script>

{#if gate !== "none"}
  <div class="ff-landscape-gate" data-testid="landscape-gate" data-gate={gate}>
    <Panel
      role="dialog"
      aria-modal="true"
      aria-labelledby="ff-landscape-gate-title"
      class="ff-landscape-gate__panel font-ui"
    >
      {#if gate === "fullscreen"}
        <h2 id="ff-landscape-gate-title" class="ff-landscape-gate__title text-aq-ink">{m.shell_landscape_title()}</h2>
        <p class="ff-aq-body m-0 text-aq-ink">{m.shell_landscape_body()}</p>
        <Button
          bind:ref={button}
          kind="go"
          data-testid="landscape-gate-fullscreen"
          data-sfx="ready"
          onclick={() => void toggleFullscreen()}>{m.shell_landscape_go()}</Button
        >
      {:else}
        <div class="ff-landscape-gate__turn">
          <span class="ff-landscape-gate__phone" data-testid="landscape-gate-phone" aria-hidden="true"></span>
          <h2 id="ff-landscape-gate-title" class="ff-landscape-gate__title text-aq-ink">{m.shell_landscape_upright()}</h2>
        </div>
        <p data-testid="landscape-gate-home-lead" class="ff-aq-body m-0 text-aq-ink">{m.gate_home_lead()}</p>
        <ol class="ff-landscape-gate__steps ff-aq-body text-aq-ink">
          <li>{m.gate_home_step_1()}</li>
          <li>{m.gate_home_step_2()}</li>
          <li>{m.gate_home_step_3()}</li>
        </ol>
      {/if}
    </Panel>
  </div>
{/if}

<style>
  /* Over everything, the network loader (z 60) included: nothing under it is
     playable until the bar is gone. Opaque enough that the race behind reads
     as paused scenery, not as something to steer. */
  .ff-landscape-gate {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right), var(--ff-host-reserved-right, 0px)) max(16px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    background: color-mix(in srgb, var(--ff-panel-border) 80%, transparent);
    touch-action: none;
  }

  /* `:global`: the class lands on the kit panel's own root. */
  :global(.ff-landscape-gate__panel) {
    display: grid;
    gap: 12px;
    max-width: 420px;
    max-height: 100%;
    box-sizing: border-box;
    overflow: auto;
    padding: 20px;
    text-align: center;
  }

  .ff-landscape-gate__title {
    margin: 0;
    font: 600 var(--ff-type-title) / 1.2 var(--ff-font-ui);
  }

  /* The panel is wide and short sideways: the phone sits beside the heading,
     the three steps run under it. */
  .ff-landscape-gate__turn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  /* A phone drawn in CSS, lying on its side and turning upright. */
  .ff-landscape-gate__phone {
    flex: none;
    box-sizing: border-box;
    width: 20px;
    height: 34px;
    border: 3px solid var(--ff-text);
    border-radius: 5px;
    transform: rotate(-90deg);
    animation: ff-landscape-turn 2.4s ease-in-out infinite;
  }

  @keyframes ff-landscape-turn {
    0%,
    25% {
      transform: rotate(-90deg);
    }
    65%,
    100% {
      transform: rotate(0deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-landscape-gate__phone {
      animation: none;
      transform: rotate(0deg);
    }
  }

  .ff-landscape-gate__steps {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0 0 0 1.4em;
    list-style: decimal;
    text-align: left;
  }
</style>
