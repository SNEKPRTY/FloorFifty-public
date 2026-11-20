import { expect, test } from "./support/test";

// A worker's browser lives across tests. Contexts opened directly must not.
test.describe.serial("manual browser contexts belong to one test", () => {
  test("opens an extra client without explicit teardown", async ({ browser }) => {
    expect(browser.contexts()).toHaveLength(0);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<p>Extra client</p>");
    expect(await page.textContent("p")).toBe("Extra client");
    expect(browser.contexts()).toHaveLength(1);
  });

  test("the following test starts with no leftover client", async ({ browser }) => {
    expect(browser.contexts()).toHaveLength(0);
  });
});
