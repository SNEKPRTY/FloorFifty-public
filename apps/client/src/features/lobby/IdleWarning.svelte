<script lang="ts">
  /**
   * "This room closes in one minute": the warning before the server closes a
   * room nobody has done anything in for ten minutes (audit B1), with the one
   * thing to press to keep it open.
   *
   * Rendered always and hidden when there is nothing to say, as the connection
   * indicator is, so the live region is in the document before its text changes.
   * A notice, over the screens and under the network loader (z 60).
   */
  import * as m from "../../paraglide/messages.js";
  import type { NetworkPort } from "../net/network";
  import type { IdleWarningStore } from "../net/idle-warning.svelte";
  import Button from "../kit/Button.svelte";
  import Notice from "../kit/Notice.svelte";

  let { network, store }: { network: Pick<NetworkPort, "keepRoomOpen">; store: IdleWarningStore } = $props();

  function keepOpen(): void {
    store.clear();
    // The room is told; if it cannot be, it closes as it was going to, and the
    // lobby already says why.
    void network.keepRoomOpen().catch(() => undefined);
  }
</script>

<Notice testId="idle-warning" tone="info" message={m.idle_warning_line()} hidden={!store.visible} layer={55}>
  {#snippet actions()}
    <Button data-testid="idle-warning-keep" onclick={keepOpen}>{m.idle_warning_keep()}</Button>
  {/snippet}
</Notice>
