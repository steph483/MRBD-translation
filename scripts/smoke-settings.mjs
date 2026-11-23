import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    "mrbd-translation-settings-600.png",
  );

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(url, { waitUntil: "networkidle" });

// Translate home
const hasPair = (await page.getByRole("heading", { name: /EN\s*→\s*DE/i }).count()) > 0;

// Open Settings via tab
const settingsTab = page.getByRole("button", { name: /settings/i }).first();
await settingsTab.click();
await page.waitForTimeout(400);
const body = await page.locator("body").innerText();
const hasSource = /Source language/i.test(body);
const hasTarget = /Target language/i.test(body);

const outDir = path.join(__dirname, "..", "media-local");
fs.mkdirSync(outDir, { recursive: true });
const localShot = path.join(outDir, "viewport-600-settings.png");
await page.screenshot({ path: localShot, fullPage: false });
fs.mkdirSync(path.dirname(storeShot), { recursive: true });
fs.copyFileSync(localShot, storeShot);

// Saved page empty state
const savedTab = page.getByRole("button", { name: /^saved$/i }).first();
await savedTab.click();
await page.waitForTimeout(400);
const savedBody = await page.locator("body").innerText();
const emptyOk = /No saved phrases/i.test(savedBody);
const noGoBtn = !/Go to Translate/i.test(savedBody);

console.log(
  JSON.stringify(
    { hasPair, hasSource, hasTarget, emptyOk, noGoBtn, consoleErrors: errors, storeShot },
    null,
    2,
  ),
);

if (!hasPair) throw new Error("Missing EN → DE on Translate");
if (!hasSource || !hasTarget) throw new Error("Settings missing language rows");
if (!emptyOk) throw new Error("Saved empty state missing");
if (!noGoBtn) throw new Error("Go to Translate should be gone");
if (errors.length) throw new Error(errors.join(" | "));

await browser.close();
console.log("SMOKE_SETTINGS_OK");
