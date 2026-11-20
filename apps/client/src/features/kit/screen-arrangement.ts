/**
 * Which arrangement a screen root gives its `ScreenFrame` (UI layout spec
 * §2, layer 4). The one place a screen's shape is chosen from the form
 * factor and the height tier; everything inside the frame sizes itself to
 * the space it is given.
 */
import type { FormFactor } from "../platform/form-factor";
import type { HeightTier } from "../platform/height-tier";

export type Arrangement = "stack" | "split" | "rail";

/**
 * The title and the lobby's connect form. Held upright, the hero stands over
 * the form. A desktop window of any width, and a phone held sideways at any
 * height, set them side by side: at 270 px tall there is no room to stack
 * them, and the hero shrinks instead (the `compact` tokens).
 */
export function menuArrangement(formFactor: FormFactor, _tier: HeightTier | undefined): Arrangement {
  return formFactor === "phone-portrait" || formFactor === "tablet-portrait" ? "stack" : "split";
}

/**
 * The ready room. Held upright, the seats stand over the settings and the
 * actions; held sideways and on desktop, side by side (UI layout spec §6.3).
 * Inside either, `Split` and `ScrollList` size themselves to what is left.
 */
export function roomArrangement(formFactor: FormFactor): Arrangement {
  return formFactor === "phone-portrait" || formFactor === "tablet-portrait" ? "stack" : "split";
}

/**
 * The layout a screen root hands the components below it (UI layout spec
 * §2.1 rule 1). Only a root reads the form factor; what it decides travels
 * down as one of these, as a `data-layout` attribute on the root's own element
 * or as a prop, so no component below a root names a form factor.
 */
export type ScreenLayout = "upright" | "tablet" | "sideways" | "desk";

export function screenLayout(formFactor: FormFactor): ScreenLayout {
  switch (formFactor) {
    case "phone-portrait":
      return "upright";
    case "tablet-portrait":
      return "tablet";
    case "phone-landscape":
      return "sideways";
    case "desktop":
      return "desk";
  }
}
