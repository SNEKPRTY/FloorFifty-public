/**
 * What each connection state is called, once, for both the indicator and its
 * mounting class. Message functions rather than strings, so a label read in a
 * template follows a language switch.
 */

import type { ConnectionState } from "./network";
import * as m from "../../paraglide/messages.js";

export const CONNECTION_LABELS: Readonly<Record<ConnectionState, () => string>> = {
  offline: m.shell_connection_offline,
  connecting: m.shell_connection_connecting,
  connected: m.shell_connection_connected,
  reconnecting: m.shell_connection_reconnecting,
};
