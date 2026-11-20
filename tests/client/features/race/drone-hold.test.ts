/**
 * Infinite's closing hum held for one racer from a drawn sample (race-cues
 * `climbDrone`): never in a finite race, asked for only once it has something
 * to say, and cut the moment the race stops racing (audit remediation D-R1, T8).
 */
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { DroneHold } from "../../../../apps/client/src/features/race/drone-hold";
import { CLIMB_DRONE_ENDLESS_TICKS } from "../../../../apps/client/src/features/race/race-cues";
import { FakeAudio } from "../../support/fakes/audio";
import { LOCAL_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const drones = (audio: FakeAudio) => audio.calls.filter((call) => call.startsWith("drone"));

const finite = (progress: number, phase: "racing" | "finished" = "racing") =>
  snapshotAt(600, { phase, lapCount: 1, raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID, lap: 1, progress })] });

const endless = (progress = 0) =>
  snapshotAt(600, {
    lapCount: 1,
    raceStartedAtTick: 0,
    tuning: { ...snapshotAt(0).tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 },
    players: [playerSnapshot({ id: LOCAL_ID, lap: 1, progress, bestFloor: 45 })],
  });

describe("DroneHold", () => {
  it("asks for nothing in a finite race, even at the top of the last ascent", () => {
    const audio = new FakeAudio();
    const hold = new DroneHold(audio);
    hold.update(finite(0.5), LOCAL_ID, 600);
    hold.update(finite(1), LOCAL_ID, 601);
    hold.update(finite(1, "finished"), LOCAL_ID, 602);
    expect(drones(audio)).toEqual([]);
  });

  it("hums in Infinite's last stretch and cuts at the finish", () => {
    const audio = new FakeAudio();
    const hold = new DroneHold(audio);
    hold.update(endless(), LOCAL_ID, 10_800 - TICK_HZ);
    hold.update({ ...endless(), phase: "finished" }, LOCAL_ID, 10_800);
    expect(drones(audio)[0]).toMatch(/^drone:ambience\.climbDrone@/);
    expect(drones(audio).at(-1)).toBe("drone-stop");
  });

  it("is silent in Infinite above the clock's last stretch, however high the racer", () => {
    const audio = new FakeAudio();
    new DroneHold(audio).update(endless(1), LOCAL_ID, 600);
    expect(drones(audio)).toEqual([]);
  });

  it("hums in Infinite's last 30 s, read against the clock tick it is given", () => {
    const audio = new FakeAudio();
    new DroneHold(audio).update(endless(0), LOCAL_ID, 10_800 - CLIMB_DRONE_ENDLESS_TICKS + TICK_HZ);
    expect(drones(audio)).toHaveLength(1);
  });

  it("stops once, and only after it started", () => {
    const audio = new FakeAudio();
    const hold = new DroneHold(audio);
    hold.stop();
    expect(drones(audio)).toEqual([]);
    hold.update(endless(), LOCAL_ID, 10_800 - TICK_HZ);
    hold.stop();
    hold.stop();
    expect(drones(audio).filter((call) => call === "drone-stop")).toHaveLength(1);
  });
});
