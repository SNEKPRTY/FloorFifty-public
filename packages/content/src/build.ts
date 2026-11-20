/**
 * Writing the artifact, and the message catalogue derived beside it.
 *
 * The only module that replaces the generated files, and it replaces each
 * atomically: a rename within one directory either happens or does not, so a
 * reader can never observe a half-written file and an interrupted build
 * leaves the previous one intact.
 *
 * A failed compile writes nothing at all, which is what lets the development
 * watcher keep serving the last good content through a broken save.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compile, type CompilerPaths, type CompileResult } from "./compiler";
import { renderContentMessages } from "./messages";

async function writeAtomically(path: string, text: string): Promise<void> {
  // Beside the target rather than in the system temp directory: a rename is
  // only atomic within one filesystem.
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function build(paths: CompilerPaths): Promise<CompileResult> {
  const result = await compile(paths);
  if (!result.ok) return result;

  await writeAtomically(paths.artifactPath, result.canonical.json);
  // The English the translators work from (languages spec §4.2).
  await writeAtomically(paths.messagesPath, renderContentMessages(result.artifact.content).json);

  return result;
}
