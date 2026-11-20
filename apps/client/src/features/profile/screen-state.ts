/**
 * Top-level screen identity.
 *
 * The names live in `packages/shared` because authored content selects among
 * them: `flow.toml` names a screen, and the compiler refuses any name this
 * client does not implement.
 *
 * What used to live here as well -- an `ALLOWED` table of legal moves -- is
 * gone. The compiler-validated flow graph is now the client's only navigation
 * policy, and two policies would have meant a destination the graph permits
 * being refused at runtime by a table nobody remembered to update. The pair
 * that proves it is `MainMenu -> GameEnd`, the finished-room reconnect, which
 * `ALLOWED` refused and the graph allows on purpose.
 */

import { SCREEN_IDS, type ScreenId } from "@floor-fifty/shared/content/presentation";

export type { ScreenId };

export const SCREEN_ORDER: readonly ScreenId[] = SCREEN_IDS;
