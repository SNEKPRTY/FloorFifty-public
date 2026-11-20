/**
 * The touch controls guide in Settings' Controls tab: one captioned picture
 * per gesture. The captions are the tutorial's own words, read from the
 * catalogue, so a caption is the sentence -- never the message function that
 * makes it.
 */

import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import TouchGuide from "../../../../apps/client/src/features/settings/TouchGuide.svelte";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted !== undefined) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

describe("the touch guide", () => {
  it("captions each gesture with its words", () => {
    mounted = mount(TouchGuide, { target: document.body, props: { mode: "swipe" } });
    const captions = [...document.querySelectorAll("figcaption")].map((caption) => caption.textContent?.trim());
    expect(captions).toEqual([
      m.tutorial_touch_steer(),
      m.tutorial_touch_fast_fall(),
      m.tutorial_touch_restart(),
      m.tutorial_touch_buttons_hint(),
    ]);
  });
});
