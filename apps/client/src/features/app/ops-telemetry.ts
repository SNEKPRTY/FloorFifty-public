/**
 * Anonymous operational events, sent to the server's `/telemetry` (release
 * readiness §7.1): how boots, assets, sockets and fatal errors go in the
 * field, by build and device class.
 *
 * Fire and forget. Sending never awaits, never retries and never throws into
 * play, and an event the server's schema would refuse is dropped here rather
 * than sent. Every event carries a random per-load id, which ties one
 * session's events together and is stored nowhere.
 */

import type { BuildFacts } from "@floor-fifty/shared/common/build";
import { opsEventSchema, type OpsEventBody } from "@floor-fifty/shared/common/ops-telemetry";
import type { DeviceClass } from "@floor-fifty/shared/common/protocol";

export type OpsTelemetry = { report(event: OpsEventBody): void };

/** `sendBeacon` survives a page unload; a keepalive `fetch` stands in where it is missing or refused. */
export function beaconSend(url: string, body: string): void {
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" })) === true) return;
  } catch {
    // A beacon that throws is a beacon that did not send; try fetch.
  }
  try {
    void fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(
      () => undefined,
    );
  } catch {
    // Nothing more to try, and nothing in play depends on it.
  }
}

function loadId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createOpsTelemetry(options: {
  url: string;
  facts: BuildFacts;
  /** Read at each event, so a content swap mid-session is reported as it is. */
  revisions: () => { contentRevision: string };
  deviceClass: () => DeviceClass;
  send?: (url: string, body: string) => void;
}): OpsTelemetry {
  const load = loadId();
  const send = options.send ?? beaconSend;
  return {
    report(event) {
      try {
        const full = opsEventSchema.safeParse({
          ...event,
          buildId: options.facts.buildId,
          rulesetRevision: options.facts.rulesetRevision,
          contentRevision: options.revisions().contentRevision,
          deviceClass: options.deviceClass(),
          load,
        });
        if (!full.success) return;
        send(options.url, JSON.stringify(full.data));
      } catch {
        // Telemetry is never a reason for play to stop.
      }
    },
  };
}
