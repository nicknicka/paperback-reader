import { fontLabels, themeLabels } from "../lib/defaults";
import type { ReaderSettings } from "../lib/types";
import type { ReactNode } from "react";

interface SettingsPanelProps {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const update = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <aside className="side-panel settings-panel" aria-label="排版台">
      <h2>排版台</h2>
      <Control label="字号" value={`${settings.fontSize}px`}>
        <input
          type="range"
          min="15"
          max="28"
          value={settings.fontSize}
          onChange={(event) => update("fontSize", Number(event.target.value))}
        />
      </Control>
      <Control label="行距" value={settings.lineHeight.toFixed(2)}>
        <input
          type="range"
          min="1.45"
          max="2.25"
          step="0.05"
          value={settings.lineHeight}
          onChange={(event) => update("lineHeight", Number(event.target.value))}
        />
      </Control>
      <Control label="页边距" value={`${settings.pageMargin}px`}>
        <input
          type="range"
          min="16"
          max="96"
          step="4"
          value={settings.pageMargin}
          onChange={(event) => update("pageMargin", Number(event.target.value))}
        />
      </Control>
      <Control label="段距" value={`${settings.paragraphGap}px`}>
        <input
          type="range"
          min="8"
          max="32"
          step="2"
          value={settings.paragraphGap}
          onChange={(event) => update("paragraphGap", Number(event.target.value))}
        />
      </Control>
      <div className="segmented" role="group" aria-label="字体">
        {Object.entries(fontLabels).map(([value, label]) => (
          <button
            key={value}
            className={settings.fontFamily === value ? "is-active" : ""}
            onClick={() => update("fontFamily", value as ReaderSettings["fontFamily"])}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="主题">
        {Object.entries(themeLabels).map(([value, label]) => (
          <button
            key={value}
            className={settings.theme === value ? "is-active" : ""}
            onClick={() => update("theme", value as ReaderSettings["theme"])}
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Control({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <label className="control">
      <span>
        {label}
        <strong>{value}</strong>
      </span>
      {children}
    </label>
  );
}
