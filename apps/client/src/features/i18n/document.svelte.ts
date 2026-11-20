/**
 * The document follows the locale: `<html lang>` so the browser picks the
 * right CJK glyph forms and line breaking (and `:lang()` rules apply), and the
 * tab title. One effect for the life of the page (languages spec §3.4).
 */

import * as m from "../../paraglide/messages.js";
import { activeLocale } from "./strategy";

export function bindDocumentLocale(doc: Document = document): () => void {
  return $effect.root(() => {
    $effect(() => {
      doc.documentElement.lang = activeLocale();
      doc.title = m.document_title();
    });
  });
}
