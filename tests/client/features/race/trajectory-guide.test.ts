import { describe, expect, it } from "vitest";
import { computeApex, TrajectoryGuide } from "../../../../apps/client/src/features/race/trajectory-guide";

describe("TrajectoryGuide apex calculation", () => {
  const GRAVITY = -275;
  const COURSE_HALF_WIDTH = 480;

  it("returns undefined when vertical velocity is <= 30 (falling or near rest)", () => {
    expect(computeApex(0, 100, 50, 30, GRAVITY, COURSE_HALF_WIDTH)).toBeUndefined();
    expect(computeApex(0, 100, 50, 0, GRAVITY, COURSE_HALF_WIDTH)).toBeUndefined();
    expect(computeApex(0, 100, 50, -200, GRAVITY, COURSE_HALF_WIDTH)).toBeUndefined();
  });

  it("calculates exact apex timing and displacements", () => {
    // vy = 275, gravity = -275 -> t_apex = 1.0s
    // dy = -(275^2) / (2 * -275) = 137.5
    // vx = 100 -> dx = 100
    const proj = computeApex(0, 50, 100, 275, GRAVITY, COURSE_HALF_WIDTH);
    expect(proj).toBeDefined();
    expect(proj!.timeToApex).toBeCloseTo(1.0, 4);
    expect(proj!.dy).toBeCloseTo(137.5, 4);
    expect(proj!.dx).toBeCloseTo(100.0, 4);
    expect(proj!.apexX).toBeCloseTo(100.0, 4);
    expect(proj!.apexY).toBeCloseTo(187.5, 4);
    expect(proj!.points.length).toBe(6);
  });

  it("handles horizontal boundary wrapping when trajectory crosses course edge", () => {
    // x = 450 (edge is 480). vx = 100, t_apex = 1.0 -> unmapped x = 550.
    // In symmetric range [-480, 480], 550 wraps to 550 - 960 = -410.
    const proj = computeApex(450, 50, 100, 275, GRAVITY, COURSE_HALF_WIDTH);
    expect(proj).toBeDefined();
    expect(proj!.apexX).toBeCloseTo(-410.0, 4);

    // Points along the arc that cross the boundary should also wrap
    const lastPoint = proj!.points[proj!.points.length - 1]!;
    expect(lastPoint.x).toBeLessThan(0); // wrapped to the left side
  });



  it("TrajectoryGuide clears graphics when invisible or falling, and draws when ascending", () => {
    const guide = new TrajectoryGuide();
    expect(guide.root.children.length).toBeGreaterThan(0);

    // Update while ascending and visible
    guide.update({
      x: 0,
      y: 50,
      vx: 50,
      vy: 200,
      gravity: GRAVITY,
      visible: true,
    });
    expect(guide.active).toBe(true);

    // Update while descending
    guide.update({
      x: 0,
      y: 100,
      vx: 50,
      vy: -100,
      gravity: GRAVITY,
      visible: true,
    });
    expect(guide.active).toBe(false);

    // Update while visible is false
    guide.update({
      x: 0,
      y: 100,
      vx: 50,
      vy: 200,
      gravity: GRAVITY,
      visible: false,
    });
    expect(guide.active).toBe(false);
  });
});
