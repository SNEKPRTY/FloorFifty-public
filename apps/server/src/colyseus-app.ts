/**
 * The Colyseus server, as configuration rather than as a running thing.
 *
 * `@colyseus/testing`'s `boot` takes exactly this shape, so a test drives the
 * same room definitions a player does instead of a re-declared subset. The
 * production entry point passes the same object to a real `Server`.
 */

import type { Server } from "@colyseus/core";
import type { ContentStore } from "./content/content-store";
import { defineRaceRoom, type RoomTelemetryConfig } from "./rooms/race-room";

export type ColyseusAppOptions = {
  contentStore: ContentStore;
  /** Fixes every room's course, for reproducible end-to-end runs. */
  fixedSeed?: number;
  /** Where each room's telemetry goes. Absent in tests, so they stay quiet. */
  telemetry?: RoomTelemetryConfig;
  /** Whether the process is draining for a deploy (release readiness §5.4). */
  isDraining?: () => boolean;
  /** The most rooms the process holds at once (release readiness §6.1). */
  maxRooms?: number;
  /** Ticks a lobby, select or results room may sit with no command before it closes; `ROOM_IDLE_TICKS` by default. */
  roomIdleTicks?: number;
  /** Rooms one address may have open, by who created them; unset is no limit (audit B1). */
  maxRoomsPerAddress?: number;
};

export type ColyseusAppConfig = {
  initializeGameServer(gameServer: Server): void;
};

export function createAppConfig(options: ColyseusAppOptions): ColyseusAppConfig {
  return {
    initializeGameServer(gameServer) {
      defineRaceRoom(gameServer, {
        contentStore: options.contentStore,
        ...(options.fixedSeed === undefined ? {} : { fixedSeed: options.fixedSeed }),
        ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
        ...(options.isDraining === undefined ? {} : { isDraining: options.isDraining }),
        ...(options.maxRooms === undefined ? {} : { maxRooms: options.maxRooms }),
        ...(options.roomIdleTicks === undefined ? {} : { roomIdleTicks: options.roomIdleTicks }),
        ...(options.maxRoomsPerAddress === undefined ? {} : { maxRoomsPerAddress: options.maxRoomsPerAddress }),
      });
    },
  };
}
