import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { defineCustomClientStrategy, setLocale } from "../../../../apps/client/src/paraglide/runtime.js";
import LocaleProbe from "./fixtures/LocaleProbe.svelte";

// The claim spec §3.4 rests on: a compiled message read in a template
// re-renders when the custom strategy's source changes, with no reload.
// The source here is a bare `$state` box, the shape the settings store has,
// answering a detected "en" while nothing is chosen, as the real strategy does.
//
// The runtime's first `getLocale()` echoes what it resolved into
// `setLocale()` once -- from inside the template here. A handler that wrote
// that echo would mutate state mid-render (Svelte refuses) and, in the app,
// would save the detected locale as a choice. So a write happens only when
// the locale differs from the one already answered.
const box = $state<{ locale: string | undefined }>({ locale: undefined });
const answer = (): string => box.locale ?? "en";

defineCustomClientStrategy("custom-settings", {
  getLocale: answer,
  setLocale: (locale) => {
    if (locale !== answer()) box.locale = locale;
  },
});

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  box.locale = undefined;
});

describe("Paraglide under a custom-settings strategy", () => {
  it("re-renders a message and the locale after setLocale(…, { reload: false })", () => {
    component = mount(LocaleProbe, { target: document.body });
    flushSync();
    expect(document.querySelector('[data-testid="probe-locale"]')?.textContent).toBe("en");
    expect(document.querySelector('[data-testid="probe-message"]')?.textContent).toBe("Play");

    setLocale("ja", { reload: false });
    flushSync();

    expect(document.querySelector('[data-testid="probe-locale"]')?.textContent).toBe("ja");
    // The message itself re-rendered, in Japanese.
    expect(document.querySelector('[data-testid="probe-message"]')?.textContent).toBe("プレイ");
  });
});
