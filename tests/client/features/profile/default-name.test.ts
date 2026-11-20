import { describe, expect, it } from "vitest";
import { playerNameSchema } from "@floor-fifty/shared/common/schemas";
import { defaultRacerName } from "../../../../apps/client/src/features/profile/default-name";
import { LOCALE_TAGS } from "../../../../apps/client/src/features/i18n/locales";

describe("the default racer name", () => {
  it("is Racer and two digits, 10 to 99, in English", () => {
    expect(defaultRacerName(() => 0, "en")).toBe("Racer 10");
    expect(defaultRacerName(() => 0.9999, "en")).toBe("Racer 99");
  });

  it("is said in the player's language", () => {
    expect(defaultRacerName(() => 0, "ja")).toBe("レーサー10");
    expect(defaultRacerName(() => 0, "es-419")).toBe("Piloto 10");
  });

  it("is a name the server accepts, in every language", () => {
    for (const locale of LOCALE_TAGS) {
      for (const r of [0, 0.5, 0.9999]) expect(playerNameSchema.safeParse(defaultRacerName(() => r, locale)).success, locale).toBe(true);
    }
  });
});
