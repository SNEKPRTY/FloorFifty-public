<script lang="ts">
  /**
   * The "?" sheet: long text that does not belong on a short screen (the ready
   * room's rules, Settings' privacy note), behind a button with a word.
   *
   * A blue button -- the step forward on its screen is never this -- opening a
   * small popup. Short text stays a popup, centred over the dimmed page; text
   * taller than the room the screen gives it becomes a sheet (the `Modal`'s
   * own rule), the text scrolling and Close pinned. A tap outside closes it.
   */
  import * as m from "../../../paraglide/messages.js";
  import type { Snippet } from "svelte";
  import Button from "../Button.svelte";
  import Modal from "../Modal.svelte";

  let { title, testId, children }: { title: string; testId: string; children: Snippet } = $props();
  let open = $state(false);

  /**
   * A dialog's glass makes it the frame its fixed children are placed in, so a
   * sheet opened from inside a dialog was centred on that dialog (or on its
   * scrolling list), not the window, and clipped at its edge. The sheet's own
   * wrapper moves up beside that dialog's backdrop, so it covers the window.
   * Where no dialog holds the button (the ready room), it stays put.
   */
  function hoist(node: HTMLElement): { destroy: () => void } {
    const host = node.closest<HTMLElement>(".ff-modal")?.parentElement;
    if (host !== null && host !== undefined) host.append(node);
    return { destroy: () => node.remove() };
  }
</script>

<Button data-testid={testId} data-sfx="none" onclick={() => (open = true)}>
  <span aria-hidden="true">?</span>
  {title}
</Button>

{#if open}
  <div class="contents" use:hoist>
    <Modal {title} onBackdrop={() => (open = false)} testId={`${testId}-sheet`} onClose={() => (open = false)}>
      {@render children()}
      {#snippet actions()}
        <Button data-testid="info-sheet-close" data-sfx="back" onclick={() => (open = false)}>
          {m.shell_close()}
        </Button>
      {/snippet}
    </Modal>
  </div>
{/if}
