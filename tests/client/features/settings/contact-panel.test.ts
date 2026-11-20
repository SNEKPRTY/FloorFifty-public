import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ContactPanel from "../../../../apps/client/src/features/settings/ContactPanel.svelte";
import { STUDIO_LINKS } from "../../../../apps/client/src/features/ruken/studio-links";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

describe("the Socials links", () => {
  it("are guarded against a pad confirm, since each one leaves the game", () => {
    component = mount(ContactPanel, { target: document.body });
    flushSync();
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(STUDIO_LINKS.length);
    for (const link of links) expect(link.hasAttribute("data-pad-guard")).toBe(true);
  });

  it("point at the studio's Instagram, X, Discord and website, each an icon alone (Owner, 2026-11-19)", () => {
    component = mount(ContactPanel, { target: document.body });
    flushSync();
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.href)).toEqual([
      "https://www.instagram.com/snekprty",
      "https://x.com/snekprty",
      "https://discord.gg/snekprty",
      "https://snekprty.com/",
    ]);
    for (const link of links) {
      // The icon is the whole button: no words beside it, the name is for a screen reader and a hover.
      expect(link.textContent?.trim()).toBe("");
      expect(link.getAttribute("aria-label")).not.toBeNull();
      expect(link.querySelector("svg")).not.toBeNull();
      expect(link.target).toBe("_blank");
    }
  });
});

describe("the Socials buttons", () => {
  it("are the kit's icon buttons: ghost links, square, in the one row", () => {
    component = mount(ContactPanel, { target: document.body });
    flushSync();
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a")];
    for (const link of links) {
      expect(link.classList.contains("ff-aq-control")).toBe(true);
      expect(link.classList.contains("ff-aq-control--ghost")).toBe(true);
      expect(link.classList.contains("ff-icon-button")).toBe(true);
      expect(link.rel).toBe("noopener noreferrer");
    }
  });
});

describe("the Socials names", () => {
  it("name every link to a screen reader and on hover", () => {
    component = mount(ContactPanel, { target: document.body });
    flushSync();
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(STUDIO_LINKS.map((link) => link.label()));
    expect(links.map((link) => link.title)).toEqual(STUDIO_LINKS.map((link) => link.label()));
  });
});

describe("the Socials inside Ruken's frame", () => {
  // Ruken's frame blocks popups, so a link that opens a new tab does nothing
  // there: each contact shows its address with a Copy button instead (Owner's pick, "Show address + Copy").
  const addresses = ["instagram.com/snekprty", "x.com/snekprty", "discord.gg/snekprty", "snekprty.com"];

  it("shows each address as words, with no link to follow", () => {
    component = mount(ContactPanel, { target: document.body, props: { embedded: true } });
    flushSync();
    expect(document.querySelectorAll("a")).toHaveLength(0);
    const shown = STUDIO_LINKS.map((link) => document.querySelector(`[data-testid="social-${link.id}-address"]`)?.textContent?.trim());
    expect(shown).toEqual(addresses);
    for (const link of STUDIO_LINKS) {
      const copy = document.querySelector<HTMLButtonElement>(`[data-testid="social-${link.id}-copy"]`);
      expect(copy, `${link.id} has a Copy button`).not.toBeNull();
      // The button says Copy; the address it copies describes it to a screen reader.
      expect(copy!.textContent).toContain("Copy");
      const described = document.getElementById(copy!.getAttribute("aria-describedby") ?? "");
      expect(described?.dataset.testid).toBe(`social-${link.id}-address`);
    }
  });

  it("copies the whole address when Copy is pressed, and says so", async () => {
    const writes: string[] = [];
    const clipboard = { writeText: async (value: string) => void writes.push(value) };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    try {
      component = mount(ContactPanel, { target: document.body, props: { embedded: true } });
      flushSync();
      const copy = document.querySelector<HTMLButtonElement>('[data-testid="social-discord-copy"]')!;
      copy.click();
      await Promise.resolve();
      await Promise.resolve();
      flushSync();
      expect(writes).toEqual(["https://discord.gg/snekprty"]);
      expect(copy.dataset.copied).toBe("true");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
      Reflect.deleteProperty(window, "isSecureContext");
    }
  });
});
