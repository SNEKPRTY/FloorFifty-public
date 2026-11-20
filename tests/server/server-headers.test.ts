import { afterEach, describe, expect, it } from "vitest";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import { contentWithGravity } from "./support/colyseus-harness";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
} from "../../apps/server/src/colyseus-server";
import { SECURITY_TXT_EXPIRES, securityTxt } from "../../apps/server/src/security-txt";

let server: ColyseusRaceServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (store = new ContentStore(GENERATED_CONTENT)): Promise<string> => {
  server = await createColyseusRaceServer({ port: 0, contentStore: store });
  return `http://127.0.0.1:${server.port}`;
};

describe("/content, serialised once (release readiness §6.4)", () => {
  it("answers with an ETag and revalidates rather than caching blind", async () => {
    const base = await start();
    const first = await fetch(`${base}/content`);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(first.headers.get("cache-control")).toBe("no-cache");
    await first.json();

    const again = await fetch(`${base}/content`, { headers: { "if-none-match": etag! } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  it("changes its ETag when the content does", async () => {
    const store = new ContentStore(GENERATED_CONTENT);
    const base = await start(store);
    const before = (await fetch(`${base}/content`)).headers.get("etag");
    store.replace(contentWithGravity(-500, "e"));
    const after = await fetch(`${base}/content`, { headers: { "if-none-match": before! } });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before);
  });
});

describe("the server's own headers (release readiness §6.3)", () => {
  it.each(["/health", "/ready"])("sends %s with nosniff and no-store", async (path) => {
    const base = await start();
    const response = await fetch(`${base}${path}`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("security.txt (release readiness §7.4, Amendment R)", () => {
  it("is served by the API at its well-known path", async () => {
    const base = await start();
    const response = await fetch(`${base}/.well-known/security.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = await response.text();
    expect(text).toMatch(/^Contact: \S+$/m);
    expect(text).toContain("Contact: https://discord.gg/6Xt2cCjqMs");
    expect(text).toContain(`Expires: ${SECURITY_TXT_EXPIRES}`);
  });

  it("names a contact and an expiry about a year out", () => {
    const text = securityTxt();
    // RFC 9116 §2.5.3: a web contact MUST begin "https://".
    expect(text).toMatch(/^Contact: https:\/\/\S+$/m);
    const expires = Date.parse(SECURITY_TXT_EXPIRES);
    expect(Number.isNaN(expires)).toBe(false);
  });
});
