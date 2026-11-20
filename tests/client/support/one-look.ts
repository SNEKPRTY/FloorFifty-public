/**
 * What the one-look guard reads (`features/kit/one-look.test.ts`): which client files, outside the
 * kit, still draw a panel, a button or an arrive/leave by hand. Source text with its comments
 * stripped, like `glass-surfaces.test.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clientSourceFiles } from "./client-source";

const ROOT = resolve(import.meta.dirname, "../../..");

export type Rule = "panel" | "button" | "glass" | "rawButton" | "motion";

/** Source with block, HTML and whole-line comments removed (a `//` inside a URL string is left alone). */
export function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** `<style>` blocks, so a selector that hooks a class is not read as writing it. */
const withoutStyles = (source: string): string => source.replace(/<style[\s\S]*?<\/style>/g, "");

/** The feature a client file belongs to, or `undefined` for `lib/` and the like. */
export function featureOf(file: string): string | undefined {
  return /^apps\/client\/src\/features\/([^/]+)\//.exec(file)?.[1];
}

/** Every opening `<button …>` tag in markup, read to its own `>` (not one inside `{…}`). */
function buttonTags(markup: string): string[] {
  const tags: string[] = [];
  for (let at = markup.indexOf("<button"); at >= 0; at = markup.indexOf("<button", at + 1)) {
    let depth = 0;
    let end = at;
    for (; end < markup.length; end += 1) {
      const char = markup[end];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(markup.slice(at, end + 1));
  }
  return tags;
}

/** The rules a file outside the kit breaks. */
export const ruleBreaks = (file: string): Rule[] => ruleBreaksIn(readFileSync(resolve(ROOT, file), "utf8"), file);

/** The same, for source text: `file` only says whether it is a Svelte component. */
export function ruleBreaksIn(raw: string, file: string): Rule[] {
  const source = stripComments(raw);
  const markup = withoutStyles(source);
  const broken: Rule[] = [];
  // Written as a class, not hooked by a `.selector`.
  if (/(?<![.\w-])ff-(?:aquarian-panel|aq-hud)(?![\w-])/.test(markup)) broken.push("panel");
  if (/(?<![.\w-])ff-aq-control(?:--[a-z]+)?(?![\w])/.test(markup)) broken.push("button");
  if (/backdrop-filter\s*[:=]|style:(?:-webkit-)?backdrop-filter|backdropFilter|background[^;{}]*--ff-panel-(?:fill|opacity)/.test(source)) broken.push("glass");
  if (file.endsWith(".svelte") && buttonTags(markup).some((tag) => !/data-motion="none"/.test(tag))) broken.push("rawButton");
  if (file.endsWith(".svelte") && /\b(?:use|in|out|transition):(?:riseIn|fadeIn|fadeOut|surfaceOut|pageIn|pageOut)\b/.test(markup)) {
    broken.push("motion");
  }
  return broken;
}

/** Client source files outside the kit that the guard reads. */
export function nonKitFiles(): string[] {
  return clientSourceFiles().filter(
    (file) => /\.(svelte|ts|css)$/.test(file) && !file.includes("/features/kit/") && !file.includes("/paraglide/"),
  );
}

export const KIT_FOLDER = "apps/client/src/features/kit/";
export { ROOT };
