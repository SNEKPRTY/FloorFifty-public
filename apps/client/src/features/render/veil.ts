/**
 * What ScreenManager needs of a transition veil (race-flow spec §7.3): cover
 * the screen, then reveal it. Each settles when its motion ends; reduced
 * motion is the veil's own business.
 */
export interface VeilPort {
  cover(): Promise<void>;
  reveal(): Promise<void>;
  destroy(): void;
}

export type Animate = (durationMs: number, onFrame: (t: number) => void) => Promise<void>;

/** The flood rising over the screen (race-flow spec §7.3). */
export const COVER_MS = 350;
/** The flood draining off the new screen. */
export const REVEAL_MS = 350;
/** Each half of the plain veil's fade: reduced motion's, and the fallback's. */
export const REDUCED_HALF_MS = 100;
/** Above every layer in use; the highest, the network loader, sits at 60. */
export const VEIL_Z = 70;
/**
 * The loader between screens, and a failure's Try again, while a liquid move
 * covers the screen: above the veil, or a cold Story from the title would
 * be a blue wipe with no progress and a failed one a blue wipe for ever.
 */
export const LOADER_Z = VEIL_Z + 2;

/** The one place both veils take their layer and their catch of the pointer. */
export function veilLayer(element: HTMLElement): void {
  element.dataset["testid"] = "transition-veil";
  Object.assign(element.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: String(VEIL_Z),
    pointerEvents: "auto",
  });
}

/**
 * The plain veil: the action blue, faded. Reduced motion's veil, and the
 * fallback when WebGL is missing or its context is lost (race-flow spec §7.2).
 */
export function createDomVeil(
  host: HTMLElement,
  animate: Animate,
  durations: () => { cover: number; reveal: number },
): VeilPort & { showNow(): void; hide(): void } {
  const element = document.createElement("div");
  veilLayer(element);
  element.style.background = "var(--ff-plain)";
  element.style.opacity = "0";
  return {
    async cover() {
      if (element.parentElement !== host) host.appendChild(element);
      await animate(durations().cover, (t) => (element.style.opacity = String(t)));
      element.style.opacity = "1";
    },
    async reveal() {
      await animate(durations().reveal, (t) => (element.style.opacity = String(1 - t)));
      element.remove();
    },
    /** Off the page at once. */
    hide() {
      element.remove();
    },
    /** Fully up at once, for a liquid veil that lost its context mid-transition. */
    showNow() {
      if (element.parentElement !== host) host.appendChild(element);
      element.style.opacity = "1";
    },
    destroy() {
      element.remove();
    },
  };
}

/**
 * Frames on requestAnimationFrame, and a timer behind it: a hidden tab stops
 * frames, and a veil that waited on them would stay up over a screen that has
 * already changed.
 */
export const frameAnimate: Animate = (durationMs, onFrame) =>
  new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onFrame(1);
      resolve();
    };
    const fallback = setTimeout(finish, durationMs + 100);
    const frame = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - start) / durationMs);
      onFrame(t);
      if (t >= 1) {
        clearTimeout(fallback);
        finish();
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
