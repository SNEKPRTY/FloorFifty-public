import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./support/stubs";

const read = (path: string): string => readFileSync(join(REPO, path), "utf8");
const caddyfile = read("deploy/caddy/Caddyfile");
const headers = read("deploy/caddy/security-headers.caddy");

/** The staging client's site block, from its address to the closing brace at the start of a line. */
const clientSite = /staging\.\{\$FF_DOMAIN\} \{([\s\S]*?)\n\}/.exec(caddyfile)?.[1] ?? "";

describe("the staging client's headers (release readiness §6.3)", () => {
  it("imports the security headers", () => {
    expect(clientSite).toContain("import security-headers.caddy");
  });

  it("sets a CSP that talks only to its own API and allows no eval or framing", () => {
    const csp = /Content-Security-Policy "([^"]+)"/.exec(headers)?.[1] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self' https://staging-api.{$FF_DOMAIN} wss://staging-api.{$FF_DOMAIN}");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it.each([
    'Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    'X-Content-Type-Options "nosniff"',
    'Referrer-Policy "no-referrer"',
    'Cross-Origin-Opener-Policy "same-origin"',
    "Permissions-Policy \"gamepad=(self), fullscreen=(self)",
  ])("sends %s", (line) => {
    expect(headers).toContain(line);
  });
});

describe("the staging client's cache rules (release readiness §6.4)", () => {
  it("caches the hashed build folder for a year", () => {
    expect(clientSite).toMatch(/@hashed path \/build\/\*/);
    expect(clientSite).toContain('header @hashed Cache-Control "public, max-age=31536000, immutable"');
  });

  it("revalidates the entry point and every unhashed folder", () => {
    expect(clientSite).toMatch(/@revalidate path \/ \/index\.html \/manifest\.webmanifest \/assets\/\* \/fonts\/\* \/icons\/\*/);
    expect(clientSite).toContain('header @revalidate Cache-Control "no-cache"');
  });
});

describe("the dev build hosts (release readiness D-R6)", () => {
  it("serves each release build at /builds/<id>/ from its own client folder", () => {
    expect(clientSite).toContain("@build path_regexp build ^/builds/([0-9]{12}-[0-9a-f]{7,40})/(.*)$");
    expect(clientSite).toContain("root * /srv/floor-fifty/builds");
    expect(clientSite).toContain("rewrite * /{re.build.1}/client/{re.build.2}");
  });

  // Releases before v0.10.0 compile Pixi's shaders with eval; the no-eval
  // build came with the CSP. Only /builds/ allows it, never the live client.
  it("lets the release builds, and only them, use eval", () => {
    const strict = /Content-Security-Policy "([^"]+)"/.exec(headers)?.[1] ?? "";
    const build = /handle @build \{([\s\S]*?)\n\t\}/.exec(clientSite)?.[1] ?? "";
    const loose = /Content-Security-Policy "([^"]+)"/.exec(build)?.[1] ?? "";
    expect(loose).toBe(strict.replace("script-src 'self';", "script-src 'self' 'unsafe-eval';"));
    expect(clientSite.replace(build, "")).not.toContain("unsafe-eval");
  });

  it("lists them at /builds/index.json for the owner's site", () => {
    expect(clientSite).toContain("handle /builds/index.json");
    expect(clientSite).toContain("root * /srv/floor-fifty\n");
    expect(clientSite).toContain("rewrite * /builds-index.json");
    expect(clientSite).toContain('Access-Control-Allow-Origin "https://mcthaydt.com"');
  });

  it("answers security.txt from the API", () => {
    expect(clientSite).toContain("/.well-known/security.txt");
  });
});
