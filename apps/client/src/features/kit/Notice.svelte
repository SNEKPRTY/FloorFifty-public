<script lang="ts">
  /**
   * The one notice (spec, "Notices and errors"): a panel at the top centre of
   * the band, under the corner buttons, with the words, the buttons that say
   * what to do about it, and a close. Never pinned to a corner, never in a
   * letterbox band, never over a button.
   *
   * An error, a connection problem, a share message, the idle warning and the
   * lobby's status all render through it. A problem is an alert with a red
   * left edge; information is a polite status. It can be rendered always and
   * hidden while it has nothing to say, so a live region is in the document
   * before its words change.
   */
  import * as m from "../../paraglide/messages.js";
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";
  import Icon from "./Icon.svelte";
  import Panel from "./Panel.svelte";

  let {
    message,
    tone,
    testId,
    messageTestId,
    onClose,
    closeTestId = `${testId}-close`,
    actions,
    hidden = false,
    layer = 30,
    extra = {},
    node = $bindable(),
  }: {
    message: string;
    tone: "info" | "problem";
    testId: string;
    messageTestId?: string;
    /** Where given, a × that closes it. */
    onClose?: () => void;
    closeTestId?: string;
    /** The buttons that say what to do: a plain `Button` each, or the one green only where no screen under it has one. */
    actions?: Snippet;
    hidden?: boolean;
    /** Above the screens by default; the idle warning sits over the loader's layer too. */
    layer?: number;
    /** Extra attributes for the root (a failure's `data-code`). */
    extra?: Record<string, string>;
    /** The root, for a caller that shakes it (a refusal repeated). */
    node?: HTMLElement | undefined;
  } = $props();

  const layerStyle = $derived(`--ff-notice-layer: ${layer}`);

  /**
   * While it shows at the top, the notice tells the screens where it ends
   * (`--ff-notice-bottom`, from the top of the window), so a hero lays its
   * wordmark under it instead of being covered. Where it ends, not how tall
   * it is: a screen's own corner row already takes the top of the window, and
   * only what the notice reaches below that is the hero's to give up. A
   * notice centred in a race takes none.
   */
  $effect(() => {
    if (node === undefined || hidden || node.hasAttribute("data-centre-in-race")) return;
    const root = document.documentElement;
    const target = node;
    // From its place, not its box: the rise moves the box while it arrives.
    // Only at the top: a notice a screen moves to the window's foot (the title
    // held sideways, review R38) takes nothing from the hero above it.
    const measure = (): void => {
      if (target.offsetTop > window.innerHeight / 2) root.style.removeProperty("--ff-notice-bottom");
      else root.style.setProperty("--ff-notice-bottom", `${target.offsetTop + target.offsetHeight + 8}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--ff-notice-bottom");
    };
  });
</script>

<Panel
  bind:ref={node}
  data-notice
  data-tone={tone}
  data-testid={testId}
  role={tone === "problem" ? "alert" : "status"}
  aria-live={tone === "problem" ? undefined : "polite"}
  {hidden}
  style={layerStyle}
  class="ff-notice font-ui"
  {...extra}
>
  <p class="ff-aq-body ff-notice__message m-0 text-aq-ink" data-testid={messageTestId}>{message}</p>
  {#if actions !== undefined}<div class="ff-notice__actions">{@render actions()}</div>{/if}
  {#if onClose !== undefined}
    <Button data-testid={closeTestId} data-sfx="back" aria-label={m.shell_close()} class="ff-notice__close" onclick={onClose}>
      <Icon name="close" />
    </Button>
  {/if}
</Panel>

<style>
  /* Centred in the band with auto margins rather than a transform, which the
     slide in owns. Clear of the corner row (Back, the flag, Mute) by 8 px, so
     it covers the way out of no screen. */
  :global(.ff-notice) {
    position: fixed;
    inset-inline: 0;
    top: calc(var(--ff-band-top) + max(var(--ff-gutter), env(safe-area-inset-top)) + var(--ff-corner-h) + 8px);
    z-index: var(--ff-notice-layer);
    margin-inline: auto;
    width: fit-content;
    max-width: min(var(--ff-content-max, 560px), calc(100% - 2 * var(--ff-gutter)));
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 8px 8px 16px;
  }
  /* A race has no corner row: the connection notice hangs under whatever the
     HUD holds at the top (its row, and the coach or a hint), so it covers no
     chip and no coach. */
  :global([data-band-mode="field"] .ff-notice[data-centre-in-race]) {
    top: calc(var(--ff-hud-under-y, var(--ff-band-top)) + 8px);
  }
  :global(.ff-notice[hidden]) {
    display: none;
  }
  :global(.ff-notice[data-tone="problem"]) {
    border-left: 4px solid var(--ff-danger);
  }
  .ff-notice__message {
    grid-column: 1;
    overflow-wrap: anywhere;
  }
  .ff-notice__actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  :global(.ff-notice__close) {
    grid-column: 2;
    grid-row: 1;
    min-width: var(--ff-aq-target);
    min-height: var(--ff-aq-target);
    padding: 0;
  }
</style>
