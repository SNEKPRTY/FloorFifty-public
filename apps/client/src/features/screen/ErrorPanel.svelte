<script lang="ts">
  /**
   * A recoverable failure, and what the player can do about it.
   *
   * Every failure shown here names a way forward. A failure with no action is a
   * bug rather than a state: if the client cannot say what to do next, it
   * should not be drawing a panel.
   *
   * `role="alert"` rather than `role="status"`, because this interrupts. The
   * player has usually just pressed something and needs to know it did not
   * work, which is exactly the case an assertive live region is for.
   *
   * Drawn by `Notice`, a glass panel: a failure is often the thing that means
   * the artwork did not arrive, so it may be drawn over nothing at all.
   */
  import * as m from "../../paraglide/messages.js";
  import { errorCopy } from "./error-copy";
  import type { RecoverableError } from "../net/error-view";
  import Button from "../kit/Button.svelte";
  import Notice from "../kit/Notice.svelte";
  import { requestUiSound } from "../kit/ui-sounds";

  /** A failure arriving is heard, once, as the panel mounts. */
  const sounded = (node: HTMLElement): void => requestUiSound(node, "error");

  let {
    error,
    onRetry,
    onDismiss,
    onReload = () => window.location.reload(),
  }: {
    error: RecoverableError;
    /** Offered only when the failure is one a second attempt could survive. */
    onRetry?: () => void;
    onDismiss?: () => void;
    /** Injectable so a test is not obliged to navigate the page. */
    onReload?: () => void;
  } = $props();

  /**
   * Every button here is blue. The panel lies over a screen and is not a screen of its own, so the green
   * stays on the step forward beneath it (Try again beside Find a race would be two).
   */
  const retryShown = $derived(error.retry && onRetry !== undefined);
</script>

<!-- Heard once, as it arrives; `contents`, so the notice is the layout. -->
<div class="contents" use:sounded>
  <Notice
    tone="problem"
    testId="error-view"
    messageTestId="error-message"
    message={errorCopy(error.code, error.detail)()}
    extra={{ "data-code": error.code }}
    closeTestId="error-dismiss"
    {...onDismiss === undefined ? {} : { onClose: onDismiss }}
  >
    {#snippet actions()}
      {#if retryShown}
        <Button data-testid="error-retry" onclick={onRetry}>{m.error_try_again()}</Button>
      {/if}

      {#if error.code === "VERSION_MISMATCH" || (error.code === "SERVER_UPDATING" && error.detail === undefined)}
        <!-- A reload, never a retry: the same request would fail the same
             way, and only newer client code can succeed. -->
        <Button data-testid="error-reload" onclick={onReload}>{m.error_reload()}</Button>
      {/if}
    {/snippet}
  </Notice>
</div>
