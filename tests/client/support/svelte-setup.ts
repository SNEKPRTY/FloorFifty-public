/**
 * Svelte test setup.
 *
 * Runs after `setup.ts` for every case in the client project.
 */

import { afterEach } from "vitest";

// A file that runs on node (`@vitest-environment node`) has no DOM: it
// mounts nothing, so it skips the DOM matchers and the mount helpers, which
// are the costly imports here, and everything below.
if (typeof window !== "undefined") await installDom();

async function installDom(): Promise<void> {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/svelte");
  const { closeOpenScreens } = await import("./open-screens");

  // jsdom has no ResizeObserver, and Svelte's `bind:clientWidth` needs one. It
  // never fires here, so a measured box stays 0 x 0 and a grid takes the spec's
  // page shape for the form factor, which is what its tests assume.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }

  // jsdom has no Web Animations API, and Svelte runs `in:`, `out:` and
  // `animate:` through `Element.animate`. This one finishes at once, so a
  // transition settles in its final state and an outro's unmount completes.
  // `animate:` (the standings' flip) asks an element for its running animations first.
  if (typeof Element.prototype.getAnimations !== "function") Element.prototype.getAnimations = () => [];
  if (typeof Element.prototype.animate !== "function") {
    Element.prototype.animate = function animate(): Animation {
      const animation = {
        onfinish: null as ((event: Event) => void) | null,
        oncancel: null,
        finished: Promise.resolve(),
        currentTime: 0,
        playState: "finished",
        cancel() {},
        finish() {},
        play() {},
        pause() {},
        reverse() {},
      };
      queueMicrotask(() => animation.onfinish?.(new Event("finish")));
      return animation as unknown as Animation;
    };
  }

  // A component left mounted between cases keeps its network subscription, and
  // the next case then sees snapshots it never sent. A screen the fakes opened
  // is closed too, so no timer of its outlives the file's jsdom.
  afterEach(() => {
    cleanup();
    closeOpenScreens();
  });
}
