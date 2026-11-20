// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isEmbedded, mountsLandscapeGate } from "../../../../apps/client/src/features/platform/embedded-frame";

/**
 * Audit S9: the "turn your phone upright" cover was skipped only for a hosted
 * game, and since the boot without a host (PR #102) no game is "hosted". Inside
 * Ruken's frame the cover appeared on an iPhone held sideways, for good, with
 * advice (add the page to the Home Screen) that would install Ruken's page.
 */

describe("a game in a frame (audit S9)", () => {
  it("is embedded when its window is not the top one", () => {
    const top = {};
    expect(isEmbedded({ self: {}, top })).toBe(true);
  });

  it("is not embedded when it is its own top window", () => {
    const self = {};
    expect(isEmbedded({ self, top: self })).toBe(false);
  });

  it("is embedded when reading the top window is refused", () => {
    const refused = {
      self: {},
      get top(): never {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    expect(isEmbedded(refused)).toBe(true);
  });
});

describe("whether the landscape cover is mounted (audit S9)", () => {
  const plain = { webdriver: false, hosted: false, embedded: false };

  it("is mounted for a game on its own page", () => {
    expect(mountsLandscapeGate(plain)).toBe(true);
  });

  it("is not mounted inside a frame, whatever the host answered", () => {
    expect(mountsLandscapeGate({ ...plain, embedded: true })).toBe(false);
  });

  it("is not mounted for a hosted game", () => {
    expect(mountsLandscapeGate({ ...plain, hosted: true })).toBe(false);
  });

  it("is not mounted under automation", () => {
    expect(mountsLandscapeGate({ ...plain, webdriver: true })).toBe(false);
  });
});
