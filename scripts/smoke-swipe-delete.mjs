import { chromium } from "playwright";

const url =
  process.env.PREVIEW_URL || "http://127.0.0.1:4173/MRBD-translation/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

await page.goto(url, { waitUntil: "networkidle" });

await page.evaluate(() => {
  localStorage.setItem(
    "mrbd-translation-phrases-v1",
    JSON.stringify([
      {
        id: "test-1",
        english: "Hello",
        german: "Hallo",
        phonetic: "HAH-loh",
        savedAt: Date.now(),
      },
    ]),
  );
});
await page.reload({ waitUntil: "networkidle" });

await page.getByRole("tab", { name: "Saved" }).click();
await page.waitForTimeout(500);

const focused = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="button"]')].find((el) =>
    (el.getAttribute("aria-label") || "").includes("Hello"),
  );
  if (!(btn instanceof HTMLElement)) return { found: false };
  btn.focus();
  return { found: true, label: btn.getAttribute("aria-label") };
});
if (!focused.found) throw new Error("Saved row not found");

await page.keyboard.down("ArrowLeft");
await page.keyboard.up("ArrowLeft");
await page.waitForTimeout(600);

const afterLeft = await page.evaluate(() => {
  const del = [...document.querySelectorAll('[role="button"]')].find(
    (el) => el.getAttribute("aria-label") === "Delete",
  );
  const tray = del?.closest("[aria-hidden]");
  return {
    tablist: document.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
    deleteTabIndex: del instanceof HTMLElement ? del.tabIndex : null,
    trayHidden: tray?.getAttribute("aria-hidden") ?? null,
    body: document.body.innerText,
  };
});

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="button"]')].find((el) =>
    (el.getAttribute("aria-label") || "").includes("Hello"),
  );
  if (btn instanceof HTMLElement) btn.focus();
});
await page.keyboard.down("ArrowRight");
await page.keyboard.up("ArrowRight");
await page.waitForTimeout(500);

const afterRight = await page.evaluate(
  () => document.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
);

const result = {
  focused,
  afterLeft,
  stayedOnSaved: /Saved/i.test(afterLeft.tablist || ""),
  deleteRevealed:
    afterLeft.deleteTabIndex === 0 && afterLeft.trayHidden === "false",
  afterRight,
  wentToTranslate: /Translate/i.test(afterRight || ""),
};

console.log(JSON.stringify(result, null, 2));

if (!result.stayedOnSaved) {
  throw new Error("ArrowLeft navigated away from Saved");
}
if (!result.deleteRevealed) {
  throw new Error("ArrowLeft did not reveal Delete");
}
if (!result.wentToTranslate) {
  throw new Error("ArrowRight did not go to Translate");
}

await browser.close();
console.log("SMOKE_SWIPE_DELETE_OK");
