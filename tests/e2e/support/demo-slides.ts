import type { Mirror } from "./demo-mirror";

/** What a recording presses, by name (`demo-capture.spec.ts` maps them to keys). */
export type Press = "left" | "right" | "fastFall";

/**
 * What one slide records: the controls held for each tick from the first the page draws, and the ticks
 * whose frames are kept (`from` up to but not including `to`).
 */
export type Take = { inputs: readonly (readonly Press[])[]; from: number; to: number };

export type SlidePlan = {
  slide: string;
  /** The course seed on Rooftops. */
  seed: number;
  /** The lava's beats, as the story's last chapter has them. */
  lava?: true;
  /** Decides the take from a mirror of the page's run, which stands at the tick the page is on. */
  take(mirror: Mirror): Take;
};

/** 4 seconds at 60 ticks a second: the longest a clip may run. */
const MAX_TICKS = 240;

/** Steps the mirror with `choose` until `done`, keeping what was pressed. */
function play(mirror: Mirror, choose: (tick: number) => readonly Press[], done: (tick: number) => boolean, limit = 1500): Press[][] {
  const inputs: Press[][] = [];
  for (let tick = 0; tick < limit && !done(tick); tick += 1) {
    const press = [...choose(tick)];
    mirror.step(press);
    inputs.push(press);
  }
  return inputs;
}

const within = (inputs: readonly unknown[], from: number): Take => ({ inputs, from, to: Math.min(inputs.length, from + MAX_TICKS) }) as Take;

export const DEMO_SLIDE_PLANS: readonly SlidePlan[] = [
  {
    slide: "steer",
    seed: 6,
    take(mirror) {
      const spans: readonly (readonly [number, number, readonly Press[]])[] = [[0, 22, ["left"]], [50, 90, ["right"]], [120, 142, ["left"]]];
      const inputs = play(mirror, (tick) => spans.find(([from, to]) => tick >= from && tick < to)?.[2] ?? [], (tick) => tick >= MAX_TICKS);
      return within(inputs, 0);
    },
  },
  {
    slide: "bounce",
    seed: 1,
    take(mirror) {
      let landings = 0;
      let end = -1;
      const inputs = play(
        mirror,
        () => {
          const press = mirror.bot();
          return press;
        },
        (tick) => {
          if (mirror.landedOn() !== undefined) landings += 1;
          if (landings === 3 && end < 0) end = tick + 40;
          return end >= 0 && tick >= end;
        },
      );
      return { inputs, from: 0, to: Math.min(inputs.length, MAX_TICKS) };
    },
  },
  {
    slide: "dropFast",
    seed: 1,
    take(mirror) {
      // The bot to its second landing, then a bounce straight up that is cut short at its top by a fast fall.
      let landings = 0;
      let landedAt = -1;
      let rising: boolean | undefined;
      let lastY = mirror.player.y;
      let dropping = false;
      let end = -1;
      const inputs = play(
        mirror,
        (tick) => {
          if (landedAt < 0) return mirror.bot();
          if (!dropping) {
            if (rising === undefined && tick > landedAt + 2) rising = mirror.player.y < lastY;
            if (rising !== undefined && mirror.player.y < lastY !== rising) dropping = true;
          }
          lastY = mirror.player.y;
          return dropping ? ["fastFall"] : [];
        },
        (tick) => {
          if (mirror.landedOn() !== undefined) {
            landings += 1;
            if (landings === 2 && landedAt < 0) landedAt = tick;
            else if (dropping && end < 0) end = tick + 30;
          }
          return end >= 0 && tick >= end;
        },
      );
      return { inputs, from: Math.max(0, landedAt - 20), to: Math.min(inputs.length, Math.max(0, landedAt - 20) + MAX_TICKS) };
    },
  },
  {
    slide: "movingFloors",
    seed: 4,
    take(mirror) {
      let end = -1;
      const inputs = play(
        mirror,
        () => mirror.bot(),
        (tick) => {
          if (end < 0 && mirror.landedOn()?.moving === true) end = tick + 40;
          return end >= 0 && tick >= end;
        },
      );
      return { inputs, from: Math.max(0, end - MAX_TICKS), to: end };
    },
  },
  {
    slide: "lava",
    seed: 1,
    lava: true,
    take(mirror) {
      let begun = -1;
      // The racer waits a moment where the lava begins, so its edge rises into the picture, then climbs away from it.
      const inputs = play(
        mirror,
        (tick) => (begun >= 0 && tick < begun + 130 ? [] : mirror.bot()),
        (tick) => {
          if (mirror.caught) throw new Error("the lava caught the racer in the recording");
          if (begun < 0 && mirror.script.edgeY !== undefined) begun = tick;
          return begun >= 0 && tick >= begun + MAX_TICKS;
        },
      );
      const from = Math.max(0, begun - 10);
      return { inputs, from, to: Math.min(inputs.length, from + MAX_TICKS) };
    },
  },
];
