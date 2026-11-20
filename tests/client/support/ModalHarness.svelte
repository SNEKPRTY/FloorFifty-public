<script lang="ts">
  /** An opener and a `Modal` holding two buttons, for the modal's own tests. */
  import Modal from "../../../apps/client/src/features/kit/Modal.svelte";

  let {
    onClose = () => {},
    backdrop = false,
    fit,
    withActions = false,
  }: { onClose?: () => void; backdrop?: boolean; fit?: "auto" | "sheet"; withActions?: boolean } = $props();
  let open = $state(false);
</script>

<!-- Quiet, as every real opener is: the modal's own ui.open is its sound. -->
<button type="button" data-testid="opener" data-sfx="none" onclick={() => (open = true)}>Open</button>
{#if open}
  <Modal
    title="Harness"
    testId="harness-modal"
    {...fit === undefined ? {} : { fit }}
    onClose={() => {
      open = false;
      onClose();
    }}
    onBackdrop={backdrop
      ? () => {
          open = false;
          onClose();
        }
      : undefined}
    actions={withActions ? harnessActions : undefined}
  >
    <button type="button" data-testid="first">First</button>
    <button type="button" data-testid="last">Last</button>
  </Modal>
{/if}

{#snippet harnessActions()}
  <button type="button" data-testid="harness-action">Go</button>
{/snippet}
