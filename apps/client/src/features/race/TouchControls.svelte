<script lang="ts">
  /**
   * Three fixed buttons on the safe lower edge: left and right on the left,
   * fast fall on the right.
   *
   * This component is the element that produces pointer events and nothing
   * more. The bookkeeping that makes multi-touch work lives in
   * `features/race/touch-controls.ts`, unchanged, because it is the hard
   * part and it is already covered: a player holds left with one thumb and taps
   * fast-fall with the other, so each button tracks its own set of active
   * pointer ids and releases only when its last one lifts.
   *
   * Each side's group takes the pointers, not the buttons, and reaches
   * `STICKY_MARGIN_PX` past them with an invisible margin, so a near miss is
   * a press of the nearest button and a held thumb can slide from one to the
   * next (`StickyPointers`). The group captures the pointer, so the release
   * always arrives, however far the thumb wanders.
   *
   * The material is the Aquarian one, but the targets are larger and further
   * apart than a desktop control: these are pressed by a thumb, without
   * looking, while the player is watching the racer.
   */
  import * as m from "../../paraglide/messages.js";
  import Panel from "../kit/Panel.svelte";
  import {
    STICKY_MARGIN_PX,
    nearestTarget,
    type PointerLatch,
    type StickyPointers,
    type TouchAction,
  } from "./touch-controls";

  let { latch, pointers }: { latch: PointerLatch; pointers: StickyPointers } = $props();

  /** What each button draws as pressed, re-read after every pointer event. */
  let held = $state<Record<TouchAction, boolean>>({ left: false, right: false, fastFall: false });
  const sync = (): void => {
    held = { left: latch.isHeld("left"), right: latch.isHeld("right"), fastFall: latch.isHeld("fastFall") };
  };

  let root: HTMLElement | undefined = $state();

  /**
   * Each icon is a triangle in a 24-unit box, drawn as SVG rather than set as
   * a glyph: a text arrow sits wherever the font's side bearings and baseline
   * put it, which is never the middle of the button, and some phones swap it
   * for an emoji. Each one's box is centred a little toward its point, halfway
   * to its centroid, which is where a triangle reads as centred.
   */
  // `label` is what a screen reader says: words, never the action's identifier.
  const BUTTONS: { action: TouchAction; label: () => string; points: string; testId: string; side: "left" | "right" }[] = [
    { action: "left", label: m.a11y_touch_left, points: "16.5,5 6,12 16.5,19", testId: "touch-left", side: "left" },
    { action: "right", label: m.a11y_touch_right, points: "7.5,5 18,12 7.5,19", testId: "touch-right", side: "left" },
    { action: "fastFall", label: m.a11y_touch_fast_fall, points: "5,7.5 19,7.5 12,18", testId: "touch-fast-fall", side: "right" },
  ];

  /**
   * The button under a pointer: the one it is directly on, or else the
   * nearest within the margin. A captured pointer's events all target the
   * group, so a move is always resolved by geometry.
   */
  function hit(event: PointerEvent): TouchAction | undefined {
    const direct = (event.target as Element | null)?.closest?.<HTMLElement>("[data-action]");
    if (direct != null) return direct.dataset["action"] as TouchAction;
    const targets = [...(root?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].map((button) => ({
      action: button.dataset["action"] as TouchAction,
      rect: button.getBoundingClientRect(),
    }));
    return nearestTarget(event.clientX, event.clientY, targets);
  }

  function press(event: PointerEvent): void {
    event.preventDefault();
    if (!pointers.down(event.pointerId, hit(event))) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    sync();
  }

  function slide(event: PointerEvent): void {
    pointers.move(event.pointerId, hit(event));
    sync();
  }

  function release(event: PointerEvent): void {
    pointers.up(event.pointerId);
    sync();
  }

  /**
   * Blocks the page gestures a touch on the controls would otherwise cause.
   *
   * `touchstart` is the one that matters for a held thumb. Chrome on Android
   * runs its own long-press detector from the touch, and when it fires it
   * buzzes the phone as it offers to select -- even with selection off in CSS
   * and the context menu cancelled, because the buzz comes first. Cancelling
   * the touch at its start takes the long press, the buzz and the synthesised
   * mouse events with it; the pointer events the buttons run on still arrive.
   *
   * An action rather than `ontouch*`, because the listeners have to be
   * non-passive to call `preventDefault`, and a passive one cannot.
   */
  function blockPageGestures(node: HTMLElement) {
    const stop = (event: Event): void => {
      if (event.cancelable) event.preventDefault();
    };
    node.addEventListener("touchstart", stop, { passive: false });
    node.addEventListener("touchmove", stop, { passive: false });
    node.addEventListener("contextmenu", stop);
    return {
      destroy() {
        node.removeEventListener("touchstart", stop);
        node.removeEventListener("touchmove", stop);
        node.removeEventListener("contextmenu", stop);
      },
    };
  }
</script>

<!-- The whole strip takes the pointer, not only the two groups, so a thumb
     that lands between them is still cancelled by `blockPageGestures` rather
     than falling through to the canvas and its long-press buzz. -->
<!-- A frame the size of the layout viewport, so the controls ask its shape
     (a container query) rather than the form factor. It takes no pointer;
     the controls' root takes them as before. -->
<div class="ff-touch-frame">
  <div
    bind:this={root}
    use:blockPageGestures
    data-testid="touch-controls"
    style:--ff-sticky-margin="{STICKY_MARGIN_PX}px"
    class="ff-touch absolute inset-x-0 bottom-0 flex items-end justify-between"
  >
    {#each ["left", "right"] as const as side (side)}
      <div
        class="ff-touch-side pointer-events-auto flex gap-12"
        class:ff-touch-side--right={side === "right"}
        data-testid="touch-side-{side}"
        role="presentation"
        onpointerdown={press}
        onpointermove={slide}
        onpointerup={release}
        onpointercancel={release}
        onlostpointercapture={release}
      >
        {#each BUTTONS.filter((button) => button.side === side) as spec (spec.action)}
          <Panel
            as="button"
            type="button"
            tone="hud"
            arrive="none"
            leave="none"
            data-testid={spec.testId}
            data-action={spec.action}
            aria-label={spec.label()}
            data-held={String(held[spec.action])}
            data-motion="none"
            class="ff-touch-button grid size-touch touch-none place-items-center select-none"
          >
            <svg class="ff-touch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <polygon points={spec.points} fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
            </svg>
          </Panel>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .ff-touch {
    /* Clears the home indicator and any rounded corner. The controls are
       anchored to the bottom of the screen rather than the bottom of the
       letterbox: they belong under the player's thumbs wherever the game area
       happens to sit, and on a tall phone those are two different places. The
       bottom is the visible area's (`--ff-visual-inset-bottom`), so a bar the
       browser lays over the page never covers them. */
    padding: 0 max(1rem, env(safe-area-inset-right), var(--ff-host-reserved-right, 0px)) max(1rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    pointer-events: auto;
  }

  /* The size is `size-touch`, the form factor's token: smaller on a phone held
     sideways, so the buttons never crowd the course. What stays here is the
     material and the floor, which no utility states against a token. */
  :global(.ff-touch-button) {
    /* Never below the 44px accessibility minimum, whatever the viewport. */
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    color: var(--ff-text);
  }

  /* The sticky margin: an invisible box past the buttons that belongs to the
     group, so a near miss lands on the group and is resolved to the nearest
     button. Painted under the buttons, and changing no layout. */
  .ff-touch-side {
    position: relative;
    z-index: 0;
  }
  .ff-touch-side::before {
    content: "";
    position: absolute;
    inset: calc(-1 * var(--ff-sticky-margin));
    z-index: -1;
  }

  /* The controls' frame: the visible band, as a size container, on layer 2,
     as the root was. The root sits on the frame's foot. The band already ends
     above a bar the browser lays over the page (`app.ts` lays out from the
     visible area), so the root needs no inset of its own. */
  .ff-touch-frame {
    position: fixed;
    /* The visible band (ui layout spec §4.1): where the letterbox draws its
       bottom bar, the thumbs' buttons sit just above it, never on it. */
    inset-inline: 0;
    top: var(--ff-band-top);
    height: var(--ff-band-height);
    z-index: 2;
    pointer-events: none;
    container: ff-touch / size;
  }

  /* A phone held sideways: fast fall sits further in from the right edge,
     where a thumb reaching for it from the phone's side lands more easily.
     Sideways is the frame being wider than tall and under 500 px
     (`PHONE_LANDSCAPE_MAX_HEIGHT`, `features/platform/form-factor.ts:24`), asked of the
     frame itself, so it fires exactly where the form factor said
     phone-landscape. */
  @container ff-touch (orientation: landscape) and (max-height: 499px) {
    .ff-touch-side--right {
      margin-right: 40px;
    }
  }

  /* Scales with the button, whatever the form factor's touch size. Never a
     target of its own: a press lands on the button, not on the drawing in it,
     so nothing inside can be selected or held. */
  .ff-touch-icon {
    display: block;
    pointer-events: none;
    width: 42%;
    height: 42%;
  }

  /* The pressed state, from the latch rather than `:active`: a near miss or a
     slide presses a button the finger is not on. Pressed: one pixel down,
     onto its shadow, the glass edged in the
     action blue so the press reads by more than shade (spec §4.4). */
  :global(.ff-touch-button[data-held="true"]) {
    border-color: var(--ff-plain);
    box-shadow: 0 1px 0 var(--ff-plain);
    transform: translateY(1px);
  }
</style>
