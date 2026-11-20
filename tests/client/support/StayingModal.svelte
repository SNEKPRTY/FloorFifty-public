<script lang="ts">
  /** A `Modal` whose owner keeps it open on Close, as the pause overlay does in a sub-view. */
  import Modal from "../../../apps/client/src/features/kit/Modal.svelte";

  let closes = $state(0);
</script>

<Modal title="Staying" testId="staying-modal" onClose={() => (closes += 1)}>
  <span data-testid="closes">{closes}</span>
</Modal>
