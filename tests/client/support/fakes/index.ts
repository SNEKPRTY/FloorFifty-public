/**
 * Client test doubles.
 *
 * The renderer is the one thing these fakes replace wholesale: jsdom has no
 * WebGL, and a screen's lifetime is about ownership rather than pixels. Asset
 * loading, audio, and the network are replaced with recording ports so a test
 * can assert what a screen asked for.
 */

export * from "./stage";
export * from "./assets";
export * from "./audio";
export * from "./network";
export * from "./content";
export * from "./events";
export * from "./settings";
export * from "./screens";
export * from "./server";
export * from "./input";
export * from "./ui";
