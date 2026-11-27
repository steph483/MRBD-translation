/** Word spans inside a phrase for karaoke highlight mapping. */
export type WordSpan = {
  word: string;
  /** Inclusive start index in the source string. */
  start: number;
  /** Exclusive end index in the source string. */
  end: number;
};

/** Split on whitespace; punctuation stays attached to the word. */
export function tokenizeWords(text: string): WordSpan[] {
  const tokens: WordSpan[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/** Map a speechSynthesis boundary charIndex to a word index. */
export function wordIndexAtChar(
  tokens: readonly WordSpan[],
  charIndex: number,
): number {
  if (!tokens.length) return -1;
  let idx = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start <= charIndex) idx = i;
    else break;
  }
  return idx;
}

/**
 * Approximate active word from playback progress (0..1).
 * Uses equal slices by default; prefers char-weighted when weights differ.
 */
export function wordIndexAtProgress(
  tokens: readonly WordSpan[],
  progress: number,
): number {
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
