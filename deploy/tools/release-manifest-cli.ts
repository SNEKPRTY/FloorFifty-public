/** Writes `<dir>/release.json`. Usage: release-manifest-cli <dir> <buildId> <environment> <commit> */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildManifest } from "./release-manifest";

const [dir, buildId, environment, commit] = process.argv.slice(2).filter((arg) => arg !== "--");
if (dir === undefined || buildId === undefined || environment === undefined || commit === undefined) {
  process.stderr.write("usage: release-manifest-cli <dir> <buildId> <environment> <commit>\n");
  process.exit(2);
}
const manifest = await buildManifest(dir, { buildId, environment, commit });
await writeFile(join(dir, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
