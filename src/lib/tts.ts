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

function networkTtsCandidates(chunk: string): string[] {
  const q = encodeURIComponent(chunk);
  return [
    `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=de&q=${q}`,
    `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=de&q=${q}`,
    `https://dict.youdao.com/dictvoice?audio=${q}&le=de`,
  ];
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

function playAudioUrl(audio: HTMLAudioElement, url: string): Promise<"audio"> {
  return new Promise((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve("audio");
    };
    const onError = () => {
      cleanup();
      reject(new Error("Network TTS failed."));
    };
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.src = url;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(onError);
    }
  });
}

async function playNetworkGerman(
  audio: HTMLAudioElement,
  german: string,
): Promise<"network-de"> {
  let lastError: unknown = null;
  for (const chunk of chunkText(german, 180)) {
    let played = false;
    for (const url of networkTtsCandidates(chunk)) {
      try {
        await playAudioUrl(audio, url);
        played = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!played) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Network TTS failed.");
    }
  }
  return "network-de";
}

function speakWithSynthesis(
  text: string,
  lang = "en-US",
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
    utterance.lang = lang;
    utterance.rate = 0.92;
    utterance.onend = () => resolve("speechSynthesis");
    utterance.onerror = () => reject(new Error("Speech synthesis failed."));
    window.speechSynthesis.speak(utterance);
  });
}

export type PlayResult = "network-de" | "speechSynthesis" | "unavailable";

/**
 * Hear: German network TTS only — never falls back to speechSynthesis.
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
  if (!audio) {
    return {
      result: "unavailable",
      status: "German audio player unavailable. Check the network and try again.",
      isError: true,
    };
  }

  try {
    await playNetworkGerman(audio, text);
    return {
      result: "network-de",
      status: "Played German audio.",
      isError: false,
    };
  } catch {
    return {
      result: "unavailable",
      status:
        "German audio failed. Check your connection and try Hear again — or use Sounds-like.",
      isError: true,
    };
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
    await speakWithSynthesis(text, "en-US");
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
