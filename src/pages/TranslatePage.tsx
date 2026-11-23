import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ButtonGroup,
  ButtonGroupAlignment,
  InputTextView,
  ListItem,
  Page,
  TextColor,
  TextStyle,
  TextView,
  VerticalList,
} from "@wearables-ui-toolkit/mrbd";
import { loadSavedPhrases, persistSavedPhrases } from "../lib/storage";
import { translateEnglish } from "../lib/translate";
import {
  playGermanNetworkTts,
  playPhoneticSpeech,
  stopSpeech,
} from "../lib/tts";
import type { Phrase, SavedPhrase } from "../lib/types";

export function TranslatePage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [english, setEnglish] = useState("");
  const [current, setCurrent] = useState<Phrase | null>(null);
  const [saved, setSaved] = useState<SavedPhrase[]>(() => loadSavedPhrases());
  const [status, setStatus] = useState("Enter English, then Translate.");
  const [statusError, setStatusError] = useState(false);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audio.setAttribute("referrerpolicy", "no-referrer");
    audio.hidden = true;
    document.body.appendChild(audio);
    audioRef.current = audio;
    return () => {
      stopSpeech(audio);
      audio.remove();
      audioRef.current = null;
    };
  }, []);

  const alreadySaved = useMemo(() => {
    if (!current) return false;
    return saved.some(
      (p) =>
        p.english.toLowerCase() === current.english.toLowerCase() &&
        p.german.toLowerCase() === current.german.toLowerCase(),
    );
  }, [current, saved]);

  const updateStatus = useCallback((message: string, isError = false) => {
    setStatus(message);
    setStatusError(isError);
  }, []);

  const persist = useCallback(
    (next: SavedPhrase[]) => {
      setSaved(next);
      if (!persistSavedPhrases(next)) {
        updateStatus("Could not save to local storage.", true);
      }
    },
    [updateStatus],
  );

  const onTranslate = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value) {
        updateStatus("Enter an English phrase first.", true);
        return;
      }
      setEnglish(value);
      setTranslating(true);
      updateStatus("Translating…");
      try {
        const phrase = await translateEnglish(value);
        setCurrent(phrase);
        updateStatus("Ready — hear or save.");
      } catch (err) {
        setCurrent(null);
        updateStatus(
          err instanceof Error ? err.message : "Translation failed.",
          true,
        );
      } finally {
        setTranslating(false);
      }
    },
    [updateStatus],
  );

  const onHearGerman = useCallback(async () => {
    if (!current) return;
    const phrase = current.german;
    updateStatus("Playing German audio…");
    try {
      const { status: nextStatus, isError } = await playGermanNetworkTts(
        audioRef.current,
        phrase,
      );
      // Ignore superseded plays so a newer Hear owns the status line
      if (nextStatus === "Superseded by a newer Hear.") return;
      updateStatus(nextStatus, isError);
    } catch (err) {
      updateStatus(
        err instanceof Error
          ? `German Hear failed — ${err.message}`
          : "German Hear failed.",
        true,
      );
    }
  }, [current, updateStatus]);

  const onHearPhonetic = useCallback(async () => {
    if (!current) return;
    updateStatus("Playing English sounds-like…");
    try {
      const { status: nextStatus, isError } = await playPhoneticSpeech(
        audioRef.current,
        current.phonetic,
      );
      if (nextStatus === "Superseded by a newer play.") return;
      updateStatus(nextStatus, isError);
    } catch (err) {
      updateStatus(
        err instanceof Error
          ? `Sounds-like failed — ${err.message}`
          : "Sounds-like failed.",
        true,
      );
    }
  }, [current, updateStatus]);

  const onSave = useCallback(() => {
    if (!current) return;
    if (alreadySaved) {
      updateStatus("Already saved.");
      return;
    }
    const entry: SavedPhrase = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      english: current.english,
      german: current.german,
      phonetic: current.phonetic,
      savedAt: Date.now(),
    };
    persist([entry, ...saved]);
    updateStatus("Saved.");
  }, [alreadySaved, current, persist, saved, updateStatus]);

  const onDeleteSaved = useCallback(
    (id: string) => {
      persist(saved.filter((p) => p.id !== id));
      updateStatus("Removed.");
    },
    [persist, saved, updateStatus],
  );

  const onUseSaved = useCallback(
    (phrase: SavedPhrase) => {
      setEnglish(phrase.english);
      setCurrent({
        english: phrase.english,
        german: phrase.german,
        phonetic: phrase.phonetic,
      });
      updateStatus("Loaded saved phrase.");
    },
    [updateStatus],
  );

  return (
    <Page headerText="EN → DE" headerMetadata="Translate">
      <div className="page-shell">
        <VerticalList insetForHeader ariaLabel="Translation">
          <div className="content-stack">
            <div className="composer">
              <InputTextView
                text={english}
                onTextChange={setEnglish}
                hint="English phrase"
                actionLabel="Translate"
                showLoader={translating}
                loadingLabel="Translating"
                onSend={onTranslate}
                inputProps={{ maxLength: 280, autoComplete: "off" }}
              />
            </div>

            <TextView
              as="p"
              textStyle={TextStyle.META1}
              textColor={statusError ? TextColor.ACCENT : TextColor.SECONDARY}
              role="status"
              style={{ overflowWrap: "anywhere" }}
            >
              {status}
            </TextView>

            {current ? (
              <div className="result-block">
                <TextView
                  as="p"
                  textStyle={TextStyle.META2}
                  textColor={TextColor.SECONDARY}
                >
                  German
                </TextView>
                <TextView as="p" textStyle={TextStyle.BODY1_EMPHASIZED}>
                  {current.german}
                </TextView>
                <TextView
                  as="p"
                  textStyle={TextStyle.META2}
                  textColor={TextColor.SECONDARY}
                >
                  Sounds like
                </TextView>
                <TextView
                  as="p"
                  textStyle={TextStyle.BODY2_EMPHASIZED}
                  textColor={TextColor.ACCENT}
                >
                  {current.phonetic}
                </TextView>
              </div>
            ) : null}

            <TextView
              as="h2"
              className="section-label"
              textStyle={TextStyle.LABEL_EMPHASIZED}
            >
              Saved phrases
            </TextView>
          </div>

          {saved.length === 0 ? (
            <div className="content-stack">
              <TextView
                as="p"
                textStyle={TextStyle.META1}
                textColor={TextColor.SECONDARY}
              >
                No saved phrases yet.
              </TextView>
            </div>
          ) : (
            saved.map((phrase) => (
              <ListItem
                key={phrase.id}
                title={phrase.english}
                subtitle={`${phrase.german} · ${phrase.phonetic}`}
                subtitleMaxLines={2}
                onClick={() => onUseSaved(phrase)}
              />
            ))
          )}
        </VerticalList>

        <div className="action-dock">
          <ButtonGroup alignment={ButtonGroupAlignment.CENTER}>
            <Button
              title="Hear"
              alwaysShowText
              disabled={!current}
              onClick={() => {
                void onHearGerman();
              }}
            />
            <Button
              title="Sounds-like"
              alwaysShowText
              disabled={!current}
              onClick={() => {
                void onHearPhonetic();
              }}
            />
            <Button
              title={alreadySaved ? "Saved" : "Save"}
              alwaysShowText
              disabled={!current || alreadySaved}
              onClick={onSave}
            />
          </ButtonGroup>
          {saved.length > 0 && current ? (
            <ButtonGroup alignment={ButtonGroupAlignment.CENTER}>
              <Button
                title="Delete saved"
                alwaysShowText
                disabled={!alreadySaved}
                onClick={() => {
                  const match = saved.find(
                    (p) =>
                      p.english.toLowerCase() === current.english.toLowerCase() &&
                      p.german.toLowerCase() === current.german.toLowerCase(),
                  );
                  if (match) onDeleteSaved(match.id);
                }}
              />
            </ButtonGroup>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
