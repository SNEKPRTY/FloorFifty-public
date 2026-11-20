/**
 * The boot loader: the spinner `index.html` paints from the first frame, so
 * the page is never a plain black while the client downloads, connects and
 * loads the splash. Whoever shows the first real thing dismisses it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOT_LOADER_FADE_MS, dismissBootLoader, wordBootLoader } from "../../../../apps/client/src/features/boot/boot-loader";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";

const plant = (): HTMLElement => {
  const loader = document.createElement("div");
  loader.id = "ff-boot-loader";
  document.body.append(loader);
  return loader;
};

afterEach(() => {
  document.getElementById("ff-boot-loader")?.remove();
  vi.useRealTimers();
});

describe("the boot loader", () => {
  it("fades, then leaves the document", () => {
    vi.useFakeTimers();
    const loader = plant();
    dismissBootLoader();
    expect(loader.classList.contains("ff-boot-loader--gone")).toBe(true);
    expect(loader.isConnected).toBe(true);
    vi.advanceTimersByTime(BOOT_LOADER_FADE_MS);
    expect(loader.isConnected).toBe(false);
  });

  it("can be dismissed twice, or when it was never there", () => {
    plant();
    dismissBootLoader();
    expect(() => dismissBootLoader()).not.toThrow();
    document.getElementById("ff-boot-loader")?.remove();
    expect(() => dismissBootLoader()).not.toThrow();
  });
});

describe("the boot loader's word", () => {
  it("is said in the player's language once the language is known: index.html can only say Loading", () => {
    const loader = plant();
    loader.innerHTML = '<span class="ff-boot-loader__ring" aria-hidden="true"></span><span>Loading</span>';
    const undo = installLocaleStrategy(new SettingsStore(memoryStorage()), () => ["ja-JP"]);
    try {
      wordBootLoader();
      expect(loader.querySelector("span:not([aria-hidden])")!.textContent).toBe("読み込み中");
    } finally {
      undo();
    }
  });
});
