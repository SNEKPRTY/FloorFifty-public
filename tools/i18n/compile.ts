/** `pnpm i18n:compile`: the generated `paraglide/` for a typecheck or a CI step with no Vite in it. */

import { compile } from "@inlang/paraglide-js";
import { PARAGLIDE } from "../../apps/client/i18n.config";

await compile(PARAGLIDE);
