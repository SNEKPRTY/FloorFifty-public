// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOGO_SIZE, LOGO_URL } from "../../../../apps/client/src/features/kit/brand";

describe("the studio's logo in the client", () => {
  it("is addressed under /assets/, from the file the manifest declares", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "packages/asset-contract/assets/art-manifest.json"), "utf8")) as {
      bundles: { shell: { alias: string; file: string; width?: number; height?: number }[] };
    };
    const row = manifest.bundles.shell.find((asset) => asset.alias === "brand.snekprtyLogo")!;
    expect(LOGO_URL.endsWith(`assets/${row.file}`)).toBe(true);
    expect(LOGO_SIZE).toEqual({ width: row.width, height: row.height });
  });
});
