<script lang="ts">
  /**
   * The one modal shell (launch polish §3.1.1, "Modals").
   *
   * A labelled `role="dialog"` with `aria-modal`, so assistive technology
   * treats the page behind as absent. Focus moves in when it opens, Tab and
   * Shift+Tab wrap inside it, and focus returns to whatever opened it when it
   * closes -- a keyboard or controller player is never dropped at the top of
   * the page. The controller's focus navigator scopes itself to the open
   * `[aria-modal="true"]` element, so the same trap holds for a pad.
   *
   * Escape closes it and stops there, so an overlay underneath that also
   * listens for Escape (the pause overlay) does not toggle as well.
   *
   * A dialog taller than the band (a phone held sideways) becomes a sheet:
   * it fills the band, the header stays on top, the body scrolls and the
   * `actions` row is pinned at the foot, so no button is ever below the edge.
   */
  import * as m from "../../paraglide/messages.js";
  import Button from "./Button.svelte";
  import Icon from "./Icon.svelte";
  import Panel from "./Panel.svelte";
  import { onMount, type Snippet } from "svelte";
  import { focusControl, landing, tabbables } from "../platform/focus-nav";
  import { lockOverscroll } from "../platform/lock-overscroll";
  import type { TransitionConfig } from "svelte/transition";
  import DialogHeading from "./layout/DialogHeading.svelte";
  import { observeHeight } from "../../lib/observe-size";
  import { fadeIn, fadeOut, surfaceOut } from "./motion";
  import { requestUiSound } from "./ui-sounds";

  let {
    title,
    eyebrow,
    onClose,
    children,
    testId,
    clearTop,
    fade = false,
    onBackdrop,
    actions,
    fit = "auto",
  }: {
    title: string;
    /** A small label above the title, where one helps. */
    eyebrow?: string;
    onClose: () => void;
    children: Snippet;
    testId?: string;
    /**
     * A viewport y the dialog stays below: the pause overlay passes the foot
     * of the race HUD's metric row in portrait, so a tall dialog's Close
     * never lands on a chip. The caller decides when; the dialog obeys.
     */
    clearTop?: number;
    /**
     * The pause overlay's arrival: the whole overlay fades in and out over
     * half a beat, and its panel still rises (polish spec §5.3). Every other
     * modal's backdrop simply appears, and falls away as it leaves.
     */
    fade?: boolean;
    /** A tap on the dimmed page around the dialog; absent, such a tap does nothing. */
    onBackdrop?: () => void;
    /** The row of buttons, kept after the body and pinned at the foot of a sheet. */
    actions?: Snippet;
    /** `sheet` is always a sheet; `auto` is one only when the content does not fit the band. */
    fit?: "auto" | "sheet";
  } = $props();

  // Chosen once: a modal does not change how it arrives while it is open.
  const enter = fade ? fadeIn : arrive;
  const leaveWith = fade ? fadeOut : surfaceOut;
  /** The exit, which also marks the modal leaving the moment Svelte starts it. */
  function exit(node: HTMLElement): TransitionConfig {
    leaving = true;
    return leaveWith(node);
  }

  /** No transition of its own: the dialog's rise is the arrival. */
  function arrive(): TransitionConfig {
    return { duration: 0 };
  }

  const titleId = `ff-modal-title-${Math.random().toString(36).slice(2, 10)}`;
  let dialog: HTMLElement | undefined = $state();
  let backdrop: HTMLElement | undefined = $state();

  /**
   * Dialog or sheet, written straight to the DOM so it can be tried and
   * measured within one frame: a dialog that overflows the room the band gives
   * it is a sheet. Only a dialog can be measured, so a sheet is tried as one
   * first; nothing paints in between.
   */
  function refit(): void {
    if (dialog === undefined || fit === "sheet") return;
    dialog.dataset["fit"] = "dialog";
    if (dialog.scrollHeight > dialog.clientHeight + 1) dialog.dataset["fit"] = "sheet";
  }

  let opener: HTMLElement | undefined;

  /**
   * Focus goes back to the opener as the modal starts to leave, not when its
   * outro ends: a keyboard or pad player's next press lands where they are.
   */
  function handBack(): void {
    focusControl(opener, { within: false });
  }

  /**
   * Set as the exit starts (`exit`). A key sent straight to the dialog (a
   * pad's Back, a back swipe) skips `inert`, so the leaving dialog refuses it
   * itself.
   */
  let leaving = false;

  onMount(() => {
    refit();
    // The band changes when the phone turns; the content, when a view swaps or a list loads.
    const stops = [backdrop, dialog].flatMap((node) => (node === undefined ? [] : [observeHeight(node, refit)]));
    const content = new MutationObserver(refit);
    if (dialog !== undefined) content.observe(dialog, { childList: true, subtree: true, characterData: true });
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    if (dialog !== undefined) {
      // The modal's own sound, so whatever opened it -- a press, a key, the
      // game -- is heard the same way. Openers are quiet (`data-sfx="none"`).
      // Raised before focus moves in, so the move is not ticked on top of it.
      requestUiSound(dialog, "open");
      // Without scrolling: the page behind a dialog must not move under it.
      // On its green button or first setting, not Close: A straight away
      // must not shut what the player just opened.
      focusControl(landing(dialog));
    }
    return () => {
      stops.forEach((stop) => stop());
      content.disconnect();
      handBack();
    };
  });

  /**
   * Every way out: the Close button, Escape, a tap on the backdrop where the
   * owner takes one. Heard before it goes. Whether it goes is the owner's
   * call -- the pause overlay's Close steps back to its menu and stays -- so
   * it is the exit transition, run only as the modal really leaves, that
   * makes it inert. A modal already leaving closes nothing twice.
   */
  function close(owner: () => void = onClose): void {
    if (leaving) return;
    if (dialog !== undefined) requestUiSound(dialog, "close");
    owner();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || dialog === undefined) return;
    const items = tabbables(dialog);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? at <= 0
        ? items.length - 1
        : at - 1
      : at === -1 || at === items.length - 1
        ? 0
        : at + 1;
    event.preventDefault();
    // Handled here: a modal opened from inside another must not have its Tab
    // also taken by the one under it, which would move focus out of it.
    event.stopPropagation();
    // Into view within its list: a long dialog's list scrolls with Tab.
    focusControl(items[next]);
  }
</script>

<!-- Only the dialog scrolls. The backdrop scrolling too made two regions a drag
     could fall between, and a drag that reaches the page in fullscreen on a
     tablet leaves fullscreen (`lock-overscroll.ts`). -->
<!-- Rises in over one beat and falls out over half of one (polish spec §5.3).
     The backdrop is inert from the first frame it leaves, so a second press
     on a closing modal reaches nothing. -->
<div
  bind:this={backdrop}
  use:lockOverscroll
  in:enter
  out:exit
  onoutrostart={handBack}
  class="ff-modal z-40 grid place-items-center"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget && onBackdrop !== undefined) close(onBackdrop);
  }}
  style:--ff-modal-clear-top={clearTop === undefined ? undefined : `${Math.ceil(clearTop) + 8}px`}
>
  <!-- Its rise is the CSS keyframe and its exit is the backdrop's: the dialog takes focus and input from its first frame. -->
  <Panel
    bind:ref={dialog}
    arrive="none"
    leave="none"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    data-testid={testId}
    data-fit={fit === "sheet" ? "sheet" : "dialog"}
    tabindex="-1"
    class="ff-panel-arrive ff-modal__dialog grid w-full max-w-form font-ui"
    onkeydown={onKeydown}
  >
    <header data-modal-part="header" class="flex items-start justify-between gap-12">
      <DialogHeading id={titleId} {title} {...eyebrow === undefined ? {} : { eyebrow }} />
      <Button kind="ghost" data-testid="modal-close" data-close data-sfx="none" aria-label={m.shell_close()} class="ff-modal__close" onclick={() => close()}>
        <Icon name="close" />
      </Button>
    </header>
    <!-- Invisible to the layout in a dialog, so the children are the dialog's
         own grid rows; the scroller in a sheet. -->
    <div data-modal-part="body" class="ff-modal__body contents">{@render children()}</div>
    {#if actions !== undefined}
      <div data-modal-part="actions" class="ff-modal__actions">{@render actions()}</div>
    {/if}
  </Panel>
</div>

<style>
  /* The page behind dims rather than blurs: the canvas is already refracted,
     and a second live blur is a compositor pass the menus do not need.
     Inside the visible band (ui layout spec §4.1): where the letterbox draws
     its bars a dialog keeps between them, and a tall one scrolls inside. The
     dialog insets by the safe area, so no edge of it sits under a notch. */
  .ff-modal {
    position: fixed;
    inset-inline: 0;
    /* Px lengths drawn inside a zoomed ancestor (a dialog opened from a
       screen's body) are scaled by it, which drew a 720 px band 900 px tall
       and hung the centred dialog low; divide it back out. */
    top: calc(var(--ff-band-top) / var(--ff-ancestor-zoom, 1));
    height: calc(var(--ff-band-height) / var(--ff-ancestor-zoom, 1));
    padding: max(var(--ff-dialog-inset), env(safe-area-inset-top), var(--ff-modal-clear-top, 0px)) max(var(--ff-dialog-inset), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px))
      max(var(--ff-dialog-inset), env(safe-area-inset-bottom)) max(var(--ff-dialog-inset), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    background: color-mix(in srgb, var(--ff-panel-border) 20%, transparent);
    /* Its size is the band's, never its dialog's: a dialog may ask how much
       room the band gives it (the settings' two columns, below). */
    container: ff-modal / size;
  }

  /* A body that sets its groups in columns (the settings) takes the content
     width, not the narrow form's, so a tablet or desktop window is used. */
  :global(.ff-modal__dialog):has(:global([data-dialog-body][data-two-up])) {
    max-width: min(100%, var(--ff-content-max));
  }

  /* A long body (the settings) on a short, wide band -- a phone held
     sideways, a 900 x 600 window -- widens to set its groups two across,
     rather than show one group above a "+N more" (visual audit,
     2026-10-05). */
  @container ff-modal (max-height: 480px) and (min-width: 600px) {
    :global(.ff-modal__dialog):has(:global([data-dialog-body][data-two-up])) {
      max-width: min(100%, max(720px, var(--ff-content-max)));
    }
  }

  :global(.ff-modal__dialog) {
    /* The form's width, or the band's where a form factor lifts the cap (aquarian-tokens). */
    max-width: var(--ff-dialog-max-width, var(--container-form));
    /* The shell's scale on a tablet (aquarian-tokens), as ScreenFrame. */
    zoom: var(--ff-ui-zoom, 1);
    gap: var(--ff-dialog-gap);
    padding: var(--ff-dialog-pad);
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    container: ff-dialog / inline-size;
  }

  /* A body that scrolls in its own list (`data-dialog-body`, the settings)
     makes the dialog a column it takes the rest of, so the list scrolls and
     says what is below, rather than the dialog scrolling with no sign of it.
     A child, a `display: contents` grandchild or one inside a `ViewSwitch` (the pause overlay's views):
     left as a grid there, the list grew to its full height, and its contained
     overscroll kept a drag from reaching the dialog, so nothing scrolled. */
  :global(.ff-modal__dialog):has(> .ff-modal__body > :global([data-dialog-body]), > .ff-modal__body > :global(.contents > [data-dialog-body]), > .ff-modal__body > :global(.contents > .ff-view-switch > .ff-view > [data-dialog-body])) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ff-modal__body > :global([data-dialog-body]),
  .ff-modal__body > :global(.contents > [data-dialog-body]) {
    flex: 1 1 auto;
  }

  .ff-modal__actions {
    display: grid;
    gap: var(--ff-dialog-gap);
  }

  /* A sheet: the whole band, less the notch. The header and the action row keep
     their height; the body takes the rest and scrolls, a list inside it
     (`data-dialog-body`) taking the room the body gives it. */
  .ff-modal:has(> :global(.ff-modal__dialog[data-fit="sheet"])) {
    padding: max(env(safe-area-inset-top), var(--ff-modal-clear-top, 0px)) max(env(safe-area-inset-right), var(--ff-host-reserved-right, 0px))
      env(safe-area-inset-bottom) max(env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
  }
  :global(.ff-modal__dialog[data-fit="sheet"]) {
    display: flex;
    flex-direction: column;
    max-width: none;
    /* Zoom scales a percentage height: 100% of a 720 px band drew 900 px at
       a zoom of 1.25, with Close below the screen. So the band is divided by
       the zoom before the zoom puts it back, and the sheet stands at the
       band's top: centred, it was placed by its unzoomed height and sat an
       eighth of the band low. */
    align-self: start;
    height: calc(100% / var(--ff-ui-zoom, 1));
    overflow: hidden;
    border-radius: 0;
  }
  :global(.ff-modal__dialog[data-fit="sheet"] > header),
  :global(.ff-modal__dialog[data-fit="sheet"] > .ff-modal__actions) {
    flex: none;
  }
  :global(.ff-modal__dialog[data-fit="sheet"] > .ff-modal__body) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: var(--ff-dialog-gap);
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* 44 px as drawn: inside a zoom the box is divided by it, so the header is not a tall row. */
  :global(.ff-modal__close) {
    --ff-close: calc(var(--ff-aq-target) / var(--ff-ui-zoom, 1) / var(--ff-ancestor-zoom, 1));
    min-width: var(--ff-close);
    min-height: var(--ff-close);
    padding: 0;
  }
</style>
