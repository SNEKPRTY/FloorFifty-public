import { expect, test, type Page } from "./support/test";
import { expectInsideViewport, expectMinText, expectUncovered, expectWholeWords, expectWordedButtons } from "./support/fit";

/**
 * The fit checks must fail on the faults they exist to catch and pass on a
 * layout that is fine, or a green `ui-fit` run means nothing. Each case is a
 * `setContent` fixture, so no game or server is involved.
 */

async function fixture(page: Page, html: string): Promise<void> {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;font:16px sans-serif">${html}</body>`);
}

/** The helper's own failure message, so a case can say it failed for the right reason. */
async function failureOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

test("expectWholeWords fails on a word broken mid-word", async ({ page }) => {
  await fixture(page, `<div data-testid="box" style="width:40px;word-break:break-all">Confirmar</div>`);
  const message = await failureOf(() => expectWholeWords(page, page.getByTestId("box")));
  expect(message).toContain("box: the word \"Confirmar\" is broken across lines");
});

test("expectWholeWords passes a phrase wrapped at a space", async ({ page }) => {
  await fixture(page, `<div data-testid="box" style="width:90px">Leave the race now</div>`);
  await expectWholeWords(page, page.getByTestId("box"));
});

test("expectWholeWords leaves CJK text to break where it likes", async ({ page }) => {
  await fixture(page, `<div data-testid="box" style="width:30px;word-break:break-all">观看回放返回菜单</div>`);
  await expectWholeWords(page, page.getByTestId("box"));
});

test("expectWholeWords fails on clipped text", async ({ page }) => {
  await fixture(page, `<div data-testid="box" style="width:40px;white-space:nowrap;overflow:hidden">Leave the race</div>`);
  const message = await failureOf(() => expectWholeWords(page, page.getByTestId("box")));
  expect(message).toContain("box: its text is clipped");
});

test("expectWholeWords ignores text only a screen reader hears", async ({ page }) => {
  await fixture(page, `<button data-testid="box"><span style="position:absolute;width:1px;height:1px;overflow:hidden;white-space:nowrap">Language</span>EN</button>`);
  await expectWholeWords(page, page.getByTestId("box"));
});

test("expectUncovered fails when a pill lies over a button", async ({ page }) => {
  await fixture(
    page,
    `<div data-testid="scope" style="position:relative"><button data-testid="go" style="width:120px;height:44px">Go</button>` +
      `<span data-testid="pill" style="position:absolute;left:0;top:0;width:60px;height:44px;background:#ccc">more</span></div>`,
  );
  const message = await failureOf(() => expectUncovered(page, page.getByTestId("scope")));
  expect(message).toContain("go:");
  expect(message).toContain("pill");
});

test("expectUncovered passes a row whose own empty button covers its words, and still fails on a stranger's", async ({ page }) => {
  await fixture(
    page,
    `<ul style="position:relative;margin:0;padding:0"><li style="position:relative;height:40px"><p data-testid="word" style="margin:0">Open</p><button data-testid="row-button" aria-label="Add" style="position:absolute;inset:0"></button></li></ul>`,
  );
  await expectUncovered(page, page.locator("ul"));
  await fixture(
    page,
    `<div style="position:relative"><p data-testid="word" style="margin:0">Open</p><button style="position:absolute;inset:0">Stranger</button></div>`,
  );
  expect(await failureOf(() => expectUncovered(page, page.locator("div")))).toContain("points are under");
});

test("expectUncovered passes a button with nothing over it, and ignores what a scroller hides", async ({ page }) => {
  await fixture(
    page,
    `<div data-testid="scope"><button data-testid="go" style="width:120px;height:44px">Go</button>` +
      `<div style="height:40px;overflow:auto"><p style="margin:0;height:30px">one</p><p data-testid="below" style="margin:0;height:30px">two</p></div></div>`,
  );
  await expectUncovered(page, page.getByTestId("scope"));
});

test("expectInsideViewport fails on a button below the fold", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 200 });
  await fixture(page, `<div data-testid="scope"><div style="height:300px"></div><button data-testid="late" style="height:44px">Late</button></div>`);
  const message = await failureOf(() => expectInsideViewport(page, page.getByTestId("scope")));
  expect(message).toContain("late:");
});

test("expectInsideViewport passes a button on screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 200 });
  await fixture(page, `<div data-testid="scope"><button data-testid="near" style="height:44px">Near</button></div>`);
  await expectInsideViewport(page, page.getByTestId("scope"));
});

test("expectMinText fails on 12 px text and passes 14 px", async ({ page }) => {
  await fixture(page, `<div data-testid="small" style="font-size:12px">tiny</div>`);
  const message = await failureOf(() => expectMinText(page, page.getByTestId("small"), 14));
  expect(message).toContain("small: \"tiny\" is 12px");
  await fixture(page, `<div data-testid="fine" style="font-size:14px">fine</div>`);
  await expectMinText(page, page.getByTestId("fine"), 14);
});

test("expectMinText counts the shell's zoom", async ({ page }) => {
  await fixture(page, `<div style="zoom:1.25"><div data-testid="zoomed" style="font-size:12px">grown</div></div>`);
  await expectMinText(page, page.getByTestId("zoomed"), 14);
});

test("expectWordedButtons fails on a button with only an icon, and exempts close and pause", async ({ page }) => {
  await fixture(
    page,
    `<div data-testid="scope"><button data-testid="mute"><svg width="20" height="20"></svg><span style="position:absolute;width:1px;height:1px;overflow:hidden">Mute</span></button>` +
      `<button data-testid="settings-close">×</button><button data-testid="pause">≡</button><button data-testid="ok">Okay</button></div>`,
  );
  const message = await failureOf(() => expectWordedButtons(page, page.getByTestId("scope")));
  expect(message).toContain("mute: no visible word");
  expect(message).not.toContain("settings-close");
  expect(message).not.toContain("pause:");
  expect(message).not.toContain("ok:");
});
