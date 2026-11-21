import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";

/**
 * The client's layer order, lowest first. A file may import from its own
 * feature and from any feature earlier in this list, never from a later one.
 * (`apps/client/src/lib/` is the first layer; `features/<name>/` the rest.)
 */
export const LAYERS: readonly string[] = [
  "lib",
  "i18n",
  "profile",
  "ruken",
  "platform",
  "audio",
  "kit",
  "settings",
  "render",
  "net",
  "screen",
  "race",
  "story",
  "replay",
  "boot",
  "select",
  "lobby",
  "title",
  "results",
  "app",
];

export const SRC = "apps/client/src/";
/** The entry and an ambient type file sit above the layers; the paraglide output is generated and not in git. */
export const OUTSIDE = new Set([`${SRC}main.ts`, `${SRC}pixi-mixins.d.ts`]);

/** The feature a client source file belongs to, or `undefined` for a file outside the layers. */
export function featureOf(path: string): string | undefined {
  if (!path.startsWith(SRC)) return undefined;
  const rel = path.slice(SRC.length);
  if (rel.startsWith("lib/")) return "lib";
  const m = /^features\/([^/]+)\//.exec(rel);
  const name = m?.[1];
  return name !== undefined && LAYERS.includes(name) ? name : undefined;
}

export const sources = execFileSync("git", ["ls-files", "-z", "apps/client/src"], { encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\0")
  .filter((f) => f && existsSync(f));
const sourceSet = new Set(sources);

function codeOf(file: string): string {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".svelte")) return text;
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
}

function resolveRelative(from: string, spec: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const candidate of [base, `${base}.ts`, `${base}.svelte`, `${base}.svelte.ts`, `${base}/index.ts`]) {
    if (sourceSet.has(candidate)) return candidate;
  }
  return undefined;
}

/** Every `a -> b` import between two client source files. */
export function importEdges(): string[] {
  const edges = new Set<string>();
  const spec = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;
  for (const file of sources) {
    if (!/\.(ts|svelte)$/.test(file)) continue;
    for (const m of codeOf(file).matchAll(spec)) {
      const target = resolveRelative(file, m[1]!);
      if (target) edges.add(`${file.slice(SRC.length)} -> ${target.slice(SRC.length)}`);
    }
  }
  return [...edges].sort();
}

export function rank(feature: string): number {
  return LAYERS.indexOf(feature);
}
export function featureOfRel(rel: string): string | undefined {
  return featureOf(SRC + rel);
}
export function isUpward(edge: string): boolean {
  const [a, b] = edge.split(" -> ") as [string, string];
  const fa = featureOfRel(a);
  const fb = featureOfRel(b);
  if (!fa || !fb || fa === fb) return false;
  return rank(fb) > rank(fa);
}
