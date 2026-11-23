import { useCallback, useState } from "react";
import { ListItem, VerticalList } from "@wearables-ui-toolkit/mrbd";
import {
  chevronLeftIcon,
  chevronRightIcon,
  readingSpeedIcon,
} from "../icons";
import {
  LANG_OPTIONS,
  langLabel,
  type AppSettings,
  type LangCode,
  clampReadingSpeed,
} from "../lib/settings";

type Panel = "main" | "source" | "target";

type Props = {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
};

export function SettingsPage({ settings, onChange }: Props) {
  const [panel, setPanel] = useState<Panel>("main");

  const setSource = useCallback(
    (code: LangCode) => {
      onChange({ ...settings, sourceLang: code });
      setPanel("main");
    },
    [onChange, settings],
  );

  const setTarget = useCallback(
    (code: LangCode) => {
      onChange({ ...settings, targetLang: code });
      setPanel("main");
    },
    [onChange, settings],
  );

  const setSpeed = useCallback(
    (value: number) => {
      onChange({ ...settings, readingSpeed: clampReadingSpeed(value) });
    },
    [onChange, settings],
  );

  if (panel === "source" || panel === "target") {
    const selected =
      panel === "source" ? settings.sourceLang : settings.targetLang;
    const title = panel === "source" ? "Source language" : "Target language";
    return (
      <VerticalList insetForHeader ariaLabel={title}>
        <ListItem
          title="Back"
          icon={chevronLeftIcon}
          onClick={() => setPanel("main")}
        />
        {LANG_OPTIONS.map((option) => (
          <ListItem
            key={option.code}
            title={option.label}
            subtitle={
              option.code === "en" || option.code === "de"
                ? undefined
                : "Coming soon for translate"
            }
            showRadioButton
            checked={selected === option.code}
            onCheckedChange={(checked) => {
              if (!checked) return;
              if (panel === "source") setSource(option.code);
              else setTarget(option.code);
            }}
          />
        ))}
      </VerticalList>
    );
  }

  const speedPercent = Math.round(settings.readingSpeed * 100);

  return (
    <VerticalList insetForHeader ariaLabel="Settings">
      <ListItem
        title="Source language"
        subtitle={langLabel(settings.sourceLang)}
        accessoryIcon={chevronRightIcon}
        onClick={() => setPanel("source")}
      />
      <ListItem
        title="Target language"
        subtitle={langLabel(settings.targetLang)}
        accessoryIcon={chevronRightIcon}
        onClick={() => setPanel("target")}
      />
      <ListItem
        showSlider
        icon={readingSpeedIcon}
        aria-label={`Reading speed ${speedPercent} percent`}
        aria-valuetext={`${speedPercent} percent`}
        sliderMinimumValue={0.5}
        sliderMaximumValue={1.5}
        sliderValue={settings.readingSpeed}
        sliderIncrementPercentage={0.1}
        onSliderValueChange={setSpeed}
      />
    </VerticalList>
  );
}
