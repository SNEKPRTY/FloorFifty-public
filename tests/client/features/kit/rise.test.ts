import gsap from "gsap";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import Rise from "../../../../apps/client/src/features/kit/Rise.svelte";
import { STAGGER } from "../../../../apps/client/src/features/kit/motion";
import { setReducedMotion } from "../../support/motion";

afterEach(() => {
  document.body.replaceChildren();
  setReducedMotion(false);
});

const show = (props: { delay?: number; still?: boolean; long?: boolean }) => {
  const host = document.body.appendChild(document.createElement("div"));
  const component = mount(Rise, {
    target: host,
    props: { ...props, class: "thing", children: createRawSnippet(() => ({ render: () => "<span>x</span>" })) },
  });
  flushSync();
  return { node: host.querySelector<HTMLElement>(".thing")!, done: () => unmount(component) };
};

describe("Rise", () => {
  it("rises into place, staggered by its places, with no glass of its own", () => {
    const { node, done } = show({ delay: 2 });
    const tween = gsap.getTweensOf(node)[0]!;
    expect(tween.delay()).toBeCloseTo(2 * STAGGER);
    expect(node.className).toBe("thing");
    done();
  });

  it("takes the calmer 300 ms rise when asked, as the results do", () => {
    const { node, done } = show({ long: true });
    expect(gsap.getTweensOf(node)[0]!.duration()).toBeCloseTo(0.3);
    done();
  });

  it("is placed at once when the player already sees it, and under reduced motion", () => {
    const placed = show({ still: true });
    expect(gsap.getTweensOf(placed.node)).toHaveLength(0);
    placed.done();
    setReducedMotion(true);
    const reduced = show({});
    expect(gsap.getTweensOf(reduced.node)).toHaveLength(0);
    reduced.done();
  });
});
