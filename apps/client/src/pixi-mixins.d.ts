import type { AccessibilitySystemOptions } from "pixi.js";

declare global {
  namespace PixiMixins {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface ApplicationOptions extends AccessibilitySystemOptions {}
  }
}

export {};
