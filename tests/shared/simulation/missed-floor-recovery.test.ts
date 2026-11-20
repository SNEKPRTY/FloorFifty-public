import { expect, it } from "vitest";
import { freshRaceState, PLAYER_ID } from "../support/race";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";

it("collects floor 19 by descending from above the warning distance, without resetting", () => {
  let state = freshRaceState();
  const floor = state.course.floors[19]!;
  const player = state.players[PLAYER_ID]!;
  player.x = floor.x;
  player.y = floor.y + state.tuning.FLOOR_GAP_MAX + 10;
  player.vx = 0;
  player.vy = -200;
  expect(player.visitedFloorIds).not.toContain(floor.id);
  const simulation = createRaceSimulation(state);
  const events: string[] = [];
  try {
    for (let tick = 0; tick < 120 && !state.players[PLAYER_ID]!.visitedFloorIds.includes(floor.id); tick++) {
      const result = simulation.step({ ...state, tick: state.tick + 1 }, new Map());
      state = result.state;
      events.push(...result.events.map((event) => event.type));
    }
    expect(state.players[PLAYER_ID]!.visitedFloorIds).toContain(floor.id);
    expect(events).not.toContain("playerReset");
  } finally { simulation.dispose(); }
});
