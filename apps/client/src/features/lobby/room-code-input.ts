/**
 * The room code field's text, cleaned as it is typed or pasted.
 *
 * A code is shared through chat apps, which add a space or a line break
 * around it, and friends write it as "ABC-234". The field used to cut a paste
 * at six characters before trimming it, so " ABC234" became " ABC23" and
 * failed the length check. Cleaning first, then cutting, keeps the code.
 */

import { ROOM_CODE_LENGTH } from "@floor-fifty/shared/common/schemas";

export function cleanRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}
