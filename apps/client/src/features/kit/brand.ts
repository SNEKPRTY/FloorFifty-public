import { productionArt } from "../../lib/image-retry";

/** The SNEKPRTY logo: the studio's own, cut out of its paper (`brand.snekprtyLogo` in the art manifest). */
export const LOGO_URL = productionArt("brand/snekprty-logo.webp");

/** The file's own size, so a page can reserve its box before it loads. */
export const LOGO_SIZE = { width: 1200, height: 325 } as const;
