import {
  tokenizeWords,
  wordIndexAtChar,
  wordIndexAtProgress,
  type WordSpan,
} from "./words";

/** In-memory cache of successful German TTS as Blobs (not object URLs). */
const germanAudioCache = new Map<string, Blob>();

const LINGVA_HOSTS = [
  "https://lingva.ml",
  "https://lingva.garudalinux.org",
  "https://translate.plausibility.cloud",
  "https://lingva.lunar.icu",
] as const;

type StepError = { step: string; detail: string };

/** Bumps on every Hear/Sounds-like so stale async work can bail out. */
let playbackGeneration = 0;

/** Karaoke word index while German Hear plays; null clears. */
export type WordHighlightHandler = (wordIndex: number | null) => void;

export type GermanPlayOptions = {
  rate?: number;
  onWordHighlight?: WordHighlightHandler;
};

function formatErrors(errors: StepError[]): string {
  if (!errors.length) return "unknown";
  return errors.map((e) => `${e.step}: ${e.detail}`).join(" | ");
}

function errDetail(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export function stopSpeech(audio: HTMLAudioElement | null): void {
  // Supersede in-flight Hear/Sounds-like so stale boundary/timeupdate can't paint.
  playbackGeneration += 1;
  if (audio) {
    try {
      audio.pause();
      // Reset element cleanly for the next play(); avoid leaving MEDIA_ERR state.
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* ignore */
    }
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Wait for voices — Chrome often returns [] until voiceschanged.
 * Must not reference `timer` before it is initialized (TDZ crash on 2nd Hear).
 */
function waitForVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);

  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;

    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(voices);
    };

    const onChange = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) finish(voices);
    };

    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    timer = window.setTimeout(() => {
      finish(window.speechSynthesis.getVoices());
    }, timeoutMs);

    window.setTimeout(() => {
      const again = window.speechSynthesis.getVoices();
      if (again.length > 0) finish(again);
    }, 50);
  });
}

export async function findGermanVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await waitForVoices();
  const byLang = voices.find((v) => /^de([_-]|$)/i.test(v.lang));
  if (byLang) return byLang;
  return voices.find((v) => /german|deutsch/i.test(v.name)) ?? null;
}

function clampRate(rate: number | undefined): number {
  if (rate == null || !Number.isFinite(rate)) return 1;
  return Math.min(1.5, Math.max(0.5, rate));
}

function emitWord(
  onWordHighlight: WordHighlightHandler | undefined,
  stillCurrent: () => boolean,
  wordIndex: number | null,
): void {
  if (!onWordHighlight || !stillCurrent()) return;
  onWordHighlight(wordIndex);
}

/**
 * speechSynthesis German path — prefer `boundary` events; fall back to
 * equal-time word ticks if the engine never fires boundaries.
 */
function speakGermanText(
  text: string,
  voice: SpeechSynthesisVoice | null,
  rate = 1,
  onWordHighlight?: WordHighlightHandler,
  stillCurrent: () => boolean = () => true,
): Promise<"voice-de"> {
  return new Promise((resolve, reject) => {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      reject(new Error("speechSynthesis missing"));
      return;
    }

    window.speechSynthesis.cancel();

    const tokens = tokenizeWords(text);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || "de-DE";
    if (voice) utterance.voice = voice;
    const playRate = clampRate(rate);
    utterance.rate = playRate * 0.95;

    let settled = false;
    let sawBoundary = false;
    let fallbackTimer = 0;
    let tickTimer = 0;
    let lastIndex = -1;

    const clearTimers = () => {
      window.clearTimeout(fallbackTimer);
      window.clearInterval(tickTimer);
    };

    const paint = (index: number | null) => {
      if (index === lastIndex) return;
      lastIndex = index ?? -2;
      emitWord(onWordHighlight, stillCurrent, index);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimers();
      window.clearTimeout(watchdog);
      paint(null);
      fn();
    };

    const startFallbackTicks = () => {
      if (sawBoundary || !tokens.length || !onWordHighlight) return;
      const msPerWord = Math.max(180, 420 / playRate);
      let i = 0;
      paint(0);
      tickTimer = window.setInterval(() => {
        if (!stillCurrent() || settled) {
          window.clearInterval(tickTimer);
          return;
        }
        i += 1;
        if (i >= tokens.length) {
          window.clearInterval(tickTimer);
          return;
        }
        paint(i);
      }, msPerWord);
    };

    const watchdog = window.setTimeout(() => {
      settle(() => reject(new Error("speechSynthesis timeout")));
    }, 12000);

    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (!stillCurrent() || settled) return;
      // Chromium: word boundaries; some engines omit `name`.
      if (event.name && event.name !== "word") return;
      if (typeof event.charIndex !== "number") return;
      sawBoundary = true;
      clearTimers();
      paint(wordIndexAtChar(tokens, event.charIndex));
    };

    utterance.onend = () => settle(() => resolve("voice-de"));
    utterance.onerror = (event) =>
      settle(() =>
        reject(new Error(`speechSynthesis ${event.error || "error"}`)),
      );

    try {
      if (onWordHighlight && tokens.length) {
        // If boundary never arrives (common on some engines), approximate.
        fallbackTimer = window.setTimeout(startFallbackTicks, 280);
      }
      window.speechSynthesis.speak(utterance);
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (err) {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

function speakEnglishPhonetic(
  text: string,
  rate = 1,
): Promise<"speechSynthesis"> {
  return new Promise((resolve, reject) => {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      reject(new Error("speechSynthesis missing"));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = clampRate(rate) * 0.92;
    utterance.onend = () => resolve("speechSynthesis");
    utterance.onerror = (event) =>
      reject(new Error(`speechSynthesis ${event.error || "error"}`));
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Play a Blob via a fresh object URL each time so replays never reuse a
 * revoked/stale URL, and the Audio element always gets a new load cycle.
 * Word highlight uses duration × weighted word progress.
 */
function playBlob(
  audio: HTMLAudioElement,
  blob: Blob,
  rate = 1,
  tokens: readonly WordSpan[] = [],
  onWordHighlight?: WordHighlightHandler,
  stillCurrent: () => boolean = () => true,
): Promise<"audio"> {
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    let settled = false;
    let lastIndex = -1;

    const paint = (index: number | null) => {
      if (index === lastIndex) return;
      lastIndex = index ?? -2;
      emitWord(onWordHighlight, stillCurrent, index);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onMeta);
      try {
        audio.playbackRate = 1;
      } catch {
        /* ignore */
      }
      paint(null);
      // Revoke after this play finishes; next Hear creates a new URL from Blob cache.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      fn();
    };

    const syncFromTime = () => {
      if (!stillCurrent() || settled || !tokens.length) return;
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const progress = Math.min(1, Math.max(0, audio.currentTime / dur));
      paint(wordIndexAtProgress(tokens, progress));
    };

    const onTimeUpdate = () => syncFromTime();
    const onMeta = () => syncFromTime();

    const onEnded = () => settle(() => resolve("audio"));
    const onError = () => {
      const code = audio.error?.code;
      settle(() => reject(new Error(`audio element error code=${code ?? "?"}`)));
    };

    // Guard against engines that never fire ended/error
    const watchdog = window.setTimeout(() => {
      settle(() => reject(new Error("audio playback timeout")));
    }, 20000);

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onMeta);

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.src = objectUrl;
      audio.load();
      audio.playbackRate = clampRate(rate);
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch((err: unknown) => {
          settle(() =>
            reject(err instanceof Error ? err : new Error(String(err))),
          );
        });
      }
    } catch (err) {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

async function fetchLingvaMp3(host: string, text: string): Promise<Blob> {
  const url = `${host}/api/v1/audio/de/${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { audio?: number[] };
    if (!data.audio || !Array.isArray(data.audio) || data.audio.length < 100) {
      throw new Error("empty audio array");
    }
    const bytes = Uint8Array.from(data.audio);
    return new Blob([bytes], { type: "audio/mpeg" });
  } finally {
    window.clearTimeout(timer);
  }
}

function cacheKey(german: string): string {
  return german.trim();
}

function getCachedBlob(german: string): Blob | null {
  return germanAudioCache.get(cacheKey(german)) ?? null;
}

function putCachedBlob(german: string, blob: Blob): void {
  const key = cacheKey(german);
  germanAudioCache.set(key, blob);
  if (germanAudioCache.size > 40) {
    const oldest = germanAudioCache.keys().next().value;
    if (oldest) germanAudioCache.delete(oldest);
  }
}

async function playNetworkGermanWithCache(
  audio: HTMLAudioElement,
  german: string,
  errors: StepError[],
  rate = 1,
  tokens: readonly WordSpan[] = [],
  onWordHighlight?: WordHighlightHandler,
  stillCurrent: () => boolean = () => true,
): Promise<"network-de"> {
  const cached = getCachedBlob(german);
  if (cached) {
    await playBlob(audio, cached, rate, tokens, onWordHighlight, stillCurrent);
    return "network-de";
  }

  let lastError: unknown = null;
  for (const host of LINGVA_HOSTS) {
    const hostLabel = host.replace(/^https:\/\//, "");
    try {
      const blob = await fetchLingvaMp3(host, german);
      putCachedBlob(german, blob);
      await playBlob(audio, blob, rate, tokens, onWordHighlight, stillCurrent);
      return "network-de";
    } catch (err) {
      lastError = err;
      errors.push({ step: hostLabel, detail: errDetail(err) });
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All German TTS hosts failed.");
}

export type PlayResult =
  | "voice-de"
  | "network-de"
  | "speechSynthesis"
  | "unavailable";

/**
 * Hear: German only — never English phonetic TTS.
 * Safe to call repeatedly; supersedes any in-flight Hear.
 */
export async function playGermanNetworkTts(
  audio: HTMLAudioElement | null,
  german: string,
  rateOrOptions: number | GermanPlayOptions = 1,
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
  const options: GermanPlayOptions =
    typeof rateOrOptions === "number"
      ? { rate: rateOrOptions }
      : rateOrOptions;
  const playRate = clampRate(options.rate);
  const onWordHighlight = options.onWordHighlight;

  // Capture generation after stopSpeech so Clear/supersede can't race us stale.
  stopSpeech(audio);
  const generation = playbackGeneration;
  const stillCurrent = () => generation === playbackGeneration;

  const text = german.trim();
  const tokens = tokenizeWords(text);
  if (!text) {
    onWordHighlight?.(null);
    return { result: "unavailable", status: "Nothing to play.", isError: true };
  }

  const errors: StepError[] = [];

  const done = (
    result: PlayResult,
    status: string,
    isError: boolean,
  ): { result: PlayResult; status: string; isError: boolean } => {
    if (!stillCurrent()) {
      return {
        result: "unavailable",
        status: "Superseded by a newer Hear.",
        isError: false,
      };
    }
    emitWord(onWordHighlight, stillCurrent, null);
    return { result, status, isError };
  };

  try {
    // Fast path: replay from Blob cache (fresh object URL each time)
    if (audio) {
      const cached = getCachedBlob(text);
      if (cached) {
        try {
          await playBlob(
            audio,
            cached,
            playRate,
            tokens,
            onWordHighlight,
            stillCurrent,
          );
          return done("network-de", "Played German audio (cached).", false);
        } catch (err) {
          // Drop bad cache entry and continue
          germanAudioCache.delete(cacheKey(text));
          errors.push({ step: "cache", detail: errDetail(err) });
        }
      }
    }

    if (!stillCurrent()) {
      return done("unavailable", "Superseded by a newer Hear.", false);
    }

    const deVoice = await findGermanVoice();
    if (!stillCurrent()) {
      return done("unavailable", "Superseded by a newer Hear.", false);
    }

    // 1) Named German voice when listed
    if (deVoice) {
      try {
        await speakGermanText(
          text,
          deVoice,
          playRate,
          onWordHighlight,
          stillCurrent,
        );
        return done(
          "voice-de",
          `Played German (device: ${deVoice.lang}/${deVoice.name}).`,
          false,
        );
      } catch (err) {
        errors.push({
          step: `voice:${deVoice.lang}`,
          detail: errDetail(err),
        });
      }
    } else {
      errors.push({ step: "voices", detail: "no de-* voice listed yet" });
    }

    if (!stillCurrent()) {
      return done("unavailable", "Superseded by a newer Hear.", false);
    }

    // 2) Network Lingva
    const tryNetwork = async (): Promise<"network-de"> => {
      if (!audio) throw new Error("audio element missing");
      return playNetworkGermanWithCache(
        audio,
        text,
        errors,
        playRate,
        tokens,
        onWordHighlight,
        stillCurrent,
      );
    };

    try {
      if (!stillCurrent()) {
        return done("unavailable", "Superseded by a newer Hear.", false);
      }
      await tryNetwork();
      return done("network-de", "Played German audio (Lingva).", false);
    } catch (err) {
      errors.push({ step: "network-1", detail: errDetail(err) });
    }

    if (!stillCurrent()) {
      return done("unavailable", "Superseded by a newer Hear.", false);
    }

    // 3) Retry network once
    await new Promise((r) => window.setTimeout(r, 400));
    if (!stillCurrent()) {
      return done("unavailable", "Superseded by a newer Hear.", false);
    }

    try {
      await tryNetwork();
      return done("network-de", "Played German audio (Lingva retry).", false);
    } catch (err) {
      errors.push({ step: "network-2", detail: errDetail(err) });
    }

    if (!stillCurrent()) {
      return done("unavailable", "Superseded by a newer Hear.", false);
    }

    // 4) lang=de-DE speechSynthesis on German text
    try {
      await speakGermanText(text, null, playRate, onWordHighlight, stillCurrent);
      return done(
        "voice-de",
        "Played German (speechSynthesis lang=de-DE fallback).",
        false,
      );
    } catch (err) {
      errors.push({ step: "synth-de-DE", detail: errDetail(err) });
    }

    return done(
      "unavailable",
      `German Hear failed — ${formatErrors(errors)}`,
      true,
    );
  } catch (err) {
    // Never leave the UI hanging on "Playing…"
    return done(
      "unavailable",
      `German Hear failed — unexpected: ${errDetail(err)}`,
      true,
    );
  }
}

/**
 * Sounds-like: always browser speechSynthesis on the English phonetic text.
 */
export async function playPhoneticSpeech(
  audio: HTMLAudioElement | null,
  phonetic: string,
  rate = 1,
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
  stopSpeech(audio);
  const generation = playbackGeneration;
  const text = phonetic.trim();
  if (!text) {
    return {
      result: "unavailable",
      status: "No sounds-like text to play.",
      isError: true,
    };
  }

  try {
    await speakEnglishPhonetic(text, rate);
    if (generation !== playbackGeneration) {
      return {
        result: "unavailable",
        status: "Superseded by a newer play.",
        isError: false,
      };
    }
    return {
      result: "speechSynthesis",
      status: "Played sounds-like (English voice).",
      isError: false,
    };
  } catch (err) {
    return {
      result: "unavailable",
      status: `Sounds-like failed — ${errDetail(err)}`,
      isError: true,
    };
  }
}
