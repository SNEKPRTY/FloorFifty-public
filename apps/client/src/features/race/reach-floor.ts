/**
 * Runs an element down to the floor of the picture.
 *
 * The menu's ledge stands on a building (`MenuHero.svelte`), and the building
 * has to reach the bottom of what the player sees whatever the screen's shape.
 * Menus fill the whole window and draw no letterbox bar, so the floor is the
 * window's foot. CSS alone cannot say how far that is from the element's own
 * top, which depends on the hero's layout, so the height is measured and
 * published as `--ff-facade-height`.
 */

/** Where the picture's floor is, in viewport pixels. */
export function floorFor(viewportHeight: number): number {
  return viewportHeight;
}

/**
 * An element's top in viewport pixels, *without* the transforms on it or its
 * ancestors.
 *
 * The hero rises in with a GSAP translate; measuring through it would size the
 * building for wherever the entrance happened to be when the layout ran, and
 * leave a gap or an overshoot once it landed. Offsets are layout positions, so
 * they are the place the element comes to rest.
 */
function restingTop(node: HTMLElement): number {
  let top = 0;
  let at: HTMLElement | null = node;
  while (at !== null) {
    top += at.offsetTop - (at === node ? 0 : at.scrollTop);
    at = at.offsetParent as HTMLElement | null;
  }
  return top;
}

export function reachFloor(node: HTMLElement): { destroy(): void } {
  const overlay = node.closest<HTMLElement>(".ff-overlay");
  let frame = 0;

  const measure = (): void => {
    frame = 0;
    const floor = floorFor(window.innerHeight);
    const height = Math.max(0, Math.ceil(floor - restingTop(node)));
    node.style.setProperty("--ff-facade-height", `${height}px`);
  };
  // Batched to a frame: a resize fires the observers and the window event
  // together, and one measurement answers all of them.
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };

  measure();
  window.addEventListener("resize", schedule);
  // The hero reflows as fonts arrive and the form factor changes.
  // Optional: a test DOM has no `ResizeObserver`, and the window event still
  // covers a real resize without it.
  const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  if (node.parentElement !== null) resized?.observe(node.parentElement);
  if (overlay !== null) resized?.observe(overlay);

  return {
    destroy() {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      resized?.disconnect();
    },
  };
}
