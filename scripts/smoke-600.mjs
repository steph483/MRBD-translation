import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "media-local");
const url = process.env.PREVIEW_URL || "http://127.0.0.1:4173/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(url, { waitUntil: "networkidle" });

const metaCapable = await page.locator('meta[name="mrbd-web-app-capable"]').getAttribute("content");
const metaDesc = await page.locator('meta[name="description"]').getAttribute("content");

await page.fill("#english-input", "Where is the train station?");
await page.click("#btn-translate");
await page.waitForSelector("#result-panel:not([hidden])", { timeout: 20000 });

const german = (await page.textContent("#german-text")).trim();
const phonetic = (await page.textContent("#phonetic-text")).trim();
const status = (await page.textContent("#status")).trim();

await page.click("#btn-save");
await page.waitForSelector("#saved-list .saved-item", { timeout: 5000 });

const overflowX = await page.evaluate(() => {
  const doc = document.documentElement;
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  };
});

await page.screenshot({
  path: path.join(outDir, "viewport-600.png"),
  fullPage: false,
});

console.log(
  JSON.stringify(
    {
      metaCapable,
      hasDescription: Boolean(metaDesc),
      german,
      phonetic,
      status,
      overflowX,
      consoleErrors: errors,
    },
    null,
    2
  )
);

if (metaCapable !== "yes") throw new Error("Missing mrbd-web-app-capable");
if (!german) throw new Error("No German translation");
if (!phonetic) throw new Error("No phonetic text");
if (overflowX.scrollWidth > overflowX.clientWidth + 2) {
  throw new Error(`Horizontal overflow at 600x600: ${JSON.stringify(overflowX)}`);
}
if (errors.length) throw new Error(`Console errors: ${errors.join(" | ")}`);

await browser.close();
console.log("SMOKE_OK");
