import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import RichText from "../../../../apps/client/src/features/kit/RichText.svelte";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

describe("RichText (languages plan, extraction rule 7)", () => {
  it("renders a message's strong run in <strong>, and the rest as text", () => {
    component = mount(RichText, { target: document.body, props: { parts: m.pause_race_continues.parts({}) } });
    flushSync();
    expect(document.body.querySelector("strong")?.textContent).toBe("Race continues");
    expect(document.body.textContent).toBe("Race continues — the other racers are still climbing.");
  });
});
