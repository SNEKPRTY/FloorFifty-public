<script lang="ts">
  /**
   * What a DLC pack holds, and that it is coming (unlockables spec §7.3): the
   * pack's title, every item in it with its art, and one line. No price, no
   * button and no link: the only control is Close, and Escape, the pad's back
   * or a tap outside close it too.
   *
   * The one modal shell, so focus moves in, wraps, and returns to the tile
   * that opened it.
   */
  import type { GameContentPayload, PackContent } from "@floor-fifty/shared/content/game-content";
  import { packTitle } from "../i18n/content";
  import * as m from "../../paraglide/messages.js";
  import { packItems } from "./picker-model";
  import Modal from "../kit/Modal.svelte";

  let {
    pack,
    content,
    artSrc,
    onClose,
  }: {
    pack: PackContent;
    content: GameContentPayload;
    /** A DOM image URL for an art alias, once the manifest is known. */
    artSrc: (alias: string) => string | undefined;
    onClose: () => void;
  } = $props();

  const items = $derived(packItems(content, pack, artSrc));
</script>

<Modal title={packTitle(pack)} testId="coming-soon" {onClose} onBackdrop={onClose}>
  <ul class="ff-coming-soon__items m-0 list-none p-0" data-testid="coming-soon-items">
    {#each items as item (`${item.kind}:${item.id}`)}
      <li class="ff-coming-soon__item">
        {#if item.art !== undefined}<img class="ff-coming-soon__art" src={item.art} alt="" draggable="false" />{/if}
        <span class="ff-coming-soon__label">{item.label}</span>
      </li>
    {/each}
  </ul>
  <p class="ff-aq-secondary m-0" data-testid="coming-soon-line">{m.select_coming_soon()}</p>
</Modal>

<style>
  /* Laid out by the space the dialog gives it, never by the form factor (UI
     layout spec §2.1 rule 1): as many columns of at least 150 px as fit. A
     phone held upright gets one, a tablet or desktop two, and the wide, short
     dialog of a phone held sideways one row, so the sheet fits 780 × 270
     without scrolling. */
  .ff-coming-soon__items {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }
  .ff-coming-soon__item {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
  }
  .ff-coming-soon__art {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--ff-control-radius);
  }
  .ff-coming-soon__label {
    color: var(--ff-text);
    font: 600 var(--ff-type-hint) / 1.3 var(--ff-font-ui);
  }
</style>
