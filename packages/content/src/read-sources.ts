/**
 * Reading the authored tree.
 *
 * The only pass that touches the filesystem. It decides which files are
 * sources and what an author will see them called; it decides nothing about
 * what is in them.
 *
 * Every file is labelled `content/...` regardless of where the tree actually
 * sits, because that is the path an author has open. A fixture tree therefore
 * produces exactly the diagnostics the real tree would.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RawSourceTree, SourceFile } from "./types";

/** The files an authored tree cannot be missing. */
const REQUIRED_FILES = {
  tuning: "tuning.toml",
  flow: "flow.toml",
  eventRouting: "events.toml",
  catalog: "catalog.toml",
  prompts: "prompts.toml",
  unlocks: "unlocks.toml",
  blockedNames: "blocked-names.toml",
  juice: "juice.toml",
} as const;

/** Raised when the tree is not an authored tree at all. */
export class MissingSourceError extends Error {
  constructor(readonly file: string) {
    super(`missing required source file: ${file}`);
    this.name = "MissingSourceError";
  }
}

const isSource = (name: string): boolean =>
  name.endsWith(".toml") && !name.endsWith(".toml.example");

async function readRequired(sourceRoot: string, relative: string): Promise<SourceFile> {
  try {
    return { file: `content/${relative}`, text: await readFile(join(sourceRoot, relative), "utf8") };
  } catch {
    throw new MissingSourceError(`content/${relative}`);
  }
}

/**
 * Every item file in one directory.
 *
 * An absent directory is empty rather than an error: `content/songs/` holds
 * only a `.gitkeep` today, and a tree that has not grown one yet is still a
 * valid tree.
 */
async function readItems(sourceRoot: string, directory: string): Promise<SourceFile[]> {
  let names: string[];
  try {
    names = await readdir(join(sourceRoot, directory));
  } catch {
    return [];
  }

  return Promise.all(
    names
      .filter(isSource)
      .sort()
      .map(async (name) => ({
        file: `content/${directory}/${name}`,
        text: await readFile(join(sourceRoot, directory, name), "utf8"),
      })),
  );
}

export async function readSources(sourceRoot: string): Promise<RawSourceTree> {
  // Written out rather than mapped over a directory list: a tuple keeps each
  // result's type, and the required names are already part of the tree's shape.
  const [tuning, flow, eventRouting, catalog, prompts, unlocks, blockedNames, juice, characters, stages, songs, modes] =
    await Promise.all([
      readRequired(sourceRoot, REQUIRED_FILES.tuning),
      readRequired(sourceRoot, REQUIRED_FILES.flow),
      readRequired(sourceRoot, REQUIRED_FILES.eventRouting),
      readRequired(sourceRoot, REQUIRED_FILES.catalog),
      readRequired(sourceRoot, REQUIRED_FILES.prompts),
      readRequired(sourceRoot, REQUIRED_FILES.unlocks),
      readRequired(sourceRoot, REQUIRED_FILES.blockedNames),
      readRequired(sourceRoot, REQUIRED_FILES.juice),
      readItems(sourceRoot, "characters"),
      readItems(sourceRoot, "stages"),
      readItems(sourceRoot, "songs"),
      readItems(sourceRoot, "modes"),
    ]);

  return { tuning, flow, eventRouting, catalog, prompts, unlocks, blockedNames, juice, characters, stages, songs, modes };
}
