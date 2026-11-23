import type { SavedPhrase } from "./types";

const STORAGE_KEY = "mrbd-translation-phrases-v1";

export function loadSavedPhrases(): SavedPhrase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPhrase[]) : [];
  } catch {
    return [];
  }
}

export function persistSavedPhrases(phrases: SavedPhrase[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
    return true;
  } catch {
    return false;
  }
}
