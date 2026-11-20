/**
 * Where the Socials modal points (spec §3.1.1): the studio's socials and its
 * website, each shown as its icon alone and named for a screen reader.
 */

import * as m from "../../paraglide/messages.js";

/** `icon` is an `IconName` (`features/kit/Icon.svelte`), spelt out because plain `tsc` cannot read a Svelte module's types. */
export type StudioLink = { id: string; label: () => string; icon: "instagram" | "x-logo" | "discord" | "globe"; href: string };

export const STUDIO_LINKS: readonly StudioLink[] = [
  { id: "instagram", label: () => "Instagram", icon: "instagram", href: "https://www.instagram.com/snekprty" },
  { id: "x", label: () => "X", icon: "x-logo", href: "https://x.com/snekprty" },
  { id: "discord", label: () => "Discord", icon: "discord", href: "https://discord.gg/snekprty" },
  { id: "website", label: m.shell_contact_website, icon: "globe", href: "https://snekprty.com" },
];
