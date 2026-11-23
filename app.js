import { germanToEnglishPhonetic } from "./phonetics.js";

const STORAGE_KEY = "mrbd-translation-phrases-v1";
const TRANSLATE_URL = "https://api.mymemory.translated.net/get";

const els = {
  input: document.getElementById("english-input"),
  translate: document.getElementById("btn-translate"),
  hear: document.getElementById("btn-hear"),
  save: document.getElementById("btn-save"),
  hearPhonetic: document.getElementById("btn-hear-phonetic"),
  status: document.getElementById("status"),
  resultPanel: document.getElementById("result-panel"),
  german: document.getElementById("german-text"),
  phonetic: document.getElementById("phonetic-text"),
  savedList: document.getElementById("saved-list"),
  savedEmpty: document.getElementById("saved-empty"),
  audio: document.getElementById("tts-audio"),
};

/** @type {{ english: string, german: string, phonetic: string } | null} */
let current = null;
/** @type {Array<{ id: string, english: string, german: string, phonetic: string, savedAt: number }>} */
let saved = loadSaved();

function setStatus(message, isError = false) {
  els.status.textContent = message || "";
  els.status.classList.toggle("error", Boolean(isError && message));
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSaved() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    setStatus("Could not save to local storage.", true);
  }
}

function showResult(phrase) {
  current = phrase;
  els.german.textContent = phrase.german;
  els.phonetic.textContent = phrase.phonetic;
  els.resultPanel.hidden = false;
  els.hear.disabled = false;
  els.save.disabled = false;
}

function clearResult() {
  current = null;
  els.resultPanel.hidden = true;
  els.hear.disabled = true;
  els.save.disabled = true;
  els.german.textContent = "";
  els.phonetic.textContent = "";
}

async function translateEnglish(text) {
  const q = text.trim();
  if (!q) {
    throw new Error("Enter an English phrase first.");
  }

  const url = `${TRANSLATE_URL}?q=${encodeURIComponent(q)}&langpair=en|de`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Translate request failed (${res.status}).`);
  }

  const data = await res.json();
  const german = data?.responseData?.translatedText;
  const status = Number(data?.responseStatus);

  if (!german || (status && status !== 200)) {
    const details = data?.responseDetails || "Unknown translation error.";
    throw new Error(String(details));
  }

  // MyMemory sometimes echoes the source when it cannot translate.
  if (german.trim().toLowerCase() === q.toLowerCase() && !/[äöüß]/i.test(german)) {
    // Still accept; many English loanwords look identical.
  }

  return {
    english: q,
    german: german.trim(),
    phonetic: germanToEnglishPhonetic(german.trim()),
  };
}

function chunkText(text, maxLen) {
  const words = text.trim().split(/\s+/);
  const chunks = [];
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

function networkTtsCandidates(chunk) {
  const q = encodeURIComponent(chunk);
  return [
    `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=de&q=${q}`,
    `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=de&q=${q}`,
    `https://dict.youdao.com/dictvoice?audio=${q}&le=de`,
  ];
}

function stopSpeech() {
  try {
    els.audio.pause();
    els.audio.removeAttribute("src");
    els.audio.load();
  } catch {
    /* ignore */
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function playAudioUrl(url) {
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
      els.audio.removeEventListener("ended", onEnded);
      els.audio.removeEventListener("error", onError);
    };

    els.audio.addEventListener("ended", onEnded);
    els.audio.addEventListener("error", onError);
    els.audio.src = url;
    const playPromise = els.audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(onError);
    }
  });
}

async function playNetworkGerman(german) {
  let lastError = null;
  for (const chunk of chunkText(german, 180)) {
    let played = false;
    for (const url of networkTtsCandidates(chunk)) {
      try {
        await playAudioUrl(url);
        played = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!played) throw lastError || new Error("Network TTS failed.");
  }
  return "network-de";
}

function speakWithSynthesis(text, lang = "en-US") {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
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

/**
 * Prefer real German network TTS; fall back to visible phonetic + English TTS.
 */
async function hearGerman(phrase, { preferPhonetic = false } = {}) {
  stopSpeech();
  if (!phrase?.german) return;

  if (preferPhonetic) {
    setStatus("Playing English sounds-like…");
    await speakWithSynthesis(phrase.phonetic || phrase.german, "en-US");
    setStatus("Played sounds-like (English voice).");
    return;
  }

  setStatus("Playing German audio…");
  try {
    await playNetworkGerman(phrase.german);
    setStatus("Played German audio.");
  } catch {
    setStatus("German TTS unavailable — playing sounds-like…");
    try {
      await speakWithSynthesis(phrase.phonetic || phrase.german, "en-US");
      setStatus("Played sounds-like fallback (English voice).");
    } catch {
      setStatus(
        "Audio unavailable. Read the German and sounds-like text on screen.",
        true
      );
    }
  }
}

async function onTranslate() {
  const text = els.input.value;
  els.translate.disabled = true;
  setStatus("Translating…");
  try {
    const phrase = await translateEnglish(text);
    showResult(phrase);
    setStatus("Ready — hear or save.");
  } catch (err) {
    clearResult();
    setStatus(err?.message || "Translation failed.", true);
  } finally {
    els.translate.disabled = false;
  }
}

function onSave() {
  if (!current) return;
  const exists = saved.some(
    (p) =>
      p.english.toLowerCase() === current.english.toLowerCase() &&
      p.german.toLowerCase() === current.german.toLowerCase()
  );
  if (exists) {
    setStatus("Already saved.");
    return;
  }

  saved.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    english: current.english,
    german: current.german,
    phonetic: current.phonetic,
    savedAt: Date.now(),
  });
  persistSaved();
  renderSaved();
  setStatus("Saved.");
}

function deleteSaved(id) {
  saved = saved.filter((p) => p.id !== id);
  persistSaved();
  renderSaved();
  setStatus("Removed.");
}

function loadSavedIntoCompose(phrase) {
  els.input.value = phrase.english;
  showResult({
    english: phrase.english,
    german: phrase.german,
    phonetic: phrase.phonetic,
  });
  setStatus("Loaded saved phrase.");
  els.input.focus();
}

function renderSaved() {
  els.savedList.replaceChildren();
  const hasItems = saved.length > 0;
  els.savedEmpty.hidden = hasItems;
  if (!hasItems) return;

  for (const phrase of saved) {
    const li = document.createElement("li");
    li.className = "saved-item";

    const en = document.createElement("p");
    en.className = "en";
    en.textContent = phrase.english;

    const de = document.createElement("p");
    de.className = "de";
    de.textContent = `${phrase.german} · ${phrase.phonetic}`;

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "btn";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => loadSavedIntoCompose(phrase));

    const hearBtn = document.createElement("button");
    hearBtn.type = "button";
    hearBtn.className = "btn";
    hearBtn.textContent = "Hear";
    hearBtn.addEventListener("click", () => hearGerman(phrase));

    const phonBtn = document.createElement("button");
    phonBtn.type = "button";
    phonBtn.className = "btn";
    phonBtn.textContent = "Sounds-like";
    phonBtn.addEventListener("click", () =>
      hearGerman(phrase, { preferPhonetic: true })
    );

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteSaved(phrase.id));

    actions.append(useBtn, hearBtn, phonBtn, delBtn);
    li.append(en, de, actions);
    els.savedList.append(li);
  }
}

els.translate.addEventListener("click", onTranslate);
els.hear.addEventListener("click", () => current && hearGerman(current));
els.hearPhonetic.addEventListener("click", () =>
  current ? hearGerman(current, { preferPhonetic: true }) : null
);
els.save.addEventListener("click", onSave);

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onTranslate();
  }
});

renderSaved();
setStatus("Enter English, then Translate.");
