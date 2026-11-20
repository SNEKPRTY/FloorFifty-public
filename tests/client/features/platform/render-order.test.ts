// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Ticker, UPDATE_PRIORITY } from "pixi.js";
import { RENDER_PRIORITY, addRenderPass } from "../../../../apps/client/src/features/platform/render-order";

describe("the frame's render order", () => {
  it("polls input, then draws the race, then the backdrop, then the composite, then the app", () => {
    const ticker = new Ticker();
    ticker.autoStart = false;
    const order: string[] = [];

    // Registered out of order on purpose: the priorities decide, not the calls.
    ticker.add(() => order.push("app"), undefined, UPDATE_PRIORITY.LOW);
    addRenderPass(ticker, "composite", () => order.push("composite"));
    addRenderPass(ticker, "backdrop", () => order.push("backdrop"));
    addRenderPass(ticker, "gameplayDraw", () => order.push("gameplayDraw"));
    // A controller press polled this frame reaches this frame's sample.
    addRenderPass(ticker, "inputPoll", () => order.push("inputPoll"));

    ticker.update(performance.now() + 16);

    expect(order).toEqual(["inputPoll", "gameplayDraw", "backdrop", "composite", "app"]);
    ticker.destroy();
  });

  it("removes a pass with the remover it returns", () => {
    const ticker = new Ticker();
    ticker.autoStart = false;
    let calls = 0;
    const remove = addRenderPass(ticker, "gameplayDraw", () => (calls += 1));

    remove();
    ticker.update(performance.now() + 16);

    expect(calls).toBe(0);
    expect(RENDER_PRIORITY.gameplayDraw).toBeGreaterThan(RENDER_PRIORITY.backdrop);
    ticker.destroy();
  });
});
