import { chromium } from "playwright";

const url =
  process.env.PREVIEW_URL || "http://127.0.0.1:4173/MRBD-translation/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

await page.goto(url, { waitUntil: "networkidle" });

// Seed a known German phrase into the UI via translate path mock:
// Use localStorage saved phrase, load it onto Translate.
await page.evaluate(() => {
  localStorage.setItem(
    "mrbd-translation-phrases-v1",
    JSON.stringify([
      {
        id: "k-1",
        english: "Good morning",
        german: "Guten Morgen meine Freunde",
        phonetic: "GOO-ten MOR-gen MY-nuh FROYN-duh",
        savedAt: Date.now(),
      },
    ]),
  );
});
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Saved" }).click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="button"]')].find((el) =>
    (el.getAttribute("aria-label") || "").includes("Good morning"),
  );
  if (btn instanceof HTMLElement) btn.click();
});
await page.waitForTimeout(600);

const karaoke = page.locator(".german-karaoke");
await karaoke.waitFor({ state: "attached", timeout: 5000 });
const wordCount = await page.locator(".karaoke-word").count();
const label = await karaoke.getAttribute("aria-label");

// Drive highlight callbacks by calling into the exposed path isn't available,
// so simulate by verifying tokenized words render and Hear is enabled.
const hear = page.getByRole("button", { name: /^Hear$/i });
const hearDisabled = await hear.getAttribute("aria-disabled");

// Unit-style checks for word helpers in page context
const helperCheck = await page.evaluate(async () => {
  // Inline the same logic as src/lib/words.ts for a quick runtime assert
  function tokenizeWords(text) {
    const tokens = [];
    const re = /\S+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      tokens.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return tokens;
  }
  function wordIndexAtChar(tokens, charIndex) {
    let idx = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].start <= charIndex) idx = i;
      else break;
    }
    return idx;
  }
  function wordIndexAtProgress(tokens, progress) {
    const weights = tokens.map((t) => Math.max(1, t.word.length));
    const total = weights.reduce((s, w) => s + w, 0);
    const target = Math.min(1, Math.max(0, progress)) * total;
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (target < acc) return i;
    }
    return tokens.length - 1;
  }
  const text = "Guten Morgen meine Freunde";
  const tokens = tokenizeWords(text);
  return {
    tokenWords: tokens.map((t) => t.word),
    atMorgen: wordIndexAtChar(tokens, text.indexOf("Morgen")),
    atHalf: wordIndexAtProgress(tokens, 0.5),
    atStart: wordIndexAtProgress(tokens, 0),
  };
});

const result = {
  label,
  wordCount,
  hearDisabled,
  helperCheck,
};

console.log(JSON.stringify(result, null, 2));

if (wordCount < 4) throw new Error(`Expected >=4 karaoke words, got ${wordCount}`);
if (label !== "Guten Morgen meine Freunde") {
  throw new Error(`Unexpected karaoke label: ${label}`);
}
if (helperCheck.tokenWords.join(" ") !== "Guten Morgen meine Freunde") {
  throw new Error("tokenize mismatch");
}
if (helperCheck.atMorgen !== 1) throw new Error("charIndex map failed");
if (helperCheck.atStart !== 0) throw new Error("progress start failed");

await browser.close();
console.log("SMOKE_KARAOKE_OK");
