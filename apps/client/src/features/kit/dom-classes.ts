/**
 * The kit's look for a surface drawn outside Svelte. The boot failure is plain DOM because it
 * shows when the client could not start at all, so it cannot mount a `Panel` or a `Button`;
 * it wears the same classes through these, and only the kit writes them (`one-look.test.ts`).
 */

/** What `Panel` wears: the glass, and its rise as a stylesheet keyframe. */
export const PANEL_DOM_CLASS = "ff-aquarian-panel ff-panel-arrive";

/** What `Button kind="go"` wears. */
export const BUTTON_GO_DOM_CLASS = "ff-aq-control ff-aq-control--go";
