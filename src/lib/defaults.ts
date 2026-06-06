import type { ReaderSettings } from "./types";

export const defaultSettings: ReaderSettings = {
  fontSize: 19,
  lineHeight: 1.88,
  pageMargin: 64,
  paragraphGap: 18,
  fontFamily: "song",
  theme: "paper",
};

type StoredReaderSettings = Partial<ReaderSettings> & {
  pageWidth?: number;
};

export function normalizeSettings(settings?: StoredReaderSettings): ReaderSettings {
  const { pageWidth: _legacyPageWidth, ...currentSettings } = settings ?? {};
  const pageMargin = clampPageMargin(currentSettings.pageMargin ?? defaultSettings.pageMargin);

  return {
    ...defaultSettings,
    ...currentSettings,
    pageMargin,
  };
}

function clampPageMargin(value: number) {
  return Math.min(Math.max(value, 16), 96);
}

export const fontLabels: Record<ReaderSettings["fontFamily"], string> = {
  song: "宋体",
  hei: "黑体",
  system: "系统",
};

export const fontStacks: Record<ReaderSettings["fontFamily"], string> = {
  song: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif',
  hei: '"PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif',
  system:
    'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

export const themeLabels: Record<ReaderSettings["theme"], string> = {
  paper: "浅色",
  night: "夜读",
};
