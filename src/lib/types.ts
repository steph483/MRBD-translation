export type Phrase = {
  english: string;
  german: string;
  phonetic: string;
};

export type SavedPhrase = Phrase & {
  id: string;
  savedAt: number;
};
