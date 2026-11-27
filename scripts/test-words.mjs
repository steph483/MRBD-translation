import assert from "node:assert/strict";

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
  if (!tokens.length) return -1;
  let idx = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start <= charIndex) idx = i;
    else break;
  }
  return idx;
}

function wordIndexAtProgress(tokens, progress) {
  if (!tokens.length) return -1;
  const p = Math.min(1, Math.max(0, progress));
  if (p >= 1) return tokens.length - 1;
  const weights = tokens.map((t) => Math.max(1, t.word.length));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let acc = 0;
  const target = p * total;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (target < acc) return i;
  }
  return tokens.length - 1;
}

const text = "Guten Morgen, Welt!";
const tokens = tokenizeWords(text);
assert.deepEqual(
  tokens.map((t) => t.word),
  ["Guten", "Morgen,", "Welt!"],
);
assert.equal(wordIndexAtChar(tokens, 0), 0);
assert.equal(wordIndexAtChar(tokens, text.indexOf("Morgen")), 1);
assert.equal(wordIndexAtChar(tokens, text.indexOf("Welt")), 2);
assert.equal(wordIndexAtProgress(tokens, 0), 0);
assert.equal(wordIndexAtProgress(tokens, 1), 2);
assert.equal(wordIndexAtProgress([], 0.5), -1);

console.log("TEST_WORDS_OK");
