/**
 * The pick pulse for native controls (animations audit, "Changes inside a
 * panel snap"): a Svelte action on a group of checkboxes and radios. When one
 * of them is changed by the player, its row (the `<label>` that holds it)
 * plays one `pulse`: scale, never colour, and nothing at all under reduced
 * motion. A slider is left alone, because it already follows the finger.
 *
 * It listens once on the group, so a row added tomorrow has the pulse already.
 */
import { pulse } from "./motion";

export function pickPulse(node: HTMLElement): { destroy: () => void } {
  const onChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type === "range") return;
    pulse(target.closest("label") ?? target);
  };
  node.addEventListener("change", onChange);
  return { destroy: () => node.removeEventListener("change", onChange) };
}
