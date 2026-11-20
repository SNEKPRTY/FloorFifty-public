/**
 * What a release must not contain (release readiness spec §9.1).
 *
 * - **Placeholders.** Studio links and songs marked placeholder,
 *   and the `.invalid` security contact: warnings on `main`, refused by a
 *   release.
 * - **security.txt** within 30 days of its expiry.
 * - **Debug flags** a production bundle must not read (§6.6).
 *
 * - **iCloud duplicates.** The repository lives on an iCloud-synced Desktop,
 *   which renames a conflicting copy to `name 2.ext` -- `dist/` has shipped
 *   one. A release is built on the rig's clean checkout, and this is the
 *   proof that it was.
 * - **Secrets.** The asset tools' API keys live in `.env.local`. None may
 *   reach a bundle, so the check looks for the names `.env.example` declares
 *   and for the shapes real keys have.
 */

/** A path segment iCloud made: a space, a number, then an extension or the end. */
const ICLOUD_SEGMENT = / \d+(\.[^./]+)?$/;

export function findIcloudDuplicates(paths: readonly string[]): string[] {
  return paths.filter((path) => path.split("/").some((segment) => ICLOUD_SEGMENT.test(segment)));
}

export function envKeyNames(envExample: string): string[] {
  return envExample
    .split("\n")
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined);
}

const SHAPES: readonly { label: string; pattern: RegExp }[] = [
  { label: "sk- key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
];

export function findSecretShapes(text: string, keyNames: readonly string[]): string[] {
  const found = keyNames.filter((name) => text.includes(name));
  for (const { label, pattern } of SHAPES) if (pattern.test(text)) found.push(label);
  return found;
}

/**
 * A finding, with how much it matters. Placeholders and the security
 * contact are allowed on `main` until 7b's release, so they warn there and
 * refuse a release (`--release`); the rest refuse always.
 */
export type Finding = { rule: string; detail: string; severity: "error" | "warning" };

const severity = (release: boolean): Finding["severity"] => (release ? "error" : "warning");

/** Every `placeholder: true` in the studio links, by file and line. */
export function placeholderFindings(sources: readonly { file: string; text: string }[], release: boolean): Finding[] {
  return sources.flatMap(({ file, text }) =>
    text
      .split("\n")
      .flatMap((line, index) =>
        /placeholder:\s*true/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)
          ? [{ rule: "placeholder", detail: `${file}:${index + 1}`, severity: severity(release) }]
          : [],
      ),
  );
}

type ManifestRow = { alias?: string; provenance?: { status?: string } };

/** Every song the art manifest still marks placeholder. Art is not checked: amendment 16 ships it as it is. */
export function placeholderSongFindings(manifest: { bundles: Record<string, readonly ManifestRow[]> }, release: boolean): Finding[] {
  return Object.values(manifest.bundles)
    .flat()
    .filter((row) => row.alias?.startsWith("music.") === true && row.provenance?.status === "placeholder")
    .map((row) => ({ rule: "placeholder song", detail: row.alias!, severity: severity(release) }));
}

const SECURITY_TXT_NOTICE_MS = 30 * 24 * 60 * 60 * 1000;

/** `security.txt` must name a real contact and not expire within 30 days (§7.4). */
export function securityTxtFindings(expires: string, contact: string, now: Date, release: boolean): Finding[] {
  const findings: Finding[] = [];
  const at = Date.parse(expires);
  if (Number.isNaN(at) || at - now.getTime() < SECURITY_TXT_NOTICE_MS) {
    findings.push({ rule: "security.txt", detail: `expires ${expires}, within 30 days`, severity: "error" });
  }
  if (/\.invalid\b/.test(contact)) {
    findings.push({ rule: "security.txt", detail: `placeholder contact ${contact}`, severity: severity(release) });
  }
  return findings;
}

/**
 * The query flags a production bundle must not read (§6.6, D-G8). Only the
 * distinctive names: `lcd` and `refraction` are ordinary words in the
 * renderer, and their gates are pinned by the client's own tests.
 */
const DEBUG_FLAGS = ["netstats", "padtrace", "refraction-probe"] as const;

export function debugFlagFindings(files: readonly { path: string; text: string }[]): Finding[] {
  return files.flatMap(({ path, text }) =>
    DEBUG_FLAGS.filter((flag) => text.includes(flag)).map((flag) => ({
      rule: "debug flag",
      detail: `${flag} in ${path}`,
      severity: "error" as const,
    })),
  );
}
