<script lang="ts">
  /**
   * Asked once, of a player who presses to start a match without having been
   * shown how to climb: look, or skip. Skip, Escape and the close button all mean the same thing:
   * carry on with the press.
   */
  import * as m from "../../paraglide/messages.js";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";

  let { onShow, onSkip }: { onShow: () => void; onSkip: () => void } = $props();
</script>

<Modal title={m.gate_title()} testId="match-gate" onClose={onSkip}>
  <p class="ff-aq-body m-0 text-aq-ink">{m.gate_body()}</p>
  {#snippet actions()}
    <Button kind="go" data-testid="match-gate-show" onclick={onShow}>{m.gate_show()}</Button>
    <Button kind="ghost" data-testid="match-gate-skip" data-sfx="back" onclick={onSkip}>{m.gate_skip()}</Button>
  {/snippet}
</Modal>
