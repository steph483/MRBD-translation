import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "media-local");
fs.mkdirSync(outDir, { recursive: true });

const url =
  process.env.PREVIEW_URL || "http://127.0.0.1:4173/MRBD-translation/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(url, { waitUntil: "networkidle" });

const metaCapable = await page
  .locator('meta[name="mrbd-web-app-capable"]')
  .getAttribute("content");
const metaDesc = await page
  .locator('meta[name="description"]')
  .getAttribute("content");

const input = page.getByRole("textbox").first();
await input.click();
await input.fill("Where is the train station?");

const translateBtn = page.getByRole("button", { name: /translate/i }).first();
await translateBtn.click();

await page.waitForTimeout(3000);

const bodyText = await page.locator("body").innerText();
const hasGerman = /Bahnhof|bahnhof|Wo ist/i.test(bodyText);
const overflowX = await page.evaluate(() => {
  const doc = document.documentElement;
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  };
});

const shotPath = path.join(outDir, "viewport-600-toolkit.png");
await page.screenshot({ path: shotPath, fullPage: false });

console.log(
  JSON.stringify(
    {
      metaCapable,
      hasDescription: Boolean(metaDesc),
      hasGerman,
      bodySnippet: bodyText.slice(0, 500),
      overflowX,
      consoleErrors: errors,
      shotPath,
    },
    null,
    2,
  ),
);

if (metaCapable !== "yes") throw new Error("Missing mrbd-web-app-capable");
if (!hasGerman) throw new Error("German translation not visible");
if (overflowX.scrollWidth > overflowX.clientWidth + 2) {
  throw new Error(`Horizontal overflow at 600x600: ${JSON.stringify(overflowX)}`);
}
if (errors.length) throw new Error(`Console errors: ${errors.join(" | ")}`);

await browser.close();
console.log("SMOKE_OK");
