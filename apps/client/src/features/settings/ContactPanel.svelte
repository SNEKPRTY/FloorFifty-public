<script lang="ts">
  /**
   * The Socials modal's body (spec §3.1.1): the studio's socials and website
   * as icons alone, in one row (Owner, 2026-11-19: "we don't need text for the
   * contact icons"); each is named to a screen reader and on hover. Each opens outside the game so a race in another
   * tab is never navigated away. Guarded, as Full screen is: each one reaches
   * past the game, so a pad's A follows it only when the pad walked there
   * (see focus-nav), never on focus a mouse click left behind.
   *
   * Inside Ruken's frame popups are blocked, so a link there opens nothing:
   * each contact shows its address with a Copy button instead.
   */
  import IconButton from "../kit/IconButton.svelte";
  import { isEmbedded } from "../platform/embedded-frame";
  import { STUDIO_LINKS } from "../ruken/studio-links";
  import ContactCopyRow from "./ContactCopyRow.svelte";

  let { embedded = typeof window !== "undefined" && isEmbedded(window) }: { embedded?: boolean } = $props();
</script>

{#if embedded}
  <ul class="ff-contact-copy m-0 p-0 text-aq-ink" style="list-style: none" data-testid="contact-copy">
    {#each STUDIO_LINKS as link (link.id)}
      <ContactCopyRow {link} />
    {/each}
  </ul>
{:else}
  <ul class="ff-contact m-0 p-0 text-aq-ink" style="list-style: none">
    {#each STUDIO_LINKS as link (link.id)}
      <li>
        <IconButton
          class="ff-contact__link"
          href={link.href}
          icon={link.icon}
          label={link.label()}
          data-testid={`social-${link.id}`}
          data-pad-guard
        />
      </li>
    {/each}
  </ul>
{/if}

<style>
  /* One contact to a line, the Copy buttons in one column. */
  .ff-contact-copy {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Each link a square icon button, all in one centred row. */
  .ff-contact {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
  :global(.ff-contact__link) {
    --ff-icon-size: 28px;
    width: 56px;
    min-height: 56px;
    padding: 0;
    justify-content: center;
    text-decoration: none;
  }
</style>
