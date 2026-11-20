import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  ArtManifestError,
  REQUIRED_CHARACTER_ANIMATIONS,
  allAssets,
  expectedFileSize,
  isAudioAsset,
  isVisualAsset,
  parseArtManifest,
  type ArtManifest,
} from "@floor-fifty/asset-contract/manifest-schema";
import { DEFAULT_MAX_GRAIN, measureGrain } from "@floor-fifty/asset-contract/pixel-grain";
import { ROLES } from "@floor-fifty/asset-contract/roles";
import { validateAssets } from "@floor-fifty/asset-contract/validate-assets";

const ASSET_ROOT = resolve(process.cwd(), "packages/asset-contract/assets");

const loadManifest = (): unknown =>
  JSON.parse(readFileSync(resolve(ASSET_ROOT, "art-manifest.json"), "utf8"));

/**
 * Aliases the client draws.
 *
 * Most are addressed by name through the Pixi asset manager. `menu.backdrop`
 * is drawn by the Svelte chrome instead, which reaches it as a CSS `url()` on
 * the file rather than as an alias -- so the contract still owns it, and
 * `isAddressed` has to look for the file as well, spelt out or passed to
 * `productionArt`.
 *
 * `menu.titlePlate` was the second CSS-addressed plate until the Aquarian pass
 * replaced the pixel panel with a CSS surface; with nothing slicing it, it was
 * retired rather than left downloaded and validated for no one.
 */
const REQUIRED_ALIASES = [
  "world.sun",
  "world.clouds",
  "world.cityFar",
  "world.cityNear",
  "world.lanterns",
  "world.platform",
  "ninja.scarlet",
  "ninja.cyan",
  "ninja.gold",
  "ninja.violet",
  "portrait.scarlet",
  "portrait.cyan",
  "portrait.gold",
  "portrait.violet",
  "menu.backdrop",
  // Reached through the stage's authored song rather than from client source.
  "music.chromeInTheRain",
  "music.mainMenu",
  "splash.art",
];

/**
 * Every line of client source, for checking which assets are really drawn.
 *
 * `.svelte` and `.css` count as much as `.ts`. Half the chrome moved into
 * components during Resurrect Arcade, and a scan that reads only TypeScript
 * would report the menu plate and the menu backdrop as unused while they are
 * on screen -- which is worse than not checking, because it is a false alarm
 * that trains a reader to skip the rule.
 */
const SOURCE_EXTENSIONS = [".ts", ".svelte", ".css"];

function clientSourceText(): string {
  const root = resolve(process.cwd(), "apps/client/src");
  const read = (dir: string): string =>
    readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) return read(path);
        return SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
          ? readFileSync(path, "utf8")
          : "";
      })
      .join("\n");
  return read(root);
}

/**
 * Everything authored content names.
 *
 * The generated artifact is the other place an alias can be spelled. A stage
 * points at its platform and backdrop, a character at its sheet and portrait,
 * and a song at its track -- none of which appear in client source, because
 * choosing among code-owned capabilities is exactly what authored content is
 * for.
 */
const generatedContentText = (): string =>
  readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8");

/**
 * Whether the game reaches `asset`.
 *
 * Four ways it can. By alias, which is how everything Pixi loads is reached.
 * By a template over a group -- `ninja.${scarf}` picks one of four sheets, so a
 * literal match is not the only way an alias is used. By file, which is how
 * CSS reaches the two menu plates: `url("/assets/production/menu-backdrop.png")`
 * names no alias at all. By a template over a file group --
 * `portrait-${scarf}${suffix}.png` picks one of twelve portraits by seat and
 * mood, the way `ninja.${scarf}` picks a sheet. Or by authored content, which is how the stage loop is
 * reached: nothing in the client hard-codes `music.chromeInTheRain`, because a
 * later stage is meant to be able to name a different track without a rebuild.
 * Or as a variant of an alias content names: a song names its cover once, and
 * the 640 px cover is that alias plus `Large`, the 1200 px one plus `Full`; its preview clip is its
 * `audioAlias` plus `Preview`.
 */
const DERIVED_SUFFIX = /(Large|Full|Preview)$/;
const isAddressed = (asset: { alias: string; file: string }, source: string): boolean =>
  source.includes(asset.alias) ||
  source.includes(`${asset.alias.split(".")[0]}.\${`) ||
  source.includes(asset.file) ||
  // The chrome reaches a production file through `productionArt`, at the site's base.
  (asset.file.startsWith("production/") && source.includes(`productionArt("${asset.file.slice("production/".length)}")`)) ||
  source.includes(`${asset.file.split("-")[0]}-\${`) ||
  (DERIVED_SUFFIX.test(asset.alias) && source.includes(`"${asset.alias.replace(DERIVED_SUFFIX, "")}"`));

const ninjaWithout = (animation: string): unknown => {
  const manifest = loadManifest() as ArtManifest;
  const ninja = manifest.bundles.shell.find((asset) => asset.alias === "ninja.scarlet");
  if (ninja !== undefined && "animations" in ninja) delete ninja.animations[animation];
  return manifest;
};

describe("the art manifest", () => {
  it("parses the committed manifest", () => {
    expect(() => parseArtManifest(loadManifest())).not.toThrow();
  });

  it("declares every alias the renderer addresses", () => {
    const manifest = parseArtManifest(loadManifest());
    const aliases = allAssets(manifest).map((entry) => entry.asset.alias);
    for (const alias of REQUIRED_ALIASES) expect(aliases).toContain(alias);
  });

  it("declares no asset the renderer never addresses", () => {
    // An asset nobody draws is still downloaded, still validated, and still
    // reviewed as though it were in the game. The contract should describe what
    // the game actually uses.
    //
    // Parked through Resurrect Arcade while the chrome Task 5 drew waited for
    // the Svelte shell and the rebuilt HUD to address it. Both landed, the
    // glyph page that nothing ever drew was retired, and the scan learned to
    // read components -- so the rule is enforced again.
    const manifest = parseArtManifest(loadManifest());
    const source = `${clientSourceText()}\n${generatedContentText()}`;
    const unused = allAssets(manifest)
      .map((entry) => entry.asset)
      .filter((asset) => !isAddressed(asset, source))
      .map((asset) => asset.alias);

    expect(unused).toEqual([]);
  });

  it("does not claim a licence from a tool that did not make the asset", () => {
    // Provenance is the one thing the validator exists to guarantee, so a
    // licence line that names PixelLab on art drawn in this repository is worse
    // than no licence line at all: it is a rights claim about work the named
    // tool never touched.
    const manifest = parseArtManifest(loadManifest());
    const misattributed = allAssets(manifest)
      .map((entry) => entry.asset)
      .filter(
        (asset) =>
          !asset.provenance.tool.includes("pixellab") &&
          asset.provenance.license.toLowerCase().includes("pixellab"),
      )
      .map((asset) => asset.alias);

    expect(misattributed).toEqual([]);
  });

  it("records reviewed generated sources for both Aquarian scenery plates", () => {
    const manifest = parseArtManifest(loadManifest());
    for (const alias of ["world.cityMid", "world.rooftopDetails"]) {
      const asset = allAssets(manifest).find((entry) => entry.asset.alias === alias)?.asset;
      expect(asset?.provenance.prompt).not.toMatch(/placeholder/i);
      expect(asset?.provenance.source).toMatch(/generated imagery/i);
    }
  });

  it("rejects an animated ninja without its landing frames", () => {
    expect(() => parseArtManifest(ninjaWithout("land"))).toThrow(/land/);
  });

  it("requires every character animation the brief names", () => {
    for (const animation of REQUIRED_CHARACTER_ANIMATIONS) {
      expect(() => parseArtManifest(ninjaWithout(animation))).toThrow(ArtManifestError);
    }
  });

  it("rejects a duplicate alias", () => {
    const manifest = loadManifest() as ArtManifest;
    manifest.bundles.gameplay.push(manifest.bundles.gameplay[0]!);
    expect(() => parseArtManifest(manifest)).toThrow(/duplicate/);
  });

  it("rejects a palette role that is not in the contract", () => {
    const manifest = loadManifest() as ArtManifest;
    const first = manifest.bundles.gameplay[0]!;
    if (isVisualAsset(first)) first.paletteRoles = ["chartreuse"] as never;
    expect(() => parseArtManifest(manifest)).toThrow();
  });

  it("keeps every declared loop region inside the audio it belongs to", () => {
    // The one property of a loop a reader cannot check by listening. Only the
    // music declares one -- each song, its preview clip, the menu's and the
    // tutorial's -- and the ambient beds under the menu, the tutorial
    // and each race stage: a landing or a countdown is a one-shot, and a region it
    // never repeats would be a fact the manifest asserts and nothing honours,
    // so those carry none at all. Songs live in their own bundles, so this
    // reads every bundle.
    const audio = allAssets(parseArtManifest(loadManifest()))
      .map((entry) => entry.asset)
      .filter(isAudioAsset);
    const looping = audio.filter((track) => track.loopStartMs !== undefined);

    expect(audio.length).toBeGreaterThan(1);
    expect(looping.map((track) => track.alias).sort()).toEqual(
      audio
        .filter((track) => /^(music|ambience)\./.test(track.alias))
        .map((track) => track.alias)
        .sort(),
    );
    expect(looping.map((track) => track.alias)).toEqual(
      expect.arrayContaining([
        "ambience.dawn",
        "ambience.menu",
        "ambience.rooftop",
        "ambience.snowShrine",
        "ambience.sunkenDome",
        "music.chromeInTheRain",
        "music.mainMenu",
        "music.tutorial",
      ]),
    );
    for (const track of looping) {
      expect(track.loopStartMs!).toBeLessThan(track.loopEndMs!);
      expect(track.loopEndMs!).toBeLessThanOrEqual(track.durationMs);
    }
  });

  it("gives every cue a duration and a measured loudness", () => {
    // The mix is judged by ear, and these are what make "quieter than the
    // music" a measurement rather than an opinion when it is.
    for (const track of allAssets(parseArtManifest(loadManifest())).map((entry) => entry.asset).filter(isAudioAsset)) {
      expect(track.durationMs).toBeGreaterThan(0);
      expect(track.loudnessLufs).toBeLessThan(0);
    }
  });

  it("rejects a stage loop that ends past the end of its file", () => {
    const manifest = loadManifest() as ArtManifest;
    const track = manifest.bundles.audio.find(
      (asset) => "loopStartMs" in asset && asset.loopStartMs !== undefined,
    );
    if (track !== undefined && "durationMs" in track) track.loopEndMs = track.durationMs + 1;

    expect(() => parseArtManifest(manifest)).toThrow();
  });

  it("derives sheet dimensions from frames and animation rows", () => {
    const manifest = parseArtManifest(loadManifest());
    const ninja = manifest.bundles.shell
      .filter(isVisualAsset)
      .find((asset) => asset.alias === "ninja.scarlet")!;
    // Four run frames across, seven animation rows down.
    expect(expectedFileSize(ninja)).toEqual({ width: 32 * 4, height: 32 * 7 });
  });
});

describe("asset validation", () => {
  it("accepts the approved asset set", () => {
    const result = validateAssets(ASSET_ROOT, parseArtManifest(loadManifest()));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    // Every asset, not only the ones the renderer names: the cue set is
    // addressed through race events rather than by an alias in a component.
    expect(result.checked).toBe(allAssets(parseArtManifest(loadManifest())).length);
  });

  it("rejects a player sheet whose source metadata is absent", () => {
    const manifest = parseArtManifest(loadManifest());
    const ninja = manifest.bundles.shell.find((asset) => asset.alias === "ninja.scarlet")!;
    delete (ninja.provenance as Partial<typeof ninja.provenance>).source;

    const result = validateAssets(ASSET_ROOT, manifest);
    expect(result).toMatchObject({ ok: false });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ alias: "ninja.scarlet", problem: expect.stringContaining("source") }),
    );
  });

  it("reports the alias with expected and actual dimensions on a size mismatch", () => {
    const manifest = parseArtManifest(loadManifest());
    const sun = manifest.bundles["stage-rooftops"]!
      .filter(isVisualAsset)
      .find((asset) => asset.alias === "world.sun")!;
    sun.width = 257;

    const result = validateAssets(ASSET_ROOT, manifest);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      alias: "world.sun",
      problem: expect.stringContaining("expected 257x256, found 256x256"),
    });
  });

  it("reports a missing file by alias rather than throwing", () => {
    const manifest = parseArtManifest(loadManifest());
    manifest.bundles.gameplay[0]!.file = "production/not-exported.png";

    const result = validateAssets(ASSET_ROOT, manifest);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.alias).toBe(manifest.bundles.gameplay[0]!.alias);
  });

  it("rejects a sprite exported onto an opaque background", () => {
    // Every shipped asset is a cut-out sprite now that the opaque sky plate is
    // retired, so the opaque export this rule exists to catch is written here
    // rather than borrowed from the set.
    const directory = mkdtempSync(resolve(tmpdir(), "ff-opaque-"));
    const opaque = new PNG({ width: 256, height: 256 });
    for (let index = 0; index < opaque.data.length; index += 4) {
      opaque.data[index] = 0x2e;
      opaque.data[index + 1] = 0x22;
      opaque.data[index + 2] = 0x2f;
      opaque.data[index + 3] = 255;
    }
    writeFileSync(resolve(directory, "opaque.png"), PNG.sync.write(opaque));

    const manifest = parseArtManifest(loadManifest());
    const sun = manifest.bundles["stage-rooftops"]!.find((asset) => asset.alias === "world.sun")!;
    sun.file = "opaque.png";

    const result = validateAssets(directory, manifest);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ alias: "world.sun", problem: expect.stringContaining("transparent") }),
    );
  });
});

describe("the palette", () => {
  it("binds every role the brief documents to a swatch of the canonical palette", () => {
    for (const index of Object.values(ROLES)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(64);
    }
  });
});

describe("the pixel grain budget", () => {
  // The simplification passes are something a generator script calls, so an
  // asset added later that never calls them would ship grainy with nothing to
  // say so. These are the checks that make that impossible rather than
  // unlikely.
  const manifest = parseArtManifest(loadManifest());
  const visual = allAssets(manifest)
    .map((entry) => entry.asset)
    .filter(isVisualAsset);

  const grainOf = (file: string): number =>
    measureGrain(PNG.sync.read(readFileSync(resolve(ASSET_ROOT, file)))).grain;

  it("accepts the shipped set, so every asset is inside its own budget", () => {
    expect(validateAssets(ASSET_ROOT, manifest).issues).toEqual([]);
  });

  it("rejects an asset that skipped the passes and declares no budget", () => {
    const grainy = loadManifest() as ArtManifest;
    const sheet = grainy.bundles.shell.find((asset) => asset.alias === "ninja.scarlet");
    if (sheet !== undefined && isVisualAsset(sheet)) delete sheet.maxGrain;

    const issues = validateAssets(ASSET_ROOT, grainy).issues;
    expect(issues.some((issue) => issue.problem.includes("2x2 block"))).toBe(true);
  });

  it("keeps every declared budget near what the asset actually needs", () => {
    // A budget is an exemption, not a mute button. Set to one it would silence
    // the check as thoroughly as never running it, so each is held close to the
    // grain it was written for -- and an asset that drifts grainier has to be
    // looked at again rather than absorbed by headroom nobody is watching.
    for (const asset of visual) {
      if (asset.maxGrain === undefined) continue;
      const measured = grainOf(asset.file);
      expect(asset.maxGrain.budget, `${asset.alias} budget is below its own grain`)
        .toBeGreaterThanOrEqual(measured);
      expect(asset.maxGrain.budget, `${asset.alias} budget is padded far above its grain`)
        .toBeLessThan(measured * 1.5 + 0.02);
    }
  });

  it("will not let a budget be raised without a reason", () => {
    const silent = loadManifest() as ArtManifest;
    const sheet = silent.bundles.shell.find((asset) => asset.alias === "ninja.scarlet");
    if (sheet !== undefined && isVisualAsset(sheet)) {
      sheet.maxGrain = { budget: 1 } as never;
    }
    expect(() => parseArtManifest(silent)).toThrow();

    const terse = loadManifest() as ArtManifest;
    const other = terse.bundles.shell.find((asset) => asset.alias === "ninja.cyan");
    if (other !== undefined && isVisualAsset(other)) {
      other.maxGrain = { budget: 1, because: "looks fine" };
    }
    expect(() => parseArtManifest(terse)).toThrow();
  });

  it("holds the converted plates to the default, which is near zero", () => {
    // The evidence that the passes work at all: everything they run over
    // declares no budget and measures under it.
    for (const alias of ["world.cityNear", "world.cityFar", "world.platform"]) {
      const asset = visual.find((candidate) => candidate.alias === alias)!;
      expect(asset.maxGrain, `${alias} should need no exemption`).toBeUndefined();
      expect(grainOf(asset.file)).toBeLessThan(DEFAULT_MAX_GRAIN);
    }
  });
});

describe("placeholder art", () => {
  it("flags the rooftop props as a placeholder for the hand-authored pass", () => {
    const manifest = loadManifest() as ArtManifest;
    const props = manifest.bundles["stage-rooftops"]!.find((asset) => asset.alias === "world.rooftopProps");
    expect(props, "world.rooftopProps is not in Rooftops' bundle").toBeDefined();
    expect(props!.provenance.status).toBe("placeholder");
  });
});

describe("the portrait set", () => {
  it("gives every seat a 64 x 64 portrait in three moods, all placeholders", () => {
    const manifest = loadManifest() as ArtManifest;
    const rows = manifest.bundles.shell.filter((asset) => asset.alias.startsWith("portrait."));
    for (const seat of ["scarlet", "cyan", "gold", "violet"]) {
      for (const alias of [`portrait.${seat}`, `portrait.${seat}Win`, `portrait.${seat}Lose`]) {
        const row = rows.find((asset) => asset.alias === alias);
        expect(row, alias).toBeDefined();
        expect(row && "width" in row ? [row.width, row.height] : undefined, alias).toEqual([64, 64]);
        expect(row!.provenance.status, alias).toBe("placeholder");
      }
    }
  });
});
