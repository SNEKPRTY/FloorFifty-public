<script lang="ts">
  /**
   * One contact inside Ruken's frame: its icon, its address in words, and
   * Copy. The frame blocks popups, so a link that opens a new tab does
   * nothing there (Owner's pick, "Show address + Copy"). Copy says so for a
   * moment, as the room code's does; where the clipboard refuses, the address
   * is selected so the player can copy it by hand.
   */
  import * as m from "../../paraglide/messages.js";
  import { copyText } from "../../lib/clipboard";
  import { CONFIRM_MS, confirm } from "../kit/motion";
  import Button from "../kit/Button.svelte";
  import Icon from "../kit/Icon.svelte";
  import { requestUiSound } from "../kit/ui-sounds";
  import type { StudioLink } from "../ruken/studio-links";

  let { link }: { link: StudioLink } = $props();

  /** The address as a person would say it: no scheme, no "www.". */
  const address = $derived(link.href.replace(/^https?:\/\//, "").replace(/^www\./, ""));
  const addressId = $derived(`ff-contact-address-${link.id}`);

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let button: HTMLButtonElement | undefined = $state();
  let addressNode: HTMLElement | undefined = $state();
  let confirming: ReturnType<typeof confirm> | undefined;

  $effect(() => {
    const active = copied;
    if (button === undefined) return;
    if (confirming === undefined) confirming = confirm(button, { active });
    else confirming.update({ active });
  });

  function copy(): void {
    copyText(link.href).then(
      () => {
        if (button !== undefined) requestUiSound(button, "copied");
        copied = true;
        clearTimeout(timer);
        timer = setTimeout(() => (copied = false), CONFIRM_MS);
      },
      () => {
        // Selected, the address is one long-press or Ctrl+C from the clipboard.
        if (addressNode === undefined) return;
        const range = document.createRange();
        range.selectNodeContents(addressNode);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
    );
  }

  $effect(() => () => clearTimeout(timer));
</script>

<li class="ff-contact-row">
  <span class="ff-contact-row__icon" aria-hidden="true"><Icon name={link.icon} /></span>
  <!-- A narrow window breaks the address after its slash, not mid-word. -->
  <span bind:this={addressNode} id={addressId} class="ff-contact-row__address" data-testid={`social-${link.id}-address`}
    >{#each address.split("/") as part, i (i)}{#if i > 0}/<wbr />{/if}{part}{/each}</span
  >
  <Button
    bind:ref={button}
    data-testid={`social-${link.id}-copy`}
    data-copied={String(copied)}
    data-sfx="none"
    aria-describedby={addressId}
    onclick={copy}
    class="ff-contact-row__copy shrink-0"
  >
    <span data-confirm-label="idle">{m.ready_copy()}</span>
    <span data-confirm-label="done">{m.ready_copied()}<span aria-hidden="true"> ✓</span></span>
  </Button>
</li>

<style>
  /* Icon, address, Copy on one line; the address takes the room and may wrap. */
  .ff-contact-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .ff-contact-row__icon {
    --ff-icon-size: 28px;
    display: inline-flex;
    flex: none;
  }
  .ff-contact-row__address {
    flex: 1 1 auto;
    font-family: var(--ff-font-ui);
    color: var(--ff-text);
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: all;
    -webkit-user-select: all;
  }
</style>
