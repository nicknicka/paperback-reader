import type { Chapter } from "./types";

const chapterPattern =
  /^(第[零〇一二三四五六七八九十百千万\d\s]+[章节卷回部集篇].{0,36}|序章|楔子|尾声|后记|番外.{0,24}|Chapter\s+\d+.{0,36})$/i;

export function cleanText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function splitParagraphs(text: string): string[] {
  return cleanText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildChapters(text: string): Chapter[] {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) {
    return [
      {
        id: "chapter-0",
        title: "正文",
        paragraphs: ["导入的文件没有可读取正文。"],
        startIndex: 0,
      },
    ];
  }

  const chapterStarts = paragraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => chapterPattern.test(paragraph) && paragraph.length <= 42);

  if (chapterStarts.length < 2) {
    return buildPositionChapters(paragraphs);
  }

  return chapterStarts.map((start, order) => {
    const next = chapterStarts[order + 1]?.index ?? paragraphs.length;
    const body = paragraphs.slice(start.index + 1, next);
    return {
      id: `chapter-${order}`,
      title: start.paragraph,
      paragraphs: body.length > 0 ? body : [start.paragraph],
      startIndex: start.index,
    };
  });
}

function buildPositionChapters(paragraphs: string[]): Chapter[] {
  const chunkSize = 36;
  const total = Math.ceil(paragraphs.length / chunkSize);

  return Array.from({ length: total }, (_, index) => {
    const start = index * chunkSize;
    return {
      id: `position-${index}`,
      title: total === 1 ? "正文" : `位置 ${index + 1}`,
      paragraphs: paragraphs.slice(start, start + chunkSize),
      startIndex: start,
    };
  });
}

export function decodeText(bytes: Uint8Array): string {
  const encodings = ["utf-8", "gb18030", "gbk"];

  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding, { fatal: encoding === "utf-8" }).decode(bytes);
      if (text.trim().length > 0) return text;
    } catch {
      // Try the next common encoding.
    }
  }

  return new TextDecoder().decode(bytes);
}
