import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import {
  Button,
  ButtonGroup,
  ButtonGroupAlignment,
  InputTextView,
  ListItem,
  SubNavigationPager,
  SwipeToReveal,
  TextColor,
  TextStyle,
  TextView,
  VerticalList,
  type ButtonHandle,
} from "@wearables-ui-toolkit/mrbd";
import {
  deleteIcon,
  hearIcon,
  savedFilledIcon,
  savedTabIcon,
  translateTabIcon,
} from "../icons";
import { loadSavedPhrases, persistSavedPhrases } from "../lib/storage";
import { translateEnglish } from "../lib/translate";
import {
  playGermanNetworkTts,
  playPhoneticSpeech,
  stopSpeech,
} from "../lib/tts";
import type { Phrase, SavedPhrase } from "../lib/types";

const PAGE_SAVED = 0;
const PAGE_TRANSLATE = 1;

const NAV_ITEMS = [
  { label: "Saved", icon: savedTabIcon },
  { label: "Translate", icon: translateTabIcon },
] as const;

export function TranslationApp() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const actionDockRef = useRef<HTMLDivElement | null>(null);
  const hearButtonRef = useRef<ButtonHandle | null>(null);
  const [pageIndex, setPageIndex] = useState(PAGE_TRANSLATE);
  const [english, setEnglish] = useState("");
  const [current, setCurrent] = useState<Phrase | null>(null);
  const [saved, setSaved] = useState<SavedPhrase[]>(() => loadSavedPhrases());
  const [status, setStatus] = useState("Enter English, then Search.");
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
      updateStatus("Loaded saved phrase — ready to Hear.");
      setPageIndex(PAGE_TRANSLATE);
    },
    [updateStatus],
  );

  /** When directional focus enters the bottom strip, land on Hear first. */
  const onActionDockFocusCapture = useCallback((event: FocusEvent) => {
    const dock = actionDockRef.current;
    const hearEl = hearButtonRef.current?.getElement();
    if (!dock || !hearEl) return;
    const fromOutside =
      !(event.relatedTarget instanceof Node) ||
      !dock.contains(event.relatedTarget);
    if (!fromOutside) return;
    if (hearEl.contains(event.target as Node)) return;
    if (hearEl.getAttribute("aria-disabled") === "true") return;
    queueMicrotask(() => {
      hearEl.focus();
    });
  }, []);

  return (
    <SubNavigationPager
      items={[...NAV_ITEMS]}
      currentPageIndex={pageIndex}
      onPageChange={(next) => setPageIndex(next)}
      defaultPageIndex={PAGE_TRANSLATE}
      homeIndex={PAGE_TRANSLATE}
      ariaLabel="Translation pages"
    >
      {/* Left: Saved */}
      <VerticalList insetForHeader ariaLabel="Saved phrases">
        {saved.length === 0 ? (
          <div className="empty-saved">
            <TextView
              as="p"
              textStyle={TextStyle.BODY2}
              textColor={TextColor.SECONDARY}
            >
              No saved phrases
            </TextView>
          </div>
        ) : (
          saved.map((phrase) => (
            <SwipeToReveal
              key={phrase.id}
              actions={[
                {
                  icon: deleteIcon,
                  contentDescription: "Delete",
                  onClick: () => onDeleteSaved(phrase.id),
                },
              ]}
              actionsShownAnnouncement="Delete available"
              actionsHiddenAnnouncement="Delete hidden"
            >
              <ListItem
                title={phrase.english}
                subtitle={`${phrase.german} · ${phrase.phonetic}`}
                subtitleMaxLines={2}
                onClick={() => onUseSaved(phrase)}
              />
            </SwipeToReveal>
          ))
        )}
      </VerticalList>

      {/* Right: Translate */}
      <div className="translate-shell">
        <div className="translate-top">
          <div className="translate-header">
            <TextView as="h1" textStyle={TextStyle.HEADING2}>
              EN → DE
            </TextView>
          </div>

          <div className="composer">
            <InputTextView
              text={english}
              onTextChange={setEnglish}
              hint="English phrase"
              actionLabel="Search"
              showLoader={translating}
              loadingLabel="Translating"
              onSend={onTranslate}
              inputProps={{ maxLength: 280, autoComplete: "off" }}
            />
          </div>

          <TextView
            as="p"
            className="status-line"
            textStyle={TextStyle.META2}
            textColor={statusError ? TextColor.ACCENT : TextColor.SECONDARY}
            role="status"
          >
            {status}
          </TextView>

          {current ? (
            <div className="result-block">
              <TextView
                as="p"
                textStyle={TextStyle.META3}
                textColor={TextColor.SECONDARY}
              >
                German
              </TextView>
              <TextView as="p" textStyle={TextStyle.BODY1_EMPHASIZED}>
                {current.german}
              </TextView>
              <TextView
                as="p"
                textStyle={TextStyle.META3}
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
        </div>

        <div
          ref={actionDockRef}
          className="action-dock"
          aria-label="Translation actions"
          onFocusCapture={onActionDockFocusCapture}
        >
          <ButtonGroup alignment={ButtonGroupAlignment.CENTER}>
            <Button
              ref={hearButtonRef}
              title="Hear"
              icon={hearIcon}
              alwaysShowText
              disabled={!current}
              onClick={() => {
                void onHearGerman();
              }}
            />
            <Button
              title="Sounds like"
              alwaysShowText
              disabled={!current}
              onClick={() => {
                void onHearPhonetic();
              }}
            />
            <Button
              title={alreadySaved ? "Saved" : "Save"}
              icon={alreadySaved ? savedFilledIcon : savedTabIcon}
              alwaysShowText
              disabled={!current || alreadySaved}
              onClick={onSave}
            />
          </ButtonGroup>
        </div>
      </div>
    </SubNavigationPager>
  );
}
