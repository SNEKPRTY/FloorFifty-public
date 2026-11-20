import { z } from "zod";

/** One stable, opaque content identifier. */
export const contentIdSchema = z.string().regex(/^[a-z0-9-]+$/);
