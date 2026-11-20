/**
 * `pnpm release:check [--release] [dirs...]`: the release rules (release
 * readiness §9.1) over the built output and the repository.
 *
 * Scans `apps/client/dist` and `apps/server/dist` by default, or the
 * directories given. Every finding is listed. An error exits 1; a warning
 * does not. `--release` (which `build-release production` passes) turns the
 * placeholder and contact warnings into errors, and refuses an unreviewed
 * string.
 */

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { SECURITY_TXT_CONTACT, SECURITY_TXT_EXPIRES } from "../../apps/server/src/security-txt";
import {
  debugFlagFindings,
  envKeyNames,
  findIcloudDuplicates,
  findSecretShapes,
  placeholderFindings,
  placeholderSongFindings,
  securityTxtFindings,
  type Finding,
} from "./release-check";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
  );
  return nested.flat();
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const release = args.includes("--release");
const dirs = args.filter((arg) => !arg.startsWith("--"));
const targets = dirs.length > 0 ? dirs : ["apps/client/dist", "apps/server/dist"];
const keyNames = envKeyNames(await readFile(".env.example", "utf8"));
const findings: Finding[] = [];
const error = (rule: string, detail: string): void => void findings.push({ rule, detail, severity: "error" });

for (const dir of targets) {
  const files = await walk(dir);
  for (const path of findIcloudDuplicates(files.map((file) => relative(process.cwd(), file)))) {
    error("iCloud duplicate", path);
  }
  const texts = await Promise.all(
    files
      .filter((name) => /\.(?:m?js|json|html|css|map)$/.test(name))
      .map(async (file) => ({ path: relative(process.cwd(), file), text: await readFile(file, "utf8") })),
  );
  for (const { path, text } of texts) {
    for (const label of findSecretShapes(text, keyNames)) error(`secret shape (${label})`, path);
  }
  findings.push(...debugFlagFindings(texts.filter(({ path }) => path.endsWith(".js"))));
}

const sources = await Promise.all(
  ["apps/client/src/features/ruken/studio-links.ts"].map(async (file) => ({
    file,
    text: await readFile(file, "utf8"),
  })),
);
findings.push(...placeholderFindings(sources, release));
findings.push(
  ...placeholderSongFindings(
    JSON.parse(await readFile("packages/asset-contract/assets/art-manifest.json", "utf8")) as Parameters<
      typeof placeholderSongFindings
    >[0],
    release,
  ),
);
findings.push(...securityTxtFindings(SECURITY_TXT_EXPIRES, SECURITY_TXT_CONTACT, new Date(), release));

// Every shipped string has a current review (languages spec §7).
try {
  execFileSync("pnpm", ["--silent", "i18n:check", "--release"], { stdio: "pipe" });
} catch (failure) {
  const output = String((failure as { stdout?: Buffer }).stdout ?? "").trim().split("\n").slice(-3).join(" / ");
  findings.push({ rule: "unreviewed strings", detail: output || "i18n:check --release failed", severity: release ? "error" : "warning" });
}

const errors = findings.filter((finding) => finding.severity === "error");
const warnings = findings.filter((finding) => finding.severity === "warning");
const list = (items: readonly Finding[]): string => items.map(({ rule, detail }) => `  - ${rule}: ${detail}`).join("\n");
if (warnings.length > 0) process.stderr.write(`release check warnings (refused by --release):\n${list(warnings)}\n`);
if (errors.length > 0) {
  process.stderr.write(`release check failed:\n${list(errors)}\n`);
  process.exit(1);
}
process.stdout.write(`release check passed${release ? " for a release" : ""} (${targets.join(", ")})\n`);
