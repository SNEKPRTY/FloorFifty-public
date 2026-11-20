import { describe, expect, it } from "vitest";
import { rebuildOnQuality } from "../../../../apps/client/src/features/render/quality-rebuild";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

describe("rebuilding a backdrop on a quality change", () => {
  it("destroys the old build before the new one exists, and leaves nothing behind", () => {
    const settings = new SettingsStore(undefined);
    const live = new Set<string>();
    let serial = 0;
    const build = (quality: string) => {
      const id = `${quality}#${(serial += 1)}`;
      live.add(id);
      return { id, destroy: () => live.delete(id) };
    };

    const mounted = rebuildOnQuality(settings, build);
    expect([...live]).toEqual(["high#1"]);

    settings.update({ display: { quality: "low" } });
    settings.update({ display: { quality: "high" } });
    expect([...live]).toEqual(["high#3"]);
    expect(mounted.current().id).toBe("high#3");

    mounted.dispose();
    expect(live.size).toBe(0);
  });

  it("ignores changes that are not the quality", () => {
    const settings = new SettingsStore(undefined);
    let builds = 0;
    rebuildOnQuality(settings, () => ((builds += 1), { destroy() {} }));
    settings.update({ audio: { muted: true } });
    expect(builds).toBe(1);
  });
});
