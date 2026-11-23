export type LangCode = "en" | "de" | "es" | "fr";

export type AppSettings = {
  sourceLang: LangCode;
  targetLang: LangCode;
  /** Speech / Hear rate; 1 = normal. */
  readingSpeed: number;
};

export const LANG_OPTIONS: ReadonlyArray<{
  code: LangCode;
  label: string;
}> = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  sourceLang: "en",
  targetLang: "de",
  readingSpeed: 1,
};

const STORAGE_KEY = "mrbd-translation-settings-v1";

const LANG_SET = new Set<LangCode>(LANG_OPTIONS.map((o) => o.code));

function isLang(value: unknown): value is LangCode {
  return typeof value === "string" && LANG_SET.has(value as LangCode);
}

export function langLabel(code: LangCode): string {
  return LANG_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export function isSupportedPair(source: LangCode, target: LangCode): boolean {
  return source === "en" && target === "de";
}

export function clampReadingSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.readingSpeed;
  return Math.min(1.5, Math.max(0.5, value));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const record = parsed as Record<string, unknown>;
    return {
      sourceLang: isLang(record.sourceLang)
        ? record.sourceLang
        : DEFAULT_SETTINGS.sourceLang,
      targetLang: isLang(record.targetLang)
        ? record.targetLang
        : DEFAULT_SETTINGS.targetLang,
      readingSpeed: clampReadingSpeed(
        typeof record.readingSpeed === "number"
          ? record.readingSpeed
          : DEFAULT_SETTINGS.readingSpeed,
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function persistSettings(settings: AppSettings): boolean {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        readingSpeed: clampReadingSpeed(settings.readingSpeed),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
