/** In-memory cache of successful German TTS blobs (object URLs). */
const germanAudioCache = new Map<string, string>();

const LINGVA_HOSTS = [
  "https://lingva.ml",
  "https://lingva.garudalinux.org",
  "https://translate.plausibility.cloud",
  "https://lingva.lunar.icu",
] as const;

type StepError = { step: string; detail: string };

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
 * Also poke getVoices() which triggers loading on some engines.
 */
function waitForVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);

  return new Promise((resolve) => {
    const finish = (voices: SpeechSynthesisVoice[]) => {
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(voices);
    };

    const onChange = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) finish(voices);
    };

    // Trigger load
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) {
      finish(immediate);
      return;
    }

    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    const timer = window.setTimeout(() => {
      finish(window.speechSynthesis.getVoices());
    }, timeoutMs);

    // Second poke after a tick (helps some Chromium builds)
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

/**
 * Speak German text (never English phonetic).
 * Uses an explicit de voice when present; otherwise lang=de-DE so the
 * engine can still synthesize German (important on MRBD / limited voice lists).
 */
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

    // Cancel any prior utterance without tearing down mid-flight races
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

    // Some engines fire neither end nor error; don't hang Hear forever
    const watchdog = window.setTimeout(() => {
      settle(() => reject(new Error("speechSynthesis timeout")));
    }, 12000);

    utterance.onstart = () => {
      // started — keep waiting for end
    };
    utterance.onend = () => settle(() => resolve("voice-de"));
    utterance.onerror = (event) =>
      settle(() => reject(new Error(`speechSynthesis ${event.error || "error"}`)));

    try {
      window.speechSynthesis.speak(utterance);
      // Chrome quirk: paused synth needs resume
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

function playObjectUrl(
  audio: HTMLAudioElement,
  objectUrl: string,
): Promise<"audio"> {
  return new Promise((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve("audio");
    };
    const onError = () => {
      const code = audio.error?.code;
      cleanup();
      reject(new Error(`audio element error code=${code ?? "?"}`));
    };
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.src = objectUrl;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
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

function getCachedObjectUrl(german: string): string | null {
  return germanAudioCache.get(cacheKey(german)) ?? null;
}

function putCachedObjectUrl(german: string, objectUrl: string): void {
  const key = cacheKey(german);
  const previous = germanAudioCache.get(key);
  if (previous && previous !== objectUrl) {
    URL.revokeObjectURL(previous);
  }
  germanAudioCache.set(key, objectUrl);
  if (germanAudioCache.size > 40) {
    const oldest = germanAudioCache.keys().next().value;
    if (oldest) {
      const url = germanAudioCache.get(oldest);
      if (url) URL.revokeObjectURL(url);
      germanAudioCache.delete(oldest);
    }
  }
}

async function playNetworkGermanWithCache(
  audio: HTMLAudioElement,
  german: string,
  errors: StepError[],
): Promise<"network-de"> {
  const cached = getCachedObjectUrl(german);
  if (cached) {
    await playObjectUrl(audio, cached);
    return "network-de";
  }

  let lastError: unknown = null;
  for (const host of LINGVA_HOSTS) {
    const hostLabel = host.replace(/^https:\/\//, "");
    try {
      const blob = await fetchLingvaMp3(host, german);
      const objectUrl = URL.createObjectURL(blob);
      putCachedObjectUrl(german, objectUrl);
      await playObjectUrl(audio, objectUrl);
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
 * Order: cached network → de voice / lang=de-DE synth → Lingva network (retry).
 */
export async function playGermanNetworkTts(
  audio: HTMLAudioElement | null,
  german: string,
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
  const text = german.trim();
  if (!text) {
    return { result: "unavailable", status: "Nothing to play.", isError: true };
  }

  const errors: StepError[] = [];

  // Fast path: memory cache (skip stopSpeech teardown of a playing blob if same)
  if (audio) {
    const cached = getCachedObjectUrl(text);
    if (cached) {
      stopSpeech(audio);
      try {
        await playObjectUrl(audio, cached);
        return {
          result: "network-de",
          status: "Played German audio (cached).",
          isError: false,
        };
      } catch (err) {
        errors.push({ step: "cache", detail: errDetail(err) });
      }
    }
  }

  stopSpeech(audio);

  const deVoice = await findGermanVoice();

  // 1) Named German voice when the browser actually lists one
  if (deVoice) {
    try {
      await speakGermanText(text, deVoice);
      return {
        result: "voice-de",
        status: `Played German (device: ${deVoice.lang}/${deVoice.name}).`,
        isError: false,
      };
    } catch (err) {
      errors.push({
        step: `voice:${deVoice.lang}`,
        detail: errDetail(err),
      });
    }
  } else {
    errors.push({ step: "voices", detail: "no de-* voice listed yet" });
  }

  // 2) Network Lingva → blob (real German audio; CORS-friendly)
  const tryNetwork = async (): Promise<"network-de"> => {
    if (!audio) {
      throw new Error("audio element missing");
    }
    return playNetworkGermanWithCache(audio, text, errors);
  };

  try {
    stopSpeech(audio);
    await tryNetwork();
    return {
      result: "network-de",
      status: "Played German audio (Lingva).",
      isError: false,
    };
  } catch (err) {
    errors.push({ step: "network-1", detail: errDetail(err) });
  }

  // 3) Retry network once
  await new Promise((r) => window.setTimeout(r, 400));
  try {
    stopSpeech(audio);
    await tryNetwork();
    return {
      result: "network-de",
      status: "Played German audio (Lingva retry).",
      isError: false,
    };
  } catch (err) {
    errors.push({ step: "network-2", detail: errDetail(err) });
  }

  // 4) Last resort: speechSynthesis with lang=de-DE on German text
  //    (helps MRBD / locked-down networks when Lingva is blocked)
  try {
    stopSpeech(audio);
    await speakGermanText(text, null);
    return {
      result: "voice-de",
      status: "Played German (speechSynthesis lang=de-DE fallback).",
      isError: false,
    };
  } catch (err) {
    errors.push({ step: "synth-de-DE", detail: errDetail(err) });
  }

  return {
    result: "unavailable",
    status: `German Hear failed — ${formatErrors(errors)}`,
    isError: true,
  };
}

/**
 * Sounds-like: always browser speechSynthesis on the English phonetic text.
 */
export async function playPhoneticSpeech(
  audio: HTMLAudioElement | null,
  phonetic: string,
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
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
