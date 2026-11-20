import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECURITY_TXT_CONTACT, SECURITY_TXT_EXPIRES } from "../../apps/server/src/security-txt";
import {
  debugFlagFindings,
  envKeyNames,
  findIcloudDuplicates,
  findSecretShapes,
  placeholderFindings,
  placeholderSongFindings,
  securityTxtFindings,
} from "../../deploy/tools/release-check";

describe("iCloud duplicates", () => {
  it("finds a file or folder iCloud renamed with a trailing number", () => {
    expect(
      findIcloudDuplicates([
        "apps/client/dist/build/index-BpeN1JUv 2.css",
        "apps/client/dist/assets/production 2/city.png",
        "apps/client/dist/assets/manifest 2.json",
      ]),
    ).toEqual([
      "apps/client/dist/build/index-BpeN1JUv 2.css",
      "apps/client/dist/assets/production 2/city.png",
      "apps/client/dist/assets/manifest 2.json",
    ]);
  });

  it("passes names whose digits are not iCloud's", () => {
    expect(
      findIcloudDuplicates(["dist/assets/floor2.png", "dist/assets/level-2.png", "dist/build/index-2abc.js", "dist/a b.png"]),
    ).toEqual([]);
  });
});

describe("secret shapes", () => {
  it("reads the key names .env.example declares", () => {
    expect(envKeyNames("# comment\n\nPIXELLAB_API_KEY=\nOPENAI_API_KEY=\n")).toEqual(["PIXELLAB_API_KEY", "OPENAI_API_KEY"]);
  });

  it("finds a declared key name, an OpenAI-style key and an AWS key", () => {
    const bundle = 'const a="OPENAI_API_KEY";const b="sk-abcdefghijklmnopqrstuvwxyz0123";const c="AKIAABCDEFGHIJKLMNOP";';
    expect(findSecretShapes(bundle, ["OPENAI_API_KEY"])).toEqual(["OPENAI_API_KEY", "sk- key", "AWS access key"]);
  });

  it("passes an ordinary bundle", () => {
    expect(findSecretShapes('const sky="sk-blue";', ["OPENAI_API_KEY"])).toEqual([]);
  });
});

describe("placeholders (release readiness §9.1)", () => {
  const sources = [
    { file: "studio-links.ts", text: '  { label: m.a, href: "mailto:hello@example.com", placeholder: true },\n  { label: m.b, href: "https://x.test", placeholder: false },' },
  ];

  it("warns of a placeholder link or credit on main, and refuses it in a release", () => {
    expect(placeholderFindings(sources, false)).toEqual([
      { rule: "placeholder", detail: "studio-links.ts:1", severity: "warning" },
    ]);
    expect(placeholderFindings(sources, true)[0]?.severity).toBe("error");
  });

  it("ignores a comment that talks about placeholders", () => {
    const commented = [
      { file: "credits.ts", text: "/**\n * phase 7's gate refuses to ship while any `placeholder: true` remains.\n */\n// placeholder: true\n" },
    ];
    expect(placeholderFindings(commented, true)).toEqual([]);
  });

  it("finds a song still marked placeholder, and ignores art (amendment 16)", () => {
    const manifest = {
      bundles: {
        "song-theme": [{ alias: "music.theme", provenance: { status: "placeholder" } }],
        menu: [{ alias: "menu.cityFar", provenance: { status: "placeholder" } }],
      },
    };
    expect(placeholderSongFindings(manifest, true)).toEqual([
      { rule: "placeholder song", detail: "music.theme", severity: "error" },
    ]);
  });
});

describe("security.txt (release readiness §7.4)", () => {
  const now = new Date("2026-11-01T00:00:00Z");

  it("refuses one that expires within 30 days", () => {
    expect(securityTxtFindings("2026-11-20T00:00:00Z", "mailto:a@b.test", now, true)).toHaveLength(1);
  });

  it("refuses the placeholder contact in a release, and warns of it on main", () => {
    expect(securityTxtFindings("2027-11-01T00:00:00Z", "mailto:security@floorfifty.invalid", now, true)[0]?.severity).toBe(
      "error",
    );
    expect(securityTxtFindings("2027-11-01T00:00:00Z", "mailto:security@floorfifty.invalid", now, false)[0]?.severity).toBe(
      "warning",
    );
  });

  it("passes the shipped contact, a Discord link, in a release", () => {
    expect(SECURITY_TXT_CONTACT).toBe("https://discord.gg/6Xt2cCjqMs");
    expect(securityTxtFindings(SECURITY_TXT_EXPIRES, SECURITY_TXT_CONTACT, new Date("2026-11-14T00:00:00Z"), true)).toEqual(
      [],
    );
  });

  it("passes a real contact a year out", () => {
    expect(securityTxtFindings("2027-11-01T00:00:00Z", "mailto:a@b.test", now, true)).toEqual([]);
  });
});

describe("debug flags in a bundle (release readiness §6.6)", () => {
  it("finds a flag name", () => {
    expect(debugFlagFindings([{ path: "build/x.js", text: 'has("netstats")' }])).toEqual([
      { rule: "debug flag", detail: "netstats in build/x.js", severity: "error" },
    ]);
  });

  it("does not flag ordinary words that contain a flag's stem", () => {
    expect(debugFlagFindings([{ path: "build/x.js", text: "refraction lcdPanel" }])).toEqual([]);
  });
});

describe("the release check's own inputs", () => {
  it("reads only source files that exist", () => {
    const cli = readFileSync("deploy/tools/release-check-cli.ts", "utf8");
    const files = [...cli.matchAll(/"((?:apps|packages)\/[^"]+\.(?:ts|json))"/g)].map((match) => match[1]!);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(existsSync(file), `${file} is read by the release check but is missing`).toBe(true);
  });
});
