/**
 * Anonymous operational events, sent by the client to `POST /telemetry`
 * (release readiness §7.1).
 *
 * The schema is strict, and no field can hold a name, a room code, a token,
 * an address or an input: every free value is a short identifier, so a
 * message or a stack cannot pass for one. The per-load id ties one session's
 * events together and is never stored anywhere.
 */

import { z } from "zod";
import { DEVICE_CLASSES } from "./protocol";

/** A class, screen, stage or phase name: an identifier, never prose. */
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);

const common = {
  buildId: z.string().max(64),
  rulesetRevision: z.string().max(128),
  contentRevision: z.string().max(128),
  deviceClass: z.enum(DEVICE_CLASSES),
  /** Random per page load, never stored. */
  load: z.string().regex(/^[0-9a-f]{16}$/),
};

export const opsEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("boot"), stage: name, ok: z.boolean(), ...common }).strict(),
  z.object({ event: z.literal("asset-failure"), alias: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/), ...common }).strict(),
  z
    .object({
      event: z.literal("socket"),
      state: z.enum(["open", "close", "reconnect", "gave-up"]),
      code: z.number().int().min(0).max(4999).optional(),
      ...common,
    })
    .strict(),
  z.object({ event: z.literal("phase"), phase: name, ...common }).strict(),
  z.object({ event: z.literal("fatal"), class: name, screen: name, ...common }).strict(),
  /**
   * A refusal the player was shown, by its code (`VERSION_MISMATCH`, `ROOM_FULL`, ...), so that after a release "I
   * cannot join" can be told from mistyped codes (audit S23). The code is an identifier; the server's own words never
   * leave it. A server that predates this event answers 400 and the client ignores the answer: ship the server first.
   */
  z.object({ event: z.literal("refusal"), code: name, ...common }).strict(),
  /** A promise nobody awaited rejected; the game went on. */
  z.object({ event: z.literal("rejection"), class: name, screen: name, ...common }).strict(),
]);

export type OpsEvent = z.infer<typeof opsEventSchema>;

/** An event as its sender writes it; the sender adds the common facts. */
export type OpsEventBody = OpsEvent extends infer E
  ? E extends OpsEvent
    ? Omit<E, keyof typeof common>
    : never
  : never;
