import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Finds client source by its file name, so a test that reads a component or a
 * style sheet does not say which feature folder holds it. A name two files
 * share is an error: name it with its folder (`layout/PagerDots.svelte`).
 */
const ROOT = resolve(import.meta.dirname, "../../..");
export const CLIENT_SRC = join(ROOT, "apps/client/src");

let cache: string[] | undefined;

/** Every client source file as a repository path, the generated Paraglide output left out. */
export function clientSourceFiles(): string[] {
  cache ??= (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "paraglide" ? [] : walk(path);
      return [relative(ROOT, path)];
    });
  })(CLIENT_SRC);
  return cache;
}

/** The repository path of the one client file called `name`, or `folder/name` for a name two files share. */
export function clientFile(name: string): string {
  const wanted = name.replace(/^(\.\.\/)+/, "");
  const hits = clientSourceFiles().filter((file) => file.endsWith(`/${wanted}`));
  const exact = hits;
  if (exact.length !== 1) throw new Error(`${exact.length} client files match "${name}": ${exact.join(", ")}`);
  return exact[0]!;
}

export function readClient(name: string): string {
  return readFileSync(join(ROOT, clientFile(name)), "utf8");
}

/** Every Svelte component but the layout pieces: what `ui/components/` held before the feature folders. */
export function clientComponents(): string[] {
  return clientSourceFiles().filter((file) => file.endsWith(".svelte") && !file.includes("/kit/layout/"));
}
