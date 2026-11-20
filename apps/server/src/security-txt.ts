/**
 * How to report a security problem (RFC 9116; release readiness §7.4).
 *
 * Served by the API at `/.well-known/security.txt`, because a Ruken game
 * origin serves builds only under `/b/` (Amendment R). The expiry is a fixed
 * date a year out, moved by hand; `release:check` refuses a release within 30
 * days of it, and refuses a `.invalid` contact.
 *
 * The contact is a Discord invite, which RFC 9116 §2.5.3 allows as a web
 * contact (it must begin `https://`). It must never expire: a dead link is a
 * dead contact. When the studio has a mailbox, add it as a second `Contact:`
 * line, in order of preference.
 */

export const SECURITY_TXT_CONTACT = "https://discord.gg/6Xt2cCjqMs";

export const SECURITY_TXT_EXPIRES = "2027-10-05T00:00:00Z";

export function securityTxt(): string {
  return [`Contact: ${SECURITY_TXT_CONTACT}`, `Expires: ${SECURITY_TXT_EXPIRES}`, "Preferred-Languages: en", ""].join(
    "\n",
  );
}
