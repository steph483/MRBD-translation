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

function formatErrors(errors: StepError[]): string {
  if (!errors.length) return "unknown";
  return errors.map((e) => `${e.step}: ${e.detail}`).join(" | ");
}

function errDetail(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export function stopSpeech(audio: HTMLAudioElement | null): void {
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

function speakGermanText(
  text: string,
  voice: SpeechSynthesisVoice | null,
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

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || "de-DE";
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      fn();
    };

    const watchdog = window.setTimeout(() => {
      settle(() => reject(new Error("speechSynthesis timeout")));
    }, 12000);

    utterance.onend = () => settle(() => resolve("voice-de"));
    utterance.onerror = (event) =>
      settle(() =>
        reject(new Error(`speechSynthesis ${event.error || "error"}`)),
      );

    try {
      window.speechSynthesis.speak(utterance);
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (err) {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

function speakEnglishPhonetic(text: string): Promise<"speechSynthesis"> {
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
    utterance.rate = 0.92;
    utterance.onend = () => resolve("speechSynthesis");
    utterance.onerror = (event) =>
      reject(new Error(`speechSynthesis ${event.error || "error"}`));
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Play a Blob via a fresh object URL each time so replays never reuse a
 * revoked/stale URL, and the Audio element always gets a new load cycle.
 */
function playBlob(
  audio: HTMLAudioElement,
  blob: Blob,
): Promise<"audio"> {
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      // Revoke after this play finishes; next Hear creates a new URL from Blob cache.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      fn();
    };

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

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.src = objectUrl;
      audio.load();
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
): Promise<"network-de"> {
  const cached = getCachedBlob(german);
  if (cached) {
    await playBlob(audio, cached);
    return "network-de";
  }

  let lastError: unknown = null;
  for (const host of LINGVA_HOSTS) {
    const hostLabel = host.replace(/^https:\/\//, "");
    try {
      const blob = await fetchLingvaMp3(host, german);
      putCachedBlob(german, blob);
      await playBlob(audio, blob);
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
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
  const generation = ++playbackGeneration;
  const stillCurrent = () => generation === playbackGeneration;

  const text = german.trim();
  if (!text) {
    return { result: "unavailable", status: "Nothing to play.", isError: true };
  }

  const errors: StepError[] = [];
  stopSpeech(audio);

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
    return { result, status, isError };
  };

  try {
    // Fast path: replay from Blob cache (fresh object URL each time)
    if (audio) {
      const cached = getCachedBlob(text);
      if (cached) {
        try {
          await playBlob(audio, cached);
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
        await speakGermanText(text, deVoice);
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
      return playNetworkGermanWithCache(audio, text, errors);
    };

    try {
      stopSpeech(audio);
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
      stopSpeech(audio);
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
      stopSpeech(audio);
      await speakGermanText(text, null);
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
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
  const generation = ++playbackGeneration;
  stopSpeech(audio);
  const text = phonetic.trim();
  if (!text) {
    return {
      result: "unavailable",
      status: "No sounds-like text to play.",
      isError: true,
    };
  }

  try {
    await speakEnglishPhonetic(text);
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
