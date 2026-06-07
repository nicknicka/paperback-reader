import type { Page, PageBlock, ReaderSettings } from "./types";
import { fontStacks } from "./defaults";

const pageEndBuffer = 16;
const paragraphSeparatorLength = 1;

interface ParagraphMetric {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  boundaries: number[];
}

export function paginateParagraphs(
  paragraphs: string[],
  measure: HTMLElement,
  settings: ReaderSettings,
): Page[] {
  return paginateFromOffset(paragraphs, measure, settings, 0);
}

export function paginateFromOffset(
  paragraphs: string[],
  measure: HTMLElement,
  settings: ReaderSettings,
  startOffset: number,
): Page[] {
  const metrics = buildParagraphMetrics(paragraphs);
  const first = metrics[0];
  const last = metrics.at(-1);

  if (!first || !last) {
    return [
      {
        blocks: [
          {
            paragraphIndex: 0,
            text: "本章没有可显示正文。",
            startOffset: 0,
            endOffset: 9,
            startsParagraph: true,
          },
        ],
        startOffset: 0,
        endOffset: 9,
      },
    ];
  }

  prepareMeasure(measure, settings);
  resetMeasure(measure);

  const pages: Page[] = [];
  let currentOffset = Math.max(startOffset, first.startOffset);

  while (currentOffset < last.endOffset) {
    const normalizedStart = normalizeTextStart(metrics, currentOffset);
    if (normalizedStart >= last.endOffset) break;

    const endOffset = findPageEnd(metrics, measure, normalizedStart, last.endOffset);
    const page = makePage(metrics, normalizedStart, endOffset);
    if (page.blocks.length === 0) break;

    pages.push(page);
    const nextOffset = normalizeTextStart(metrics, endOffset);
    currentOffset = nextOffset > normalizedStart ? nextOffset : normalizedStart + 1;
  }

  resetMeasure(measure);
  return pages.length > 0 ? pages : paginateParagraphs(["本章没有可显示正文。"], measure, settings);
}

export function paginatePreviousPage(
  paragraphs: string[],
  measure: HTMLElement,
  settings: ReaderSettings,
  endOffset: number,
): Page | null {
  const metrics = buildParagraphMetrics(paragraphs);
  const first = metrics[0];
  if (!first || endOffset <= first.startOffset) return null;

  prepareMeasure(measure, settings);
  resetMeasure(measure);

  const normalizedEnd = normalizeTextEnd(metrics, Math.max(endOffset, first.startOffset + 1));
  let low = first.startOffset;
  let high = normalizedEnd - 1;
  let bestStart: number | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateStart = normalizeTextStart(metrics, mid);
    if (candidateStart >= normalizedEnd) {
      high = mid - 1;
      continue;
    }

    renderMeasuredPage(measure, makeBlocks(metrics, candidateStart, normalizedEnd));
    if (fitsMeasure(measure)) {
      bestStart = candidateStart;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  resetMeasure(measure);
  if (bestStart === null) {
    bestStart = normalizeTextStart(metrics, normalizedEnd - 1);
  }

  return makePage(metrics, bestStart, normalizedEnd);
}

function buildParagraphMetrics(paragraphs: string[]) {
  let offset = 0;
  const metrics: ParagraphMetric[] = [];

  paragraphs.forEach((paragraph, index) => {
    if (paragraph.length === 0) {
      offset += paragraphSeparatorLength;
      return;
    }

    const startOffset = offset;
    const endOffset = startOffset + paragraph.length;
    metrics.push({
      index,
      text: paragraph,
      startOffset,
      endOffset,
      boundaries: buildTextBoundaries(paragraph),
    });
    offset = endOffset + paragraphSeparatorLength;
  });

  return metrics;
}

function findPageEnd(metrics: ParagraphMetric[], measure: HTMLElement, startOffset: number, maxOffset: number) {
  let low = startOffset + 1;
  let high = maxOffset;
  let best = normalizeTextEnd(metrics, low);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateEnd = normalizeTextEnd(metrics, mid);
    if (candidateEnd <= startOffset) {
      low = mid + 1;
      continue;
    }

    renderMeasuredPage(measure, makeBlocks(metrics, startOffset, candidateEnd));

    if (fitsMeasure(measure)) {
      best = candidateEnd;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function makePage(metrics: ParagraphMetric[], startOffset: number, endOffset: number): Page {
  const blocks = makeBlocks(metrics, startOffset, endOffset);
  const firstBlock = blocks[0];
  const lastBlock = blocks.at(-1);

  return {
    blocks,
    startOffset: firstBlock?.startOffset ?? startOffset,
    endOffset: lastBlock?.endOffset ?? endOffset,
  };
}

function makeBlocks(metrics: ParagraphMetric[], startOffset: number, endOffset: number): PageBlock[] {
  const blocks: PageBlock[] = [];

  for (const paragraph of metrics) {
    if (paragraph.endOffset <= startOffset) continue;
    if (paragraph.startOffset >= endOffset) break;

    const blockStart = normalizeParagraphTextStart(paragraph, Math.max(startOffset, paragraph.startOffset));
    const blockEnd = normalizeParagraphTextEnd(paragraph, Math.min(endOffset, paragraph.endOffset));
    if (blockStart >= blockEnd) continue;

    blocks.push({
      paragraphIndex: paragraph.index,
      text: paragraph.text.slice(blockStart - paragraph.startOffset, blockEnd - paragraph.startOffset),
      startOffset: blockStart,
      endOffset: blockEnd,
      startsParagraph: blockStart === paragraph.startOffset,
    });
  }

  return blocks;
}

function normalizeTextStart(metrics: ParagraphMetric[], offset: number) {
  for (const paragraph of metrics) {
    if (offset < paragraph.startOffset) return paragraph.startOffset;
    if (offset < paragraph.endOffset) return normalizeParagraphTextStart(paragraph, offset);
  }
  return metrics.at(-1)?.endOffset ?? offset;
}

function normalizeTextEnd(metrics: ParagraphMetric[], offset: number) {
  for (const paragraph of metrics) {
    if (offset <= paragraph.startOffset) return paragraph.startOffset;
    if (offset <= paragraph.endOffset) return normalizeParagraphTextEnd(paragraph, offset);
  }
  return metrics.at(-1)?.endOffset ?? offset;
}

function normalizeParagraphTextStart(paragraph: ParagraphMetric, offset: number) {
  const localOffset = Math.min(Math.max(offset - paragraph.startOffset, 0), paragraph.text.length);
  return paragraph.startOffset + findBoundaryAtOrAfter(paragraph.boundaries, localOffset);
}

function normalizeParagraphTextEnd(paragraph: ParagraphMetric, offset: number) {
  const localOffset = Math.min(Math.max(offset - paragraph.startOffset, 0), paragraph.text.length);
  return paragraph.startOffset + findBoundaryAtOrBefore(paragraph.boundaries, localOffset);
}

function buildTextBoundaries(text: string) {
  const boundaries = [0];
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    boundaries.push(index);
  }
  return boundaries;
}

function findBoundaryAtOrAfter(boundaries: number[], offset: number) {
  let low = 0;
  let high = boundaries.length - 1;
  let best = boundaries[boundaries.length - 1] ?? offset;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = boundaries[mid];
    if (value >= offset) {
      best = value;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return best;
}

function findBoundaryAtOrBefore(boundaries: number[], offset: number) {
  let low = 0;
  let high = boundaries.length - 1;
  let best = boundaries[0] ?? offset;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = boundaries[mid];
    if (value <= offset) {
      best = value;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function prepareMeasure(measure: HTMLElement, settings: ReaderSettings) {
  measure.style.fontSize = `${settings.fontSize}px`;
  measure.style.lineHeight = String(settings.lineHeight);
  measure.style.fontFamily = fontStacks[settings.fontFamily];
  measure.style.setProperty("--paragraph-gap", `${settings.paragraphGap}px`);
}

function resetMeasure(measure: HTMLElement) {
  measure.innerHTML = "";
}

function renderMeasuredPage(measure: HTMLElement, blocks: PageBlock[]) {
  resetMeasure(measure);
  for (const block of blocks) {
    appendMeasuredBlock(measure, block);
  }
}

function appendMeasuredBlock(measure: HTMLElement, block: PageBlock) {
  const p = document.createElement("p");
  p.textContent = block.text;
  if (!block.startsParagraph) p.className = "is-continuation";
  measure.appendChild(p);
}

function fitsMeasure(measure: HTMLElement) {
  const last = measure.lastElementChild;
  if (!last) return true;

  const measureRect = measure.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  return lastRect.bottom <= measureRect.bottom - pageEndBuffer;
}
