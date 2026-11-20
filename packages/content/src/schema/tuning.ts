/**
 * Authored tuning maps.
 *
 * Shape only: a tuning file is a flat table of finite numbers. Which names are
 * legal, which are required, and which ranges they fall in are decided against
 * the shared declarations in `validate/bounds.ts`, so an author gets one
 * answer about a tunable rather than two.
 */

import { z } from "zod";

export const tuningMapSchema = z.record(z.string(), z.number().finite());
