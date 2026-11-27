import { useMemo, type ReactNode } from "react";
import { TextColor, TextStyle, TextView } from "@wearables-ui-toolkit/mrbd";
import { tokenizeWords } from "../lib/words";

type Props = {
  text: string;
  /** Active word index while Hear plays; null/negative clears highlight. */
  activeWordIndex?: number | null;
};

/**
 * Renders German text with karaoke-style emphasis on the active word.
 * Inactive words stay BODY1_EMPHASIZED; the active word steps up to HEADING2 + ACCENT.
 */
export function GermanKaraokeText({ text, activeWordIndex = null }: Props) {
  const tokens = useMemo(() => tokenizeWords(text), [text]);

  if (!tokens.length) {
    return (
      <TextView as="p" textStyle={TextStyle.BODY1_EMPHASIZED}>
        {text}
      </TextView>
    );
  }

  const pieces: ReactNode[] = [];
  let cursor = 0;

  tokens.forEach((token, wordIndex) => {
    if (token.start > cursor) {
      pieces.push(
        <span key={`gap-${cursor}`} className="karaoke-gap">
          {text.slice(cursor, token.start)}
        </span>,
      );
    }
    const active =
      activeWordIndex != null &&
      activeWordIndex >= 0 &&
      activeWordIndex === wordIndex;
    pieces.push(
      <TextView
        key={`w-${wordIndex}-${token.start}`}
        as="span"
        textStyle={active ? TextStyle.HEADING2 : TextStyle.BODY1_EMPHASIZED}
        textColor={active ? TextColor.ACCENT : TextColor.PRIMARY}
        className={
          active ? "karaoke-word karaoke-word--active" : "karaoke-word"
        }
      >
        {token.word}
      </TextView>,
    );
    cursor = token.end;
  });

  if (cursor < text.length) {
    pieces.push(
      <span key={`tail-${cursor}`} className="karaoke-gap">
        {text.slice(cursor)}
      </span>,
    );
  }

  return (
    <p className="german-karaoke" aria-label={text}>
      {pieces}
    </p>
  );
}
