import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import ComingSoonSheet from "../../../../apps/client/src/features/select/ComingSoonSheet.svelte";
import { packItems } from "../../../../apps/client/src/features/select/picker-model";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);
const friends = content.packs.find((pack) => pack.id === "friends")!;

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

function render(onClose = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(ComingSoonSheet, {
    target: host,
    props: { pack: friends, content, artSrc: (alias: string) => `/assets/${alias}`, onClose },
  });
  flushSync();
  return { sheet: () => document.querySelector<HTMLElement>("[data-testid=coming-soon]")!, onClose };
}

describe("the pack's items", () => {
  it("are every item in the pack, with its art", () => {
    const items = packItems(content, friends, (alias) => `/assets/${alias}`);
    expect(items.map((item) => item.label)).toEqual(["Robo", "Kitsune"]);
    expect(items.every((item) => item.kind === "character" && item.art?.startsWith("/assets/"))).toBe(true);
  });
});

describe("the Coming soon sheet (unlockables spec §7.3)", () => {
  it("shows the pack's title, every item, and Coming soon, with no price and no button but Close", () => {
    const { sheet } = render();
    expect(sheet().getAttribute("role")).toBe("dialog");
    expect(sheet().querySelector("h2")!.textContent).toBe(friends.title);
    expect(sheet().textContent).toContain("Robo");
    expect(sheet().textContent).toContain("Kitsune");
    expect(sheet().textContent).toContain("Coming soon");
    expect(sheet().querySelectorAll("button")).toHaveLength(1);
    expect(sheet().querySelectorAll("a")).toHaveLength(0);
    expect(sheet().textContent).not.toMatch(/[$£€]|buy|price/i);
  });

  it("closes on its close button and on Escape", () => {
    const { sheet, onClose } = render();
    sheet().querySelector<HTMLButtonElement>("[data-testid=modal-close]")!.click();
    sheet().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on a tap outside it, and not on a tap inside", () => {
    const { sheet, onClose } = render();
    sheet().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    sheet().parentElement!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
