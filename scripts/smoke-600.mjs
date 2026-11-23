import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "media-local");
fs.mkdirSync(outDir, { recursive: true });

const url =
  process.env.PREVIEW_URL || "http://127.0.0.1:4173/MRBD-translation/";
const storeShot =
  process.env.STORE_SHOT ||
  path.join(
    process.env.USERPROFILE || "",
    "AppData",
    "Local",
    "Cursor",
    "AgentStores",
    "cursor_agent_stores",
    "bc-ab582529-3cea-4453-8455-d6af67b04054",
    "files",
    "media",
    "mrbd-translation-layout-600.png",
  );

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

// Translate page should be default (right / home)
const heading = await page.getByRole("heading", { name: /EN\s*→\s*DE/i }).count();

const input = page.getByRole("textbox").first();
await input.click();
await input.fill("Where is the train station?");

const searchBtn = page.getByRole("button", { name: /search/i }).first();
await searchBtn.click();

await page.waitForTimeout(3500);

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

const shotPath = path.join(outDir, "viewport-600-layout.png");
await page.screenshot({ path: shotPath, fullPage: false });

if (storeShot) {
  fs.mkdirSync(path.dirname(storeShot), { recursive: true });
  fs.copyFileSync(shotPath, storeShot);
}

// Navigate to Saved via left tab if present
const savedNav = page.getByRole("button", { name: /saved/i }).first();
let savedEmptyOk = false;
if ((await savedNav.count()) > 0) {
  await savedNav.click();
  await page.waitForTimeout(500);
  const savedText = await page.locator("body").innerText();
  savedEmptyOk =
    /No saved phrases/i.test(savedText) || /Where is the train/i.test(savedText);
}

console.log(
  JSON.stringify(
    {
      metaCapable,
      hasDescription: Boolean(metaDesc),
      hasTranslateHeading: heading > 0,
      hasGerman,
      savedEmptyOk,
      bodySnippet: bodyText.slice(0, 500),
      overflowX,
      consoleErrors: errors,
      shotPath,
      storeShot,
    },
    null,
    2,
  ),
);

if (metaCapable !== "yes") throw new Error("Missing mrbd-web-app-capable");
if (heading < 1) throw new Error("Missing EN → DE heading");
if (!hasGerman) throw new Error("German translation not visible");
if (overflowX.scrollWidth > overflowX.clientWidth + 2) {
  throw new Error(`Horizontal overflow at 600x600: ${JSON.stringify(overflowX)}`);
}
if (errors.length) throw new Error(`Console errors: ${errors.join(" | ")}`);

await browser.close();
console.log("SMOKE_OK");
