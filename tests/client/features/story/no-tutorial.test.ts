import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Story spec, "What stays" and criterion 2: the tutorial is gone, and the word is left only where a stored key, a
// song, a tuning name or an analytics name still carries it.
const root = join(__dirname, "../../../..");
const ALLOWED = [
  /dawn-tutorial/g, // the Dawn stage's song (chapter 1)
  /tutorial\.m4a/g,
  /TUTORIAL_EDGE_[A-Z_]+/g, // the lava's tuning
  /level\/tutorial/g, // the file the story's script lives in
  /\bseen\.tutorial\b|\btutorial: (?:boolean|true|false)/g, // the stored "has been shown how" key
  /tutorial_(?:completed|skipped)/g, // Ruken analytics names, so the host's numbers stay one series
  /["']tutorial["']/g, // `race_started`'s mode, and the stored key's name
  /tutorial_the_button/g, // read by the race hints
  /tutorial: flag\(/g,
  /music\.tutorial/g, // the song's audio alias
  /Tutorial\.(?:wav|mp3)/g, // the song's provenance: the supplied file names
];

function files(dir: string, skip: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (skip(path)) return [];
    return statSync(path).isDirectory() ? files(path, skip) : [path];
  });
}

describe("the tutorial is gone", () => {
  it("has no content/tutorial.toml", () => {
    expect(existsSync(join(root, "content/tutorial.toml"))).toBe(false);
  });

  it("leaves the word only where the story's allow-list keeps it", () => {
    const skip = (path: string) => /node_modules|\/generated|\/paraglide|\/public\/|\.(png|webp|m4a|woff2|ico|svg)$/.test(path);
    const dirs = ["apps/client/src", "content", ...readdirSync(join(root, "packages")).map((name) => `packages/${name}/src`)];
    const found: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(join(root, dir))) continue;
      for (const path of files(join(root, dir), skip)) {
        const text = readFileSync(path, "utf8");
        text.split("\n").forEach((line, index) => {
          const left = ALLOWED.reduce((rest, pattern) => rest.replace(pattern, ""), line);
          if (/tutorial/i.test(left)) found.push(`${path.slice(root.length + 1)}:${index + 1}: ${line.trim()}`);
        });
      }
    }
    expect(found).toEqual([]);
  });
});
