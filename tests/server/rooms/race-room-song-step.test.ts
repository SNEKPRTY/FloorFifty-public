import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REVEAL_TICKS, SELECT_STEP_TICKS, SOLO_REVEAL_TICKS } from "@floor-fifty/shared/common/constants";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { openSets, type AccessSets } from "@floor-fifty/shared/content/access";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { createColyseusHarness, type ColyseusHarness, type HarnessClient } from "../support/colyseus-harness";

const EVERYONE: AccessSets = {
  stages: ["rooftops", "snow-shrine", "sunken-dome"],
  songs: ["moving-on", "farther-from-home", "whats-next", "chrome-in-the-rain", "la-reina-del-mambo", "crash-mode", "pyramid-scheme", "static-in-the-air", "unseen"],
  characters: ["ninja"],
};
/** What a seat with no report may pick. Unseen is not in it (Task 4: `unlock = "share-replay"`). */
const OPEN = openSets(GENERATED_CONTENT.content);

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

/** The room's own select state: the rules are read at the source. */
const select = () => harness.room.raceState.select!;
const refusedWith = (client: HarnessClient): string | undefined => {
  const result = client.messages("commandResult").at(-1) as CommandResult;
  return result.ok ? undefined : result.error.code;
};

type Seat = { name: string; access?: AccessSets };

/** Seats everyone, readies them, and takes the room through the stage step and its reveal. */
async function toSongStep(seats: readonly Seat[]): Promise<HarnessClient[]> {
  const over = (seat: Seat) => (seat.access === undefined ? {} : { access: seat.access });
  const host = await harness.create(seats[0]!.name, over(seats[0]!));
  const clients = [host];
  for (const seat of seats.slice(1)) clients.push(await harness.joinById(host.roomId, seat.name, over(seat)));
  for (const client of clients) await harness.setReady(client, true);
  expect(select().step).toBe("stage");
  for (const client of clients) await client.lockIn();
  expect(select().step).toBe("stageReveal");
  await harness.advanceTicks(clients.length === 1 ? SOLO_REVEAL_TICKS : REVEAL_TICKS);
  expect(select().step).toBe("song");
  return clients;
}

/** Two seats with every song, in the song step. */
async function pair(): Promise<[HarnessClient, HarnessClient]> {
  const [host, guest] = await toSongStep([
    { name: "Kite", access: EVERYONE },
    { name: "Sable", access: EVERYONE },
  ]);
  return [host!, guest!];
}

describe("the song step", () => {
  it("comes after the stage reveal, and leads to the song reveal, then loading", async () => {
    const [host, guest] = await pair();
    expect(select().endsAtTick).toBe(harness.room.raceState.tick + SELECT_STEP_TICKS);
    for (const seat of [host, guest]) {
      expect(EVERYONE.songs).toContain(select().picks[seat.sessionPlayerId]!.focus);
      expect(select().picks[seat.sessionPlayerId]!.locked).toBe(false);
    }
    await host.pickSong("unseen");
    await host.lockIn();
    expect(select().step).toBe("song");
    await guest.lockIn();
    expect(select().step).toBe("songReveal");
    const song = select().song!;
    const focuses = [host, guest].map((seat) => select().picks[seat.sessionPlayerId]!.focus);
    expect(focuses).toContain(song.id);
    expect(harness.room.raceState.songId).toBe(song.id);
    expect(harness.room.raceState.stageId).toBeDefined();
    expect(host.state.select.songId).toBe(song.id);
    expect(host.state.select.songPickedBy).toBe(song.pickedBy);
    await harness.advanceTicks(REVEAL_TICKS);
    expect(select().step).toBe("loading");
    expect(host.state.songId).toBe(song.id);
  });

  it("locks each seat's focus at the timeout", async () => {
    const [host, guest] = await pair();
    await host.pickSong("whats-next");
    const guestFocus = select().picks[guest.sessionPlayerId]!.focus;
    await harness.advanceTicks(SELECT_STEP_TICKS);
    expect(select().step).toBe("songReveal");
    expect(select().picks[host.sessionPlayerId]).toEqual({ focus: "whats-next", locked: true, seed: "random" });
    expect(select().picks[guest.sessionPlayerId]).toEqual({ focus: guestFocus, locked: true, seed: "random" });
    expect(["whats-next", guestFocus]).toContain(select().song!.id);
  });

  it("draws only from the seats' locked picks", async () => {
    const [host, guest] = await pair();
    await host.pickSong("moving-on");
    await guest.pickSong("moving-on");
    await host.lockIn();
    await guest.lockIn();
    expect(select().song!.id).toBe("moving-on");
    expect([host.sessionPlayerId, guest.sessionPlayerId]).toContain(select().song!.pickedBy);
  });

  it("resolves ? from the seat's own access", async () => {
    const [host, guest] = await toSongStep([
      { name: "Kite", access: { ...EVERYONE, songs: ["whats-next"] } },
      { name: "Sable", access: { ...EVERYONE, songs: ["farther-from-home"] } },
    ]);
    await host!.pickSong("?");
    await guest!.pickSong("?");
    await host!.lockIn();
    await guest!.lockIn();
    const song = select().song!;
    expect(song.id).toBe(song.pickedBy === host!.sessionPlayerId ? "whats-next" : "farther-from-home");
  });

  it("refuses a song outside the seat's access", async () => {
    const [host] = await toSongStep([{ name: "Kite" }]); // no report: the open set
    expect(OPEN.songs).not.toContain("unseen");
    await host!.pickSong("unseen");
    expect(refusedWith(host!)).toBe("MALFORMED_MESSAGE");
    expect(select().picks[host!.sessionPlayerId]!.focus).not.toBe("unseen");
  });

  it("refuses a pick after locking in", async () => {
    const [host] = await pair();
    await host.pickSong("moving-on");
    await host.lockIn();
    expect(select().step).toBe("song"); // the guest has not locked in
    await host.pickSong("whats-next");
    expect(refusedWith(host)).toBe("MALFORMED_MESSAGE");
    expect(select().picks[host.sessionPlayerId]).toEqual({ focus: "moving-on", locked: true, seed: "random" });
  });

  it("refuses pickSong in the stage step", async () => {
    const host = await harness.create("Kite", { access: EVERYONE });
    await harness.setReady(host, true);
    expect(select().step).toBe("stage");
    await host.pickSong("moving-on");
    expect(refusedWith(host)).toBe("MALFORMED_MESSAGE");
  });

  it("reveals for one second without a spin when one seat is connected", async () => {
    const [host] = await toSongStep([{ name: "Kite", access: EVERYONE }]);
    await host!.lockIn();
    expect(select().step).toBe("songReveal");
    expect(select().endsAtTick - harness.room.raceState.tick).toBe(SOLO_REVEAL_TICKS);
    await harness.advanceTicks(SOLO_REVEAL_TICKS);
    expect(select().step).toBe("loading");
  });

  it("a leaver's song is ignored; a ghost's focus locks at the timeout", async () => {
    const [host, leaver, ghost] = await toSongStep([
      { name: "Kite", access: EVERYONE },
      { name: "Sable", access: EVERYONE },
      { name: "Wren", access: EVERYONE },
    ]);
    const leaverId = leaver!.sessionPlayerId;
    const ghostId = ghost!.sessionPlayerId;
    await leaver!.pickSong("unseen");
    await ghost!.pickSong("whats-next");
    await host!.pickSong("moving-on");
    await harness.leave(leaver!);
    await harness.drop(ghost!);
    await harness.advanceTicks(1);
    expect(select().picks[leaverId]).toBeUndefined();
    expect(select().picks[ghostId]).toEqual({ focus: "whats-next", locked: false, seed: "random" });
    // The only connected seat has not locked in, so the step waits for its clock.
    expect(select().step).toBe("song");
    await harness.advanceTicks(SELECT_STEP_TICKS);
    expect(select().step).toBe("songReveal");
    expect(select().picks[ghostId]).toEqual({ focus: "whats-next", locked: true, seed: "random" });
    expect(["moving-on", "whats-next"]).toContain(select().song!.id);
  });

  it("ends once every connected seat has locked in, drawing a ghost's focus with theirs", async () => {
    const [host, guest] = await pair();
    const guestId = guest.sessionPlayerId;
    await guest.pickSong("unseen");
    await harness.drop(guest);
    await host.pickSong("moving-on");
    expect(select().step).toBe("song");
    await host.lockIn();
    expect(select().step).toBe("songReveal");
    expect(select().picks[guestId]).toEqual({ focus: "unseen", locked: true, seed: "random" });
    expect(["moving-on", "unseen"]).toContain(select().song!.id);
  });

  it("gives a seat that reports no songs the open set", async () => {
    const [host] = await toSongStep([{ name: "Kite", access: { ...EVERYONE, songs: [] } }]);
    expect(OPEN.songs).toContain(select().picks[host!.sessionPlayerId]!.focus);
    await host!.lockIn();
    expect(select().step).toBe("songReveal");
    expect(OPEN.songs).toContain(select().song!.id);
  });

  it("refuses a join during the song step", async () => {
    const [host] = await pair();
    const refusal = await harness.joinById(host.roomId, "Late").catch((error: unknown) => error);
    expect(String((refusal as Error).message)).toMatch(/racing|closed/);
  });

  it("is deterministic: the same room seed, round and picks give the same song", async () => {
    const run = async (): Promise<string> => {
      const [host, guest] = await pair();
      await host.pickSong("moving-on");
      await guest.pickSong("unseen");
      await host.lockIn();
      await guest.lockIn();
      const id = select().song!.id;
      await harness.close();
      harness = await createColyseusHarness();
      return id;
    };
    expect(await run()).toBe(await run());
  });
});
