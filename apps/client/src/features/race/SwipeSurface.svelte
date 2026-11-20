<script lang="ts">
  /**
   * The whole screen as one input surface (spec §3.1.3).
   *
   * A downward flick anywhere fast-falls (Owner, 2026-10-10: the slam was
   * missed whenever it started above the middle of the screen). Steering is
   * still the lower half's: a finger that lands higher up only flicks. The
   * HUD's few tappable controls sit above this surface (z 3), so they still
   * take their taps.
   *
   * All bookkeeping is in `SwipeTracker`; this forwards pointer events and
   * draws a thin thumb-and-anchor line so the player can see the dead zone.
   * Restart is the HUD timer's tap, so nothing here but the surface takes a
   * finger.
   */
  import { SWIPE, type SwipeTracker } from "./swipe-tracker";

  let { tracker }: { tracker: SwipeTracker } = $props();
  let indicator = $state(tracker.indicator);
  const sync = (): void => void (indicator = tracker.indicator);

  function down(event: PointerEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    // The lower half of the window steers; the frame's window inside Ruken is the game's own.
    const steers = event.clientY >= window.innerHeight / 2;
    tracker.down(event.pointerId, event.clientX, event.clientY, { steers });
    sync();
  }
  function move(event: PointerEvent): void {
    tracker.move(event.pointerId, event.clientX, event.clientY);
    sync();
  }
  function up(event: PointerEvent): void {
    tracker.up(event.pointerId);
    sync();
  }
  /**
   * Per finger, like `up`: a lifted finger loses its capture too, and
   * releasing every pointer then stopped the other thumb steering.
   */
  function lost(event: PointerEvent): void {
    tracker.up(event.pointerId);
    sync();
  }

  /**
   * Cancels the touch at its start, as `TouchControls` does: Chrome on
   * Android otherwise runs its long-press detector and buzzes the phone
   * under a held thumb. Non-passive, which `ontouch*` cannot be.
   */
  function blockPageGestures(node: HTMLElement) {
    const stop = (event: Event): void => {
      if (event.cancelable) event.preventDefault();
    };
    node.addEventListener("touchstart", stop, { passive: false });
    node.addEventListener("touchmove", stop, { passive: false });
    return {
      destroy() {
        node.removeEventListener("touchstart", stop);
        node.removeEventListener("touchmove", stop);
      },
    };
  }
</script>

<div
  use:blockPageGestures
  data-testid="swipe-surface"
  role="presentation"
  class="ff-swipe fixed inset-x-0 top-0 bottom-[var(--ff-visual-inset-bottom,0px)] z-2 touch-none select-none"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={lost}
  onlostpointercapture={lost}
  oncontextmenu={(event) => event.preventDefault()}
>
  {#if indicator !== undefined}
    <div
      class="ff-swipe__line"
      aria-hidden="true"
      style:left={`${Math.min(indicator.anchorX, indicator.thumbX)}px`}
      style:top={`${indicator.y}px`}
      style:width={`${Math.min(Math.abs(indicator.thumbX - indicator.anchorX), SWIPE.saturationPx)}px`}
      data-direction={indicator.direction}
    ></div>
  {/if}
</div>

<style>
  .ff-swipe__line {
    position: fixed;
    height: 3px;
    background: var(--ff-text);
    opacity: 0.6;
    pointer-events: none;
  }
  /* Inside the dead zone: drawn faint, so the player sees it is not steering. */
  .ff-swipe__line[data-direction="0"] {
    opacity: 0.25;
  }

</style>
