export type FileKind = "txt" | "doc" | "docx";
export type ImportMode = "file" | "directory";

export interface Chapter {
  id: string;
  title: string;
  paragraphs: string[];
  startIndex: number;
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  paragraphGap: number;
  fontFamily: "song" | "hei" | "system";
  theme: "paper" | "night";
}

export interface ReadingProgress {
  chapterIndex: number;
  pageIndex: number;
  charOffset?: number;
  pagesBeforeAnchor?: number;
  updatedAt: number;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  description?: string;
  fileName: string;
  fileKind: FileKind;
  sourceKind: "file" | "directory";
  contentHash?: string;
  importedAt: number;
  lastOpenedAt: number;
  chapters: Chapter[];
  settings: ReaderSettings;
  progress: ReadingProgress;
  cover: {
    tone: string;
    accent: string;
    mark: string;
    imageUrl?: string;
  };
}

export interface BookSummary {
  id: string;
  title: string;
  author?: string;
  description?: string;
  fileName: string;
  fileKind: FileKind;
  sourceKind: "file" | "directory";
  contentHash?: string;
  importedAt: number;
  lastOpenedAt: number;
  progress: ReadingProgress;
  chapterCount: number;
  currentChapterTitle: string;
  cover: Book["cover"];
}

export interface ImportResult {
  book: Book;
  warnings: string[];
}

export interface ImportError {
  title: string;
  message: string;
}

export type ReaderView = "library" | "reader";

export interface Page {
  blocks: PageBlock[];
  startOffset: number;
  endOffset: number;
}

export interface PageBlock {
  paragraphIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  startsParagraph: boolean;
}
