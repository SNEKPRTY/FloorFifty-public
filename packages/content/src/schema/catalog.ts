/**
 * The catalog, and the ID grammar every item shares.
 *
 * The ID schema lives here because the catalog is the registry that decides
 * which IDs are public: an item file spells an ID, the catalog is what makes
 * it real.
 */

import { z } from "zod";
import { contentIdSchema } from "./id";
import { packSchema } from "./pack";

// Re-exported: every item schema imports the ID grammar from here. It lives in
// `id.ts` so `pack.ts` can share it without importing the catalog back.
export { contentIdSchema };

export const catalogSchema = z
  .object({
    modes: z.array(contentIdSchema),
    packs: z.array(packSchema).min(1),
  })
  .strict();
