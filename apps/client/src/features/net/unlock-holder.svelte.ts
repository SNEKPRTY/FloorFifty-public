import type { UnlockGrant } from "./unlock-grant";

/** The round's grant, for the results banner. A share's grant is said in the replay window's status line instead (replay-share.svelte.ts). */
export class UnlockHolder {
  current = $state<UnlockGrant | undefined>(undefined);
}
