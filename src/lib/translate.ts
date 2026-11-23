import { germanToEnglishPhonetic } from "./phonetics";
import type { Phrase } from "./types";

const TRANSLATE_URL = "https://api.mymemory.translated.net/get";

type MyMemoryResponse = {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
};

export async function translateEnglish(text: string): Promise<Phrase> {
  const q = text.trim();
  if (!q) {
    throw new Error("Enter an English phrase first.");
  }

  const url = `${TRANSLATE_URL}?q=${encodeURIComponent(q)}&langpair=en|de`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Translate request failed (${res.status}).`);
  }

  const data = (await res.json()) as MyMemoryResponse;
  const german = data.responseData?.translatedText;
  const status = Number(data.responseStatus);

  if (!german || (status && status !== 200)) {
    throw new Error(String(data.responseDetails || "Unknown translation error."));
  }

  const trimmed = german.trim();
  return {
    english: q,
    german: trimmed,
    phonetic: germanToEnglishPhonetic(trimmed),
  };
}
