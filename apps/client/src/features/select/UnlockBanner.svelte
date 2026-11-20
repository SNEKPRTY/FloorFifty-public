<script lang="ts">
  /**
   * NEW SONG or NEW CHALLENGER across the top of the results (unlockables spec
   * §7.1), in the results' own material: the title plate and the wordmark,
   * nothing new.
   *
   * It never blocks. It is no dialog, holds no control and takes no focus, so
   * Race again and the rest stay usable under it. A tap on it, any key, any
   * controller button or the 6 s timer dismisses it, once; a press that
   * dismisses is not consumed, so Enter or A on a focused Race again still
   * races again.
   */
  import { onMount } from "svelte";
  import * as m from "../../paraglide/messages.js";
  import { PAD_PRESS } from "../platform/focus-nav";
  import { flashOut, reducedMotion } from "../kit/motion";
  import { requestUiSound } from "../kit/ui-sounds";
  import { UNLOCK_BANNER_MS, type UnlockGrant } from "../net/unlock-grant";
  import Panel from "../kit/Panel.svelte";

  let {
    grant,
    artSrc,
    onDone,
  }: {
    grant: UnlockGrant;
    /** A DOM image URL for an art alias, once the manifest is known. */
    artSrc: (alias: string) => string | undefined;
    onDone: () => void;
  } = $props();

  const motion = reducedMotion() ? "reduced" : "full";
  const art = $derived(
    grant.kind === "song"
      ? grant.coverAlias === undefined
        ? undefined
        : artSrc(`${grant.coverAlias}Large`)
      : artSrc(grant.portraitAlias),
  );

  let banner: HTMLElement | undefined;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function finish(): void {
    if (done) return;
    done = true;
    if (timer !== undefined) clearTimeout(timer);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener(PAD_PRESS, finish);
    onDone();
  }

  /** A key held through the finish repeats; only a fresh press dismisses. */
  function onKey(event: KeyboardEvent): void {
    if (!event.repeat) finish();
  }

  onMount(() => {
    // NEW CHALLENGER's sting (polish spec §8.2). NEW SONG is quiet: its song's
    // preview starting is the reward, and a sting over it would stack. Keyed
    // by the grant, so a banner remounted for it is not heard twice.
    if (grant.kind === "character" && banner !== undefined) requestUiSound(banner, "unlock", `unlock:${grant.conditionId}`);
    timer = setTimeout(finish, UNLOCK_BANNER_MS);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PAD_PRESS, finish);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PAD_PRESS, finish);
    };
  });
</script>

<div
  bind:this={banner}
  data-testid="unlock-banner"
  data-kind={grant.kind}
  data-motion={motion}
  class="ff-unlock-banner"
  onpointerdown={finish}
  role="presentation"
>
  <!-- The plate is the one glass `Panel`: it drops in by the keyframe below (a GSAP tween on it would stop
       its fall-out from finishing), and falls out as the banner is dismissed. -->
  <Panel class="ff-unlock-banner__plate" arrive="none" leave="fall">
    {#if motion === "full"}
      <!-- The flash as the plate lands (spec §7.1); a reduced-motion player gets the plate alone. -->
      <span class="ff-unlock-banner__flash" data-testid="unlock-banner-flash" aria-hidden="true" use:flashOut={{ delay: 0.3 }}></span>
    {/if}
    {#if art !== undefined}
      <img class="ff-unlock-banner__art" alt="" width="64" height="64" src={art} />
    {/if}
    <div class="ff-unlock-banner__words">
      <p class="ff-unlock-banner__headline m-0 font-ui text-aq-ink">
        {grant.kind === "song" ? m.results_unlock_new_song() : m.results_unlock_new_challenger()}
      </p>
      <p class="ff-unlock-banner__name m-0 font-ui text-aq-ink">{grant.kind === "song" ? grant.title : grant.name}</p>
    </div>
  </Panel>
</div>

<style>
  /* In the results' corner row, between Back's place and Mute (ResultsPanel
     passes it as the frame's header): as tall as the row, so nothing below
     moves while it shows and nothing is covered. A larger text setting may
     wrap the headline and grow the row; it is never cut. */
  .ff-unlock-banner {
    display: flex;
    justify-content: center;
    flex: 1;
    min-width: 0;
  }
  :global(.ff-unlock-banner__plate) {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--ff-aq-target);
    /* 2 px up and down: the headline and the name stack to 40 px, and at
       4 px the chip stood 2 px taller than the row, so the results' corners
       moved off the title's while it showed. */
    padding: 2px 14px 2px 4px;
  }
  /* Drops in from above, eight steps over 300 ms; a reduced-motion player's banner is placed at once. */
  .ff-unlock-banner[data-motion="full"] :global(.ff-unlock-banner__plate) {
    animation: ff-unlock-drop 300ms steps(8) both;
  }
  @keyframes ff-unlock-drop {
    from {
      opacity: 0;
      transform: translateY(-16px);
    }
  }
  .ff-unlock-banner__flash {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: var(--ff-panel-radius);
    background: var(--ff-text);
    opacity: 0;
    pointer-events: none;
  }
  .ff-unlock-banner__art {
    flex: none;
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--ff-control-radius);
  }
  .ff-unlock-banner__words {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .ff-unlock-banner__headline {
    font-size: round(down, clamp(1.125rem, 2.6vw, 1.5rem), var(--ff-type-hint));
    font-weight: 600;
    line-height: 1.1;
    text-wrap: balance;
  }
  .ff-unlock-banner__name {
    font-size: var(--ff-type-hint);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
