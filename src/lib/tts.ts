/** In-memory cache of successful German TTS blobs (object URLs). */
const germanAudioCache = new Map<string, string>();

const LINGVA_HOSTS = [
  "https://lingva.ml",
  "https://lingva.garudalinux.org",
  "https://translate.plausibility.cloud",
] as const;

function chunkText(text: string, maxLen: number): string[] {
  const words = text.trim().split(/\s+/);
  const chunks: string[] = [];
  let currentChunk = "";
  for (const word of words) {
    const next = currentChunk ? `${currentChunk} ${word}` : word;
    if (next.length > maxLen && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = word;
    } else {
      currentChunk = next;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks.length ? chunks : [text];
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

function waitForVoices(timeoutMs = 800): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    }, timeoutMs);
  });
}

/** True German voice only — never an English voice reading phonetic text. */
export async function findGermanVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await waitForVoices();
  const deExact = voices.find((v) => /^de(-|$)/i.test(v.lang));
  if (deExact) return deExact;
  return voices.find((v) => /german|deutsch/i.test(v.name)) ?? null;
}

function speakWithSynthesis(
  text: string,
  options: { lang?: string; voice?: SpeechSynthesisVoice | null } = {},
): Promise<"speechSynthesis"> {
  return new Promise((resolve, reject) => {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      reject(new Error("Speech synthesis unavailable."));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang ?? options.voice?.lang ?? "en-US";
    if (options.voice) utterance.voice = options.voice;
    utterance.rate = 0.92;
    utterance.onend = () => resolve("speechSynthesis");
    utterance.onerror = () => reject(new Error("Speech synthesis failed."));
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
      cleanup();
      reject(new Error("Audio playback failed."));
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
      playPromise.catch(onError);
    }
  });
}

async function fetchLingvaMp3(host: string, text: string): Promise<Blob> {
  const url = `${host}/api/v1/audio/de/${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!res.ok) {
    throw new Error(`Lingva TTS HTTP ${res.status}`);
  }
  const data = (await res.json()) as { audio?: number[] };
  if (!data.audio || !Array.isArray(data.audio) || data.audio.length < 100) {
    throw new Error("Lingva TTS returned empty audio.");
  }
  return new Blob([new Uint8Array(data.audio)], { type: "audio/mpeg" });
}

async function fetchGermanMp3Blob(text: string): Promise<Blob> {
  let lastError: unknown = null;
  for (const host of LINGVA_HOSTS) {
    try {
      return await fetchLingvaMp3(host, text);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All German TTS hosts failed.");
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

  // Soft cap: keep last ~40 phrases
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
): Promise<"network-de"> {
  const cached = getCachedObjectUrl(german);
  if (cached) {
    await playObjectUrl(audio, cached);
    return "network-de";
  }

  // Lingva handles full phrases; chunk only very long text.
  const parts = chunkText(german, 200);
  if (parts.length === 1) {
    const blob = await fetchGermanMp3Blob(parts[0]);
    const objectUrl = URL.createObjectURL(blob);
    putCachedObjectUrl(german, objectUrl);
    await playObjectUrl(audio, objectUrl);
    return "network-de";
  }

  // Multi-chunk: play sequentially without caching the join
  for (const part of parts) {
    const partCached = getCachedObjectUrl(part);
    if (partCached) {
      await playObjectUrl(audio, partCached);
      continue;
    }
    const blob = await fetchGermanMp3Blob(part);
    const objectUrl = URL.createObjectURL(blob);
    putCachedObjectUrl(part, objectUrl);
    await playObjectUrl(audio, objectUrl);
  }
  return "network-de";
}

export type PlayResult =
  | "voice-de"
  | "network-de"
  | "speechSynthesis"
  | "unavailable";

async function attemptGermanPlayback(
  audio: HTMLAudioElement | null,
  text: string,
): Promise<{ result: Exclude<PlayResult, "unavailable" | "speechSynthesis"> }> {
  // 1) Desktop / browser German voice when available
  const deVoice = await findGermanVoice();
  if (deVoice) {
    await speakWithSynthesis(text, { lang: deVoice.lang, voice: deVoice });
    return { result: "voice-de" };
  }

  // 2) CORS-friendly Lingva network TTS → blob URL
  if (!audio) {
    throw new Error("Audio element missing for network TTS.");
  }
  await playNetworkGermanWithCache(audio, text);
  return { result: "network-de" };
}

/**
 * Hear: German only (de voice or German network TTS). Never English phonetic TTS.
 */
export async function playGermanNetworkTts(
  audio: HTMLAudioElement | null,
  german: string,
): Promise<{ result: PlayResult; status: string; isError: boolean }> {
  stopSpeech(audio);
  const text = german.trim();
  if (!text) {
    return {
      result: "unavailable",
      status: "Nothing to play.",
      isError: true,
    };
  }

  try {
    const first = await attemptGermanPlayback(audio, text);
    return {
      result: first.result,
      status:
        first.result === "voice-de"
          ? "Played German (device voice)."
          : "Played German audio.",
      isError: false,
    };
  } catch {
    // One retry after a short pause
    await new Promise((r) => window.setTimeout(r, 350));
    try {
      stopSpeech(audio);
      const second = await attemptGermanPlayback(audio, text);
      return {
        result: second.result,
        status:
          second.result === "voice-de"
            ? "Played German (device voice)."
            : "Played German audio.",
        isError: false,
      };
    } catch {
      return {
        result: "unavailable",
        status:
          "Couldn’t play German right now. Check the network, then try Hear again.",
        isError: true,
      };
    }
  }
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
    await speakWithSynthesis(text, { lang: "en-US" });
    return {
      result: "speechSynthesis",
      status: "Played sounds-like (English voice).",
      isError: false,
    };
  } catch {
    return {
      result: "unavailable",
      status: "Sounds-like speech failed. Read the phonetic text on screen.",
      isError: true,
    };
  }
}
