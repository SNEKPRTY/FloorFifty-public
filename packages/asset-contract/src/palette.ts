/**
 * The palette's public surface.
 *
 * Two layers: the 64 swatches, which are the palette, and the roles, which are
 * this game's use of it. Consumers import roles; only the quantizer and the
 * lookup-texture generator address swatches directly.
 */

export * from "./swatches";
export * from "./roles";
