/**
 * Switches on the page's deferred stylesheets and waits until every one has
 * loaded (the build marks them, `apps/client/defer-stylesheets.ts`).
 *
 * The boot calls this before any screen mounts: the stylesheets no longer hold
 * back the first paint (so the boot loader shows at once), and no screen may be
 * drawn before its styles are in. A stylesheet that fails rejects, and the boot
 * shows its failure panel with Try again. The wait has no clock of its own: the
 * boot guards it with the one stall rule (`lib/load-meter.ts`), whose
 * signal ends it.
 */
export function applyDeferredStylesheets(doc: Document, signal?: AbortSignal): Promise<void> {
  const links = [...doc.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet'][data-ff-style]")];
  return Promise.all(links.map((link) => switchOn(link, signal))).then(() => undefined);
}

function switchOn(link: HTMLLinkElement, signal: AbortSignal | undefined): Promise<void> {
  // Listen first: switching the media on can finish a load that was waiting.
  const loaded = new Promise<void>((resolve, reject) => {
    // A sheet that arrived before the boot asked is already parsed.
    if (link.sheet !== null) {
      resolve();
      return;
    }
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error(`a stylesheet did not load: ${link.href}`)), { once: true });
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  link.media = "all";
  return loaded;
}
