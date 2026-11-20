import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function sourcesUnder(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourcesUnder(path);
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".svelte")) return "";
      return readFile(path, "utf8");
    }),
  );
  return parts.join("\n");
}

describe("socket.io is gone", () => {
  it("leaves no import, name or path in production code", async () => {
    const sources = [
      await sourcesUnder("packages/shared/src"),
      await sourcesUnder("apps/server/src"),
      await sourcesUnder("apps/client/src"),
      await readFile("apps/client/dev-proxy.ts", "utf8"),
    ].join("\n");

    for (const name of [
      "socket.io",
      "socket-network",
      "SocketServer",
      "RoomRegistry",
      "RoomRunner",
      "RoomTransport",
      "AckEnvelope",
      "sessionToken",
      "CONTENT_REVISION_EVENT",
      "FLOOR_FIFTY_TRANSPORT",
      "VITE_TRANSPORT",
    ]) {
      expect(sources).not.toContain(name);
    }
  });

  it("leaves no dependency in any manifest", async () => {
    for (const path of [
      "package.json",
      "apps/server/package.json",
      "apps/client/package.json",
      "packages/shared/package.json",
    ]) {
      const manifest = await readFile(path, "utf8");
      expect(manifest).not.toContain("socket.io");
    }
  });
});
