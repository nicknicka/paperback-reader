import { defaultSettings } from "./defaults";
import { splitParagraphs, buildChapters, cleanText, decodeText } from "./text";
import type { Book, FileKind, ImportError, ImportResult } from "./types";

const supportedExtensions = [".txt", ".doc", ".docx"];

interface DirectoryEntry {
  order: number;
  title: string;
  chapter_id: string;
}

export async function importBrowserFile(file: File): Promise<ImportResult> {
  const fileKind = getFileKind(file.name);
  if (!fileKind) throw unsupportedFile(file.name);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await extractText(file.name, fileKind, bytes);
  return buildBook(file.name, fileKind, text, "file");
}

export async function importBrowserDirectory(files: FileList | File[]): Promise<ImportResult> {
  const allFiles = Array.from(files);
  const txtFiles = allFiles.filter((file) => file.name.toLowerCase().endsWith(".txt"));
  if (txtFiles.length === 0) {
    throw {
      title: "目录里没有 TXT 文件",
      message: "请选择包含分章 TXT 文件的目录。当前目录导入只读取这一层的 TXT 文件。",
    } satisfies ImportError;
  }

  const currentLevelTxtFiles = txtFiles.filter((file) => {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split("/").filter(Boolean);
    return parts.length <= 2;
  });
  const filesToImport = (currentLevelTxtFiles.length > 0 ? currentLevelTxtFiles : txtFiles).sort(compareFilesNaturally);
  const directoryName = getBrowserDirectoryName(filesToImport[0]) ?? "分章小说";
  const manifest = await readBrowserDirectoryManifest(allFiles);
  const chapters = await Promise.all(
    filesToImport.map(async (file, index) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const paragraphs = splitParagraphs(decodeText(bytes));
      const chapter = buildDirectoryChapter(file.name, paragraphs, index, manifest.titleByFileName.get(file.name));
      return {
        id: `chapter-${index}`,
        ...chapter,
        startIndex: index,
      };
    }),
  );

  return buildBookFromChapters(directoryName, "txt", chapters, "directory", buildDirectoryWarnings(chapters.length, manifest.total));
}

export async function importTauriFile(): Promise<ImportResult | null> {
  const [{ open }, { readFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "小说文件",
        extensions: ["txt", "doc", "docx"],
      },
    ],
  });

  if (!selected || Array.isArray(selected)) return null;

  const fileName = selected.split(/[\\/]/).pop() ?? selected;
  const fileKind = getFileKind(fileName);
  if (!fileKind) throw unsupportedFile(fileName);

  const bytes = await readFile(selected);
  const result = await buildBook(fileName, fileKind, await extractText(fileName, fileKind, bytes), "file");
  return result;
}

export async function importTauriDirectory(): Promise<ImportResult | null> {
  const [{ open }, fs] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
  const selected = await open({
    multiple: false,
    directory: true,
  });

  if (!selected || Array.isArray(selected)) return null;

  const entries = await fs.readDir(selected);
  let txtEntries = entries
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => ({ ...entry, path: joinPath(selected, entry.name) }))
    .sort((a, b) => compareNatural(a.name, b.name));

  if (txtEntries.length === 0 && entries.some((entry) => entry.isDirectory && entry.name === "chapters")) {
    const chaptersPath = joinPath(selected, "chapters");
    const chapterEntries = await fs.readDir(chaptersPath);
    txtEntries = chapterEntries
      .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".txt"))
      .map((entry) => ({ ...entry, path: joinPath(chaptersPath, entry.name) }))
      .sort((a, b) => compareNatural(a.name, b.name));
  }

  if (txtEntries.length === 0) {
    throw {
      title: "目录里没有 TXT 文件",
      message: "请选择包含分章 TXT 文件的目录。当前目录导入只读取这一层的 TXT 文件。",
    } satisfies ImportError;
  }

  const manifest = await readTauriDirectoryManifest(fs, entries, selected);
  const chapters = await Promise.all(
    txtEntries.map(async (entry, index) => {
      const bytes = await fs.readFile(entry.path);
      const paragraphs = splitParagraphs(decodeText(bytes));
      const chapter = buildDirectoryChapter(entry.name, paragraphs, index, manifest.titleByFileName.get(entry.name));
      return {
        id: `chapter-${index}`,
        ...chapter,
        startIndex: index,
      };
    }),
  );

  const directoryName = selected.split(/[\\/]/).filter(Boolean).pop() ?? "分章小说";
  return buildBookFromChapters(directoryName, "txt", chapters, "directory", buildDirectoryWarnings(chapters.length, manifest.total));
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function extractText(fileName: string, kind: FileKind, bytes: Uint8Array): Promise<string> {
  if (kind === "txt") return decodeText(bytes);

  if (kind === "docx") {
    const { default: mammoth } = await import("mammoth/mammoth.browser");
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  throw {
    title: "暂不支持这个 DOC 文件",
    message: `${fileName} 是老式 Word 格式。第一版会优雅提示失败，请将它另存为 DOCX 或 TXT 后再导入。`,
  } satisfies ImportError;
}

function buildBook(
  fileName: string,
  fileKind: FileKind,
  rawText: string,
  sourceKind: Book["sourceKind"],
): ImportResult {
  const title = fileName.replace(/\.(txt|doc|docx)$/i, "").trim() || "未命名小说";
  const cleaned = cleanText(rawText);
  const chapters = buildChapters(cleaned);
  return buildBookFromChapters(
    title,
    fileKind,
    chapters,
    sourceKind,
    chapters.length === 1 ? ["未识别到明确章节，已按正文位置建立目录。"] : [],
    fileName,
  );
}

function buildBookFromChapters(
  title: string,
  fileKind: FileKind,
  chapters: Book["chapters"],
  sourceKind: Book["sourceKind"],
  warnings: string[],
  fileName = title,
): ImportResult {
  const now = Date.now();

  return {
    warnings,
    book: {
      id: crypto.randomUUID(),
      title,
      fileName,
      fileKind,
      sourceKind,
      importedAt: now,
      lastOpenedAt: now,
      chapters,
      settings: { ...defaultSettings },
      progress: {
        chapterIndex: 0,
        pageIndex: 0,
        updatedAt: now,
      },
      cover: makeCover(title),
    },
  };
}

function getFileKind(fileName: string): FileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".doc")) return "doc";
  return null;
}

function unsupportedFile(fileName: string): ImportError {
  return {
    title: "无法导入这个文件",
    message: `${fileName} 不是支持的格式。当前支持 ${supportedExtensions.join("、")}。`,
  };
}

function makeCover(title: string): Book["cover"] {
  const palettes = [
    ["#e9e5dc", "#7b705f"],
    ["#dfe5df", "#607368"],
    ["#e7e2d3", "#8b6d48"],
    ["#dfe2e7", "#657184"],
    ["#e7dfdc", "#8a625d"],
  ];
  const seed = [...title].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const [tone, accent] = palettes[seed % palettes.length];
  const mark = title.replace(/\s+/g, "").slice(0, 1) || "书";
  return { tone, accent, mark };
}

function compareFilesNaturally(a: File, b: File) {
  const pathA = a.webkitRelativePath || a.name;
  const pathB = b.webkitRelativePath || b.name;
  return compareNatural(pathA, pathB);
}

function compareNatural(a: string, b: string) {
  return a.localeCompare(b, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function getBrowserDirectoryName(file: File) {
  const path = file.webkitRelativePath;
  if (!path) return null;
  return path.split("/").filter(Boolean)[0] ?? null;
}

function buildDirectoryChapter(
  fileName: string,
  paragraphs: string[],
  index: number,
  titleOverride?: string,
) {
  const baseName = fileName.replace(/\.txt$/i, "").trim();
  const generatedName = /^[\d\s._-]+$/.test(baseName) || /^\d{4}_\d+$/.test(baseName);
  const fallbackTitle = titleOverride || baseName || `章节 ${index + 1}`;

  if (titleOverride && paragraphs[0] === titleOverride) {
    return {
      title: titleOverride,
      paragraphs: paragraphs.slice(1).length > 0 ? paragraphs.slice(1) : ["这个 TXT 文件没有更多正文。"],
    };
  }

  if (generatedName && paragraphs[0]) {
    return {
      title: titleOverride || paragraphs[0],
      paragraphs: paragraphs.slice(1).length > 0 ? paragraphs.slice(1) : ["这个 TXT 文件没有更多正文。"],
    };
  }

  return {
    title: fallbackTitle,
    paragraphs: paragraphs.length > 0 ? paragraphs : ["这个 TXT 文件没有可读取正文。"],
  };
}

function joinPath(directory: string, fileName: string) {
  if (directory.endsWith("/") || directory.endsWith("\\")) return `${directory}${fileName}`;
  return `${directory}${directory.includes("\\") ? "\\" : "/"}${fileName}`;
}

async function readBrowserDirectoryManifest(files: File[]) {
  const manifestFile = files.find((file) => file.name === "directory.json");
  if (!manifestFile) return emptyDirectoryManifest();

  try {
    return buildDirectoryManifest(JSON.parse(await manifestFile.text()));
  } catch {
    return emptyDirectoryManifest();
  }
}

async function readTauriDirectoryManifest(
  fs: typeof import("@tauri-apps/plugin-fs"),
  entries: Array<{ name: string; isDirectory: boolean }>,
  directory: string,
) {
  if (!entries.some((entry) => !entry.isDirectory && entry.name === "directory.json")) {
    return emptyDirectoryManifest();
  }

  try {
    const bytes = await fs.readFile(joinPath(directory, "directory.json"));
    return buildDirectoryManifest(JSON.parse(decodeText(bytes)));
  } catch {
    return emptyDirectoryManifest();
  }
}

function buildDirectoryManifest(raw: unknown) {
  if (!Array.isArray(raw)) return emptyDirectoryManifest();

  const entries = raw.filter(isDirectoryEntry);
  const titleByFileName = new Map<string, string>();
  for (const entry of entries) {
    titleByFileName.set(`${String(entry.order).padStart(4, "0")}_${entry.chapter_id}.txt`, entry.title);
  }
  return {
    total: entries.length,
    titleByFileName,
  };
}

function emptyDirectoryManifest() {
  return {
    total: null as number | null,
    titleByFileName: new Map<string, string>(),
  };
}

function isDirectoryEntry(value: unknown): value is DirectoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<DirectoryEntry>;
  return (
    typeof entry.order === "number" &&
    typeof entry.title === "string" &&
    typeof entry.chapter_id === "string"
  );
}

function buildDirectoryWarnings(importedCount: number, manifestTotal: number | null) {
  if (manifestTotal === null) return [`已按文件名顺序导入 ${importedCount} 个 TXT 文件。`];
  if (importedCount < manifestTotal) {
    return [`检测到完整目录 ${manifestTotal} 章，当前已导入 ${importedCount} 个已采集 TXT 文件。`];
  }
  return [`已按章节目录导入 ${importedCount} 个 TXT 文件。`];
}
