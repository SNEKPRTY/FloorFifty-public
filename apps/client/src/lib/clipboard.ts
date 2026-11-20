/**
 * Puts text on the clipboard, or reports that it could not.
 *
 * `navigator.clipboard` exists only in a secure context, and a phone reaching
 * the dev server or a LAN build over plain `http://` is not one: there the API
 * is simply absent, and an optional call on it did nothing at all -- no copy,
 * and no refusal either. So the async API is tried first and the old
 * `execCommand("copy")` over a throwaway field is the fallback, which every
 * browser still honours inside a click.
 */
export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard !== undefined && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // A denied permission: fall through to the selection copy.
    }
  }
  if (!copyBySelection(value)) throw new Error("The clipboard refused the copy.");
}

function copyBySelection(value: string): boolean {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  // Off screen but laid out, so it can hold a selection; 16 px so iOS does
  // not zoom the page to it.
  field.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px";
  document.body.append(field);
  const active = document.activeElement;
  field.select();
  field.setSelectionRange(0, value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  return copied;
}
