import { chmodSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addRelease, makeBox, type Box } from "./support/stubs";

/** A box already serving `id` on blue, as after a first activation. */
function servingOnBlue(box: Box, id: string): void {
  addRelease(box, id);
  symlinkSync(join(box.root, "releases", id), join(box.root, "blue"));
  writeFileSync(join(box.root, "live"), "blue\n");
  writeFileSync(join(box.root, "current"), `${id}\n`);
  writeFileSync(box.upstream, "reverse_proxy 127.0.0.1:3001 {\n\tstream_close_delay 6m\n}\n");
}

const target = (box: Box, colour: string) => readlinkSync(join(box.root, colour));

describe("activate", () => {
  it("reloads Caddy with the domain and e-mail from caddy.env", () => {
    // `caddy reload` reads the Caddyfile's {$FF_DOMAIN} and {$FF_ACME_EMAIL}
    // from its own environment; without caddy.env the first real deploy was
    // refused over an empty `email`.
    const box = makeBox();
    addRelease(box, "202609261200-aaaaaaa");
    writeFileSync(join(box.root, "../caddy.env"), "FF_DOMAIN=example.test\nFF_ACME_EMAIL=ops@example.test\n");
    writeFileSync(join(box.bin, "caddy"), '#!/usr/bin/env bash\necho "caddy $FF_DOMAIN $FF_ACME_EMAIL" >> "$STUB_LOG"\n');
    chmodSync(join(box.bin, "caddy"), 0o755);

    const result = box.run("activate", ["202609261200-aaaaaaa"]);

    expect(result.status).toBe(0);
    expect(box.log()).toContain("caddy example.test ops@example.test");
  });

  it("starts blue on a fresh box and stops nothing", () => {
    const box = makeBox();
    addRelease(box, "202609261200-aaaaaaa");

    const result = box.run("activate", ["202609261200-aaaaaaa"]);

    expect(result.status).toBe(0);
    expect(target(box, "blue")).toBe(join(box.root, "releases/202609261200-aaaaaaa"));
    expect(box.read("live")).toBe("blue");
    expect(box.read("current")).toBe("202609261200-aaaaaaa");
    expect(box.read("previous")).toBeUndefined();
    expect(box.read("../upstream.caddy")).toContain("reverse_proxy 127.0.0.1:3001");
    expect(box.log()).toEqual([
      "systemctl restart floor-fifty@blue",
      "curl -fsS -o /dev/null http://127.0.0.1:3001/ready",
      `caddy reload --config ${join(box.root, "../Caddyfile")}`,
      "systemctl enable floor-fifty@blue",
    ]);
  });

  it("makes the new colour the one a reboot starts, and not the old one", () => {
    // A rebooted staging box came back with Caddy up and no server behind it:
    // `restart` starts a colour for now, and nothing enabled it for boot.
    const box = makeBox();
    servingOnBlue(box, "202609261200-aaaaaaa");
    addRelease(box, "202609261300-bbbbbbb");

    const result = box.run("activate", ["202609261300-bbbbbbb"]);

    expect(result.status).toBe(0);
    expect(box.log().slice(-3)).toEqual([
      "systemctl enable floor-fifty@green",
      "systemctl disable floor-fifty@blue",
      "systemctl stop --no-block floor-fifty@blue",
    ]);
  });

  it("still finishes the deploy when the boot setting is refused", () => {
    const box = makeBox();
    servingOnBlue(box, "202609261200-aaaaaaa");
    addRelease(box, "202609261300-bbbbbbb");
    writeFileSync(
      join(box.bin, "systemctl"),
      '#!/usr/bin/env bash\necho "systemctl $*" >> "$STUB_LOG"\n[[ "$1" == enable || "$1" == disable ]] && exit 1\nexit 0\n',
    );
    chmodSync(join(box.bin, "systemctl"), 0o755);

    const result = box.run("activate", ["202609261300-bbbbbbb"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("warning: floor-fifty@green will not start at boot");
    expect(box.read("live")).toBe("green");
    expect(box.log().at(-1)).toBe("systemctl stop --no-block floor-fifty@blue");
  });

  it("swaps to green, then drains blue and remembers the build it ran", () => {
    const box = makeBox();
    servingOnBlue(box, "202609261200-aaaaaaa");
    addRelease(box, "202609261300-bbbbbbb");

    const result = box.run("activate", ["202609261300-bbbbbbb"]);

    expect(result.status).toBe(0);
    expect(target(box, "green")).toBe(join(box.root, "releases/202609261300-bbbbbbb"));
    expect(box.read("live")).toBe("green");
    expect(box.read("previous")).toBe("202609261200-aaaaaaa");
    expect(box.read("../upstream.caddy")).toContain("reverse_proxy 127.0.0.1:3002");
    expect(box.log().at(-1)).toBe("systemctl stop --no-block floor-fifty@blue");
  });

  it("redeploys the live build onto the other colour", () => {
    const box = makeBox();
    servingOnBlue(box, "202609261200-aaaaaaa");

    const result = box.run("activate", ["202609261200-aaaaaaa"]);

    expect(result.status).toBe(0);
    expect(box.read("live")).toBe("green");
    expect(box.read("previous")).toBe("202609261200-aaaaaaa");
  });

  it("leaves the live colour serving when the new one never becomes ready", () => {
    const box = makeBox();
    servingOnBlue(box, "202609261200-aaaaaaa");
    addRelease(box, "202609261300-bbbbbbb");

    const result = box.run("activate", ["202609261300-bbbbbbb"], { STUB_CURL_EXIT: "7" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("never became ready; blue is still serving");
    expect(box.read("live")).toBe("blue");
    expect(box.read("../upstream.caddy")).toContain("127.0.0.1:3001");
    expect(box.log().some((line) => line.startsWith("caddy"))).toBe(false);
    expect(box.log().at(-1)).toBe("systemctl stop floor-fifty@green");
  });

  it("restores the upstream and stops the new colour when Caddy refuses the reload", () => {
    const box = makeBox();
    servingOnBlue(box, "202609261200-aaaaaaa");
    addRelease(box, "202609261300-bbbbbbb");

    const result = box.run("activate", ["202609261300-bbbbbbb"], { STUB_CADDY_EXIT: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("caddy refused the reload; blue is still serving");
    expect(box.read("live")).toBe("blue");
    expect(box.read("../upstream.caddy")).toContain("127.0.0.1:3001");
    expect(box.log().at(-1)).toBe("systemctl stop floor-fifty@green");
  });

  it("refuses a build that is not on the box, touching nothing", () => {
    const box = makeBox();
    const result = box.run("activate", ["202609261200-fffffff"]);
    expect(result.status).toBe(2);
    expect(box.log()).toEqual([]);
  });

  it("refuses a build ID that is not a build ID", () => {
    const box = makeBox();
    const result = box.run("activate", ["../../etc"]);
    expect(result.status).toBe(2);
    expect(box.log()).toEqual([]);
  });
});
