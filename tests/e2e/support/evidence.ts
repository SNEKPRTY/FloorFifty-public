import { resolve } from "node:path";

/**
 * Where the evidence specs write their screenshots and recordings:
 * `evidence/<set>` at the repo root, which git ignores.
 *
 * They used to write straight into `docs/art/screenshots/`, so every run left
 * a worktree with dozens of changed PNGs to clean up before every push. The layout under `evidence/` mirrors `docs/art/screenshots/`, and
 * `tools/promote-evidence` copies the shots the owner approves across.
 */
export const EVIDENCE_ROOT = resolve(import.meta.dirname, "../../../evidence");

export const evidenceDir = (set = ""): string => resolve(EVIDENCE_ROOT, set);
