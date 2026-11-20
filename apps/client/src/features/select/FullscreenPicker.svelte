<script lang="ts">
  /**
   * The fullscreen picker (select spec §6.8): one item at a time, nearly the
   * whole screen, swiped left and right. On screen is the pick: an open slide
   * that comes to rest picks itself; a locked or DLC slide leaves the pick
   * where it was and says why Lock in is unavailable. Drawn through
   * `SelectFrame`, the Character showcase's composition (§6.8, amended): the
   * slide is the scene, and the glass panel holds the item's name, the
   * seconds and Lock in, and one row per player. The step gives the slide: a
   * stage's scene, or a song's player.
   */
  import * as m from "../../paraglide/messages.js";
  import Button from "../kit/Button.svelte";
  import IconButton from "../kit/IconButton.svelte";
  import Panel from "../kit/Panel.svelte";
  import PagerDots from "../kit/layout/PagerDots.svelte";
  import { untrack, type Snippet } from "svelte";
  import { reducedMotion } from "../kit/motion";
  import { isTap, releaseStep, WheelPager } from "./page-swipe";
  import { accessibleLabel, indexOf, moveTo, settledPick, type PickerItem } from "./picker-model";
  import type { PlayerRow } from "./select-model";
  import PlayerRows from "./PlayerRows.svelte";
  import SelectFrame from "./SelectFrame.svelte";

  let {
    labels,
    heading,
    seconds,
    items,
    focusedId,
    rows,
    locked,
    onPick,
    onLockIn,
    onView = undefined,
    onReveal = undefined,
    onTeaser = undefined,
    slide,
    extra = undefined,
  }: {
    /** What the picker picks, and its arrows' and dots' names, whole: a sentence is never built from `kind`. */
    labels: { kind: string; previous: string; next: string; group: string };
    /** The step's heading, for assistive technology only ("Pick a stage"). */
    heading: string;
    seconds: number;
    items: readonly PickerItem[];
    focusedId: string | undefined;
    rows: readonly PlayerRow[];
    locked: boolean;
    onPick: (id: string) => void;
    onLockIn: () => void;
    /** Every slide that comes to rest, open or not: the song step previews what is on screen. */
    onView?: (item: PickerItem) => void;
    /**
     * A slide earned by play was seen and left: it is no longer new
     * (unlockables spec §7.2). On leaving, not on arriving, or its NEW pill
     * would clear the moment it showed.
     */
    onReveal?: (id: string) => void;
    /**
     * A DLC slide's button asks for its pack's Coming soon sheet
     * (unlockables spec §7.3). Absent, a DLC slide's button is disabled.
     * It never locks in and never moves the seat's pick.
     */
    onTeaser?: (id: string) => void;
    slide: Snippet<[PickerItem, boolean]>;
    /** A control of the step's own at the head of the action line: the stage step's seed chip (stage seeds spec §4.1). */
    extra?: Snippet | undefined;
  } = $props();

  // Opens on the seat's focus, then belongs to the viewer: a snapshot that
  // still names an older focus never yanks the view back (review focus 3).
  let index = $state(untrack(() => Math.max(0, indexOf(items, focusedId))));
  const current = $derived(items[Math.min(index, items.length - 1)]);
  /** The slide the step last heard about, so a snapshot that re-derives the same one says nothing. */
  let viewed: string | undefined;
  let viewedNew = false;
  $effect(() => {
    const item = current;
    if (item === undefined || item.id === viewed) return;
    const left = viewedNew ? viewed : undefined;
    viewed = item.id;
    viewedNew = item.isNew === true;
    untrack(() => {
      if (left !== undefined) onReveal?.(left);
      onView?.(item);
    });
  });
  const still = reducedMotion();
  let announcement = $state("");

  /**
   * What this seat last asked the room for. Compared against this, never the
   * snapshot's focus: a move and a quick move back inside one round trip
   * must send both, or the room keeps the first while the screen shows the
   * second (review 2).
   */
  let lastSent = untrack(() => focusedId);
  /** Lock in was pressed: paging stops now, not when the room's answer arrives. */
  let lockPressed = $state(false);
  const frozen = $derived(locked || lockPressed);

  /** Turns to `to`, and picks it when it is open. */
  function go(to: number): void {
    if (frozen || items.length === 0) return;
    index = to;
    announcement = accessibleLabel(labels.kind, items, index);
    const pick = settledPick(items, index);
    if (pick !== undefined && pick !== lastSent) {
      lastSent = pick;
      onPick(pick);
    }
  }

  // Locked, the view shows what was locked: at the timeout the room locks the
  // last pickable focus, which a viewer on a DLC slide was not looking at.
  $effect(() => {
    if (!locked) return;
    untrack(() => {
      const at = indexOf(items, focusedId);
      if (at >= 0) index = at;
    });
  });
  const turn = (delta: number) => go(moveTo(index, delta, items.length));


  // A press that moved is a swipe; the click after it must not also act.
  let start: { x: number; y: number; t: number; id: number } | undefined;
  let swallowClick = false;
  let width = $state(0);
  let dragX = $state(0);
  function down(event: PointerEvent): void {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
    swallowClick = false;
  }
  function move(event: PointerEvent): void {
    if (start === undefined || event.pointerId !== start.id || frozen) return;
    // A mouse released off the panel never sent its pointerup here: a move
    // with no button held ends the drag (review 4).
    if (event.pointerType === "mouse" && event.buttons === 0) return cancel();
    const dx = event.clientX - start.x;
    if (isTap(dx, event.clientY - start.y)) return;
    // Captured only once it is a drag, so an arrow's tap keeps its own click.
    if (dragX === 0) (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragX = dx;
  }
  function up(event: PointerEvent): void {
    if (start === undefined || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    if (!isTap(dx, event.clientY - start.y)) {
      // Swallows the click this release sends, and only that one: a touch
      // swipe sends none, and the next tap must act (review 3).
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 0);
      const step = releaseStep(dx, event.timeStamp - start.t, width);
      if (step !== 0) turn(step);
    }
    dragX = 0;
    start = undefined;
  }
  function cancel(): void {
    dragX = 0;
    start = undefined;
  }
  /** An arrow or a dot: once per press, never after a swipe. */
  function press(action: () => void): void {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    action();
  }

  const wheel = new WheelPager();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  function onWheel(event: WheelEvent): void {
    const step = wheel.push(event.deltaX, event.deltaY);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
    clearTimeout(quiet);
    quiet = setTimeout(() => wheel.reset(), 180);
    if (step !== 0) turn(step);
  }
  $effect(() => () => clearTimeout(quiet));

  /**
   * Page keys only. The arrow keys reach the panel as `ff-steer`, from the
   * app's window listener (FocusNavigator), as a pad's d-pad does; handling
   * the raw key too turned two slides per press (review 1).
   */
  function keys(event: KeyboardEvent): void {
    if (["PageDown", "e", "E"].includes(event.key)) turn(1);
    else if (["PageUp", "q", "Q"].includes(event.key)) turn(-1);
    else return;
    event.preventDefault();
  }
  /** A pad's left and right (`ff-steer`) and its shoulders (`ff-page`), offered by FocusNavigator. */
  function steer(event: Event): void {
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    if (direction === "left" || direction === "previous") turn(-1);
    else if (direction === "right" || direction === "next") turn(1);
    else return;
    event.preventDefault();
  }

  /** A DLC slide's button opens its pack's sheet rather than locking in. */
  const teaser = $derived(!locked && current?.state === "dlc" && onTeaser !== undefined);
  const lockLabel = $derived(
    locked
      ? m.select_locked_in()
      : teaser
        ? m.select_coming_soon()
        : current?.state === "open"
          ? m.select_lock_in()
          : (current?.reason ?? m.select_lock_in()),
  );
</script>

<SelectFrame {heading}>
  {#snippet scene()}
    <div
      class="ff-picker__panel"
      data-testid="picker"
      data-id={current?.id}
      data-index={index}
      role="region"
      aria-roledescription={m.select_carousel()}
      aria-label={current === undefined ? labels.kind : accessibleLabel(labels.kind, items, index)}
      tabindex="0"
      bind:clientWidth={width}
      onkeydown={keys}
      onff-steer={steer}
      onff-page={steer}
      onwheel={onWheel}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={cancel}
      onlostpointercapture={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <!-- The glass the slide sits on, so a bare slide (Random, a locked song, art still loading) is white text on the panel and never on the scene. It stays put while the slide is dragged. -->
      <Panel class="ff-picker__backing" arrive="none" leave="none" aria-hidden="true" />
      <!-- The arrows inside the slide's edges, a ring's reach in. -->
      <IconButton icon="chevron-left" label={labels.previous} class="ff-picker__arrow ff-picker__arrow--previous" data-testid="picker-previous" disabled={frozen} onclick={() => press(() => turn(-1))} />
      <div class="ff-picker__slide" style:transform={dragX === 0 || still ? undefined : `translateX(${dragX}px)`}>
        {#if current !== undefined}{#key current.id}{@render slide(current, !still)}{/key}{/if}
      </div>
      <IconButton icon="chevron-right" label={labels.next} class="ff-picker__arrow ff-picker__arrow--next" data-testid="picker-next" disabled={frozen} onclick={() => press(() => turn(1))} />
    </div>
  {/snippet}
  {#snippet dots()}
    <!-- One row of dots, or "3 / 11" once they would not fit; frozen, a dot
         does nothing, as the arrows do nothing. -->
    <PagerDots
      count={items.length}
      {index}
      label={labels.group}
      testId="picker-dot"
      ids={items.map((item) => item.id)}
      labels={items.map((item) => item.label)}
      onSelect={(at) => {
        if (!frozen) press(() => go(at));
      }}
    />
  {/snippet}
  {#snippet headline()}{current?.label ?? ""}{/snippet}
  {#snippet action()}
    {#if extra !== undefined}{@render extra()}{/if}
    <span class="ff-picker__seconds" data-testid="select-seconds">{m.select_seconds({ seconds })}</span>
    <Button
      kind="go"
      class="ff-picker__lock"
      data-testid="lock-in"
      data-sfx={teaser ? "none" : "ready"}
      data-reason={locked || current?.state === "open" || teaser ? undefined : ""}
      disabled={locked || (current?.state !== "open" && !teaser)}
      aria-label={teaser ? m.select_coming_soon_label({ pack: current?.reason ?? "" }) : undefined}
      onclick={() => {
        if (teaser) {
          if (current !== undefined) onTeaser?.(current.id);
          return;
        }
        lockPressed = true;
        onLockIn();
      }}
    >
      <span class="ff-picker__lock-label">{lockLabel}</span>
    </Button>
  {/snippet}
  {#snippet players()}<PlayerRows {rows} />{/snippet}
</SelectFrame>
<p class="sr-only" aria-live="polite">{announcement}</p>

<style>
  /* The slide fills the frame's scene: the stage in a rounded frame, where
     the showcase stands its character. The arrows sit inside its left and
     right edges, a ring's reach in: not over the art's middle, not outside. */
  .ff-picker__panel {
    position: absolute;
    inset: 0;
    /* Clips the slide as it is dragged. */
    overflow: hidden;
    border-radius: var(--ff-panel-radius);
    touch-action: pan-y;
    user-select: none;
  }
  /* Inside its edge: the panel fills the scene, which the screen clips. */
  .ff-picker__panel:focus-visible { outline: 3px solid var(--ff-plain); outline-offset: -3px; }
  :global(.ff-picker__backing) { position: absolute; inset: 0; }
  .ff-picker__slide { position: absolute; inset: 0; border-radius: var(--ff-panel-radius); box-shadow: none; overflow: hidden; }
  /* A drawn chevron, centred on the circle: a text glyph sits where its
     font's metrics put it, off the circle's middle. Each chevron spans
     9 to 15 of its 24-unit box, so the shape itself is centred. */
  :global(.ff-picker__arrow) {
    position: absolute;
    top: 50%;
    z-index: 2;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    padding: 0;
    width: var(--ff-aq-target);
    height: var(--ff-aq-target);
  }
  :global(.ff-picker__arrow--previous) { left: var(--ff-ring-room); }
  :global(.ff-picker__arrow--next) { right: var(--ff-ring-room); }
  :global(.ff-picker__arrow:disabled) { opacity: 0.4; }
  .ff-picker__seconds { font: 600 var(--ff-type-hint) / 1 var(--ff-font-ui); color: var(--ff-text-2); white-space: nowrap; }
  :global(.ff-picker__lock) { flex: 1 1 auto; min-height: 44px; }
  /* Where the action shares the headline's line (sideways, and a short desk:
     SelectFrame), Lock in holds one width whatever it says. Sized to its
     label, a locked pick's reason ("Play across devices") pushed the headline
     and the pager about as the picker turned, and squeezed "10 / 11" onto
     three lines, so the panel grew and shrank under the player. A reason
     sets smaller, on up to two lines inside it. */
  :global(.ff-select[data-layout="sideways"] .ff-picker__lock) { flex: none; width: 7rem; padding-inline: 8px; }
  :global(.ff-select[data-layout="sideways"] .ff-picker__lock[data-reason]) { font-size: var(--ff-type-hint); }
  :global(.ff-select[data-layout="sideways"] .ff-picker__lock[data-reason] .ff-picker__lock-label) { display: -webkit-box; overflow: hidden; }
  @container ff-screen (max-height: 460px) {
    :global(.ff-select[data-layout="desk"] .ff-picker__lock) { flex: none; width: 7rem; padding-inline: 8px; }
    :global(.ff-select[data-layout="desk"] .ff-picker__lock[data-reason]) { font-size: var(--ff-type-hint); }
    :global(.ff-select[data-layout="desk"] .ff-picker__lock[data-reason] .ff-picker__lock-label) { display: -webkit-box; overflow: hidden; }
  }
  /* Plain text, as the control sets it, until a reason has to wrap: then two
     lines at most, each tall enough that no glyph is trimmed. The clamp
     applies only while it is a box. */
  .ff-picker__lock-label {
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.25;
    text-align: center;
  }
</style>
