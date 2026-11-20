/**
 * The tile reveal (unlockables spec §7.2): an item earned by play turns from
 * its locked look to its art the first time its tile is on screen: a flip, a
 * transform keyframe named `ff-reveal-*`, or a cross-fade under reduced
 * motion. `done` once it has played, so a re-render never starts it again.
 *
 * A Svelte action: `<button use:revealOnce={item.isNew === true}>`. Each
 * component styles its own `[data-reveal]`.
 */

import { reducedMotion } from "./motion";

export function revealOnce(node: HTMLElement, isNew: boolean) {
  if (!isNew) return {};
  node.dataset["reveal"] = reducedMotion() ? "fade" : "flip";
  // The keyframes run on the tile itself or on a child of it; Svelte scopes
  // their names, so a reveal's is matched by the part every one shares.
  const settle = (event: Event) => {
    const name = (event as AnimationEvent).animationName ?? "";
    if (event.target === node || name.includes("ff-reveal")) node.dataset["reveal"] = "done";
  };
  node.addEventListener("animationend", settle);
  return { destroy: () => node.removeEventListener("animationend", settle) };
}
