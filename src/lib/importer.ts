import { defaultSettings } from "./defaults";
import { splitParagraphs, buildChapters, cleanText, decodeText } from "./text";
import type { Book, FileKind, ImportError, ImportResult } from "./types";

const supportedExtensions = [".txt", ".doc", ".docx"];
const defaultCoverFileNames = ["cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "poster.jpg"];
const maxCoverBytes = 3 * 1024 * 1024;

interface DirectoryEntry {
  order: number;
  title: string;
  chapter_id?: string;
  file?: string;
}

interface DirectoryManifest {
  title?: string;
  author?: string;
  description?: string;
  cover?: string;
  fileNames: string[];
  fileGroups: string[][];
  total: number | null;
  titleByFileName: Map<string, string>;
  orderByFileName: Map<string, number>;
  warnings: string[];
}

interface TauriDirectoryTxtEntry {
  name: string;
  path: string;
  manifestFileName?: string;
  candidatePaths?: string[];
  candidateNames?: string[];
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
  const manifest = await readBrowserDirectoryManifest(allFiles);
  const selection = selectBrowserDirectoryTxtFiles(txtFiles, currentLevelTxtFiles, manifest);
  const filesToImport = sortDirectoryFiles(selection.files, manifest);
  const directoryName = manifest.title || getBrowserDirectoryName(filesToImport[0]) || "分章小说";
  const coverResult = await readBrowserDirectoryCover(allFiles, manifest);
  const chapters = await Promise.all(
    filesToImport.map(async (file, index) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const paragraphs = splitParagraphs(decodeText(bytes));
      const chapter = buildDirectoryChapter(file.name, paragraphs, index, getManifestTitle(manifest, getBrowserRelativePath(file)));
      return {
        id: `chapter-${index}`,
        ...chapter,
        startIndex: index,
      };
    }),
  );

  return buildBookFromChapters(
    directoryName,
    "txt",
    chapters,
    "directory",
    [...buildDirectoryWarnings(chapters.length, manifest.total), ...manifest.warnings, ...selection.warnings, ...coverResult.warnings],
    directoryName,
    {
      author: manifest.author,
      description: manifest.description,
      coverImageUrl: coverResult.imageUrl,
    },
  );
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
  const manifest = await readTauriDirectoryManifest(fs, entries, selected);
  const selection = await selectTauriDirectoryTxtEntries(fs, entries, selected, manifest);
  let txtEntries = selection.entries;

  if (txtEntries.length === 0) {
    throw {
      title: "目录里没有 TXT 文件",
      message: "请选择包含分章 TXT 文件的目录。当前目录导入只读取这一层的 TXT 文件。",
    } satisfies ImportError;
  }

  txtEntries = sortDirectoryEntries(txtEntries, manifest);
  const coverResult = await readTauriDirectoryCover(fs, entries, selected, manifest);
  const readResult = await readTauriDirectoryChapters(fs, txtEntries, manifest);

  if (readResult.chapters.length === 0) {
    throw {
      title: "目录里的 TXT 无法读取",
      message: "已找到 TXT 文件，但没有任何章节成功读取，请检查文件是否仍在原目录中。",
    } satisfies ImportError;
  }

  const directoryName = manifest.title || selected.split(/[\\/]/).filter(Boolean).pop() || "分章小说";
  return buildBookFromChapters(
    directoryName,
    "txt",
    readResult.chapters,
    "directory",
    [
      ...buildDirectoryWarnings(readResult.chapters.length, manifest.total),
      ...manifest.warnings,
      ...selection.warnings,
      ...readResult.warnings,
      ...coverResult.warnings,
    ],
    directoryName,
    {
      author: manifest.author,
      description: manifest.description,
      coverImageUrl: coverResult.imageUrl,
    },
  );
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
  metadata: { author?: string; description?: string; coverImageUrl?: string } = {},
): ImportResult {
  const now = Date.now();
  const cover = makeCover(title);
  if (metadata.coverImageUrl) cover.imageUrl = metadata.coverImageUrl;

  return {
    warnings,
    book: {
      id: crypto.randomUUID(),
      title,
      author: metadata.author,
      description: metadata.description,
      fileName,
      fileKind,
      sourceKind,
      contentHash: makeContentHash(title, chapters),
      importedAt: now,
      lastOpenedAt: now,
      chapters,
      settings: { ...defaultSettings },
      progress: {
        chapterIndex: 0,
        pageIndex: 0,
        updatedAt: now,
      },
      cover,
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

function makeContentHash(title: string, chapters: Book["chapters"]) {
  const source = `${title}\n${chapters.map((chapter) => `${chapter.title}\n${chapter.paragraphs.join("\n")}`).join("\n")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compareFilesNaturally(a: File, b: File) {
  const pathA = a.webkitRelativePath || a.name;
  const pathB = b.webkitRelativePath || b.name;
  return compareNatural(pathA, pathB);
}

function selectBrowserDirectoryTxtFiles(txtFiles: File[], currentLevelTxtFiles: File[], manifest: DirectoryManifest) {
  if (manifest.fileNames.length === 0) {
    return {
      files: currentLevelTxtFiles.length > 0 ? currentLevelTxtFiles : txtFiles,
      warnings: [] as string[],
    };
  }

  const files: File[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const fileGroup of manifest.fileGroups) {
    const file = fileGroup.map((fileName) => findBrowserFileByManifestName(txtFiles, fileName)).find(Boolean);
    if (!file) {
      warnings.push(`未找到章节文件 ${fileGroup[0]}，已跳过。`);
      continue;
    }

    const key = getBrowserRelativePath(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(file);
  }

  if (files.length > 0) return { files, warnings };

  return {
    files: currentLevelTxtFiles.length > 0 ? currentLevelTxtFiles : txtFiles,
    warnings: ["directory.json 的章节文件没有匹配到 TXT，已按文件名顺序导入。"],
  };
}

async function selectTauriDirectoryTxtEntries(
  fs: typeof import("@tauri-apps/plugin-fs"),
  entries: Array<{ name: string; isDirectory: boolean }>,
  directory: string,
  manifest: DirectoryManifest,
) {
  if (manifest.fileNames.length > 0) {
    const selectedEntries = manifest.fileGroups.flatMap((fileGroup): TauriDirectoryTxtEntry[] => {
      const candidates = fileGroup
        .map((fileName) => normalizeRelativeManifestPath(fileName))
        .filter((fileName): fileName is string => typeof fileName === "string" && fileName.toLowerCase().endsWith(".txt"));
      const relativePath = candidates[0];
      if (!relativePath) return [];
      return [
        {
          name: getPathBaseName(relativePath),
          path: joinPath(directory, relativePath),
          manifestFileName: relativePath,
          candidatePaths: candidates.map((candidate) => joinPath(directory, candidate)),
          candidateNames: fileGroup,
        },
      ];
    });

    if (selectedEntries.length > 0) return { entries: selectedEntries, warnings: [] as string[] };
    return {
      entries: await readDefaultTauriDirectoryTxtEntries(fs, entries, directory),
      warnings: ["directory.json 的章节文件路径无效，已按文件名顺序导入。"],
    };
  }

  return {
    entries: await readDefaultTauriDirectoryTxtEntries(fs, entries, directory),
    warnings: [] as string[],
  };
}

async function readDefaultTauriDirectoryTxtEntries(
  fs: typeof import("@tauri-apps/plugin-fs"),
  entries: Array<{ name: string; isDirectory: boolean }>,
  directory: string,
): Promise<TauriDirectoryTxtEntry[]> {
  let txtEntries = entries
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => ({ name: entry.name, path: joinPath(directory, entry.name) }))
    .sort((a, b) => compareNatural(a.name, b.name));

  if (txtEntries.length === 0 && entries.some((entry) => entry.isDirectory && entry.name === "chapters")) {
    const chaptersPath = joinPath(directory, "chapters");
    const chapterEntries = await fs.readDir(chaptersPath);
    txtEntries = chapterEntries
      .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".txt"))
      .map((entry) => ({ name: entry.name, path: joinPath(chaptersPath, entry.name) }))
      .sort((a, b) => compareNatural(a.name, b.name));
  }

  return txtEntries;
}

async function readTauriDirectoryChapters(
  fs: typeof import("@tauri-apps/plugin-fs"),
  entries: TauriDirectoryTxtEntry[],
  manifest: DirectoryManifest,
) {
  const chapters: Book["chapters"] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    let bytes: Uint8Array | null = null;
    const candidatePaths = entry.candidatePaths ?? [entry.path];
    const candidateNames = entry.candidateNames ?? [entry.manifestFileName ?? entry.name];

    for (const candidatePath of candidatePaths) {
      try {
        bytes = await fs.readFile(candidatePath);
        break;
      } catch {
        // Try the next manifest-compatible path.
      }
    }

    if (!bytes) {
      warnings.push(`未读取到章节文件 ${candidateNames[0]}，已跳过。`);
      continue;
    }

    try {
      const paragraphs = splitParagraphs(decodeText(bytes));
      const chapter = buildDirectoryChapter(entry.name, paragraphs, chapters.length, getManifestTitle(manifest, entry.manifestFileName ?? entry.name));
      chapters.push({
        id: `chapter-${chapters.length}`,
        ...chapter,
        startIndex: chapters.length,
      });
    } catch {
      warnings.push(`未解析到章节文件 ${candidateNames[0]}，已跳过。`);
    }
  }

  return { chapters, warnings };
}

function sortDirectoryFiles(files: File[], manifest: DirectoryManifest) {
  return [...files].sort((a, b) => compareManifestOrder(getBrowserRelativePath(a), getBrowserRelativePath(b), manifest) ?? compareFilesNaturally(a, b));
}

function sortDirectoryEntries<T extends { name: string; manifestFileName?: string }>(entries: T[], manifest: DirectoryManifest) {
  return [...entries].sort(
    (a, b) => compareManifestOrder(a.manifestFileName ?? a.name, b.manifestFileName ?? b.name, manifest) ?? compareNatural(a.name, b.name),
  );
}

function compareManifestOrder(a: string, b: string, manifest: DirectoryManifest) {
  const orderA = getManifestOrder(manifest, a);
  const orderB = getManifestOrder(manifest, b);
  if (orderA === undefined && orderB === undefined) return null;
  if (orderA === undefined) return 1;
  if (orderB === undefined) return -1;
  return orderA - orderB;
}

function getManifestTitle(manifest: DirectoryManifest, fileName: string) {
  return manifest.titleByFileName.get(normalizeFileKey(fileName)) ?? manifest.titleByFileName.get(normalizeBaseNameKey(fileName));
}

function getManifestOrder(manifest: DirectoryManifest, fileName: string) {
  return manifest.orderByFileName.get(normalizeFileKey(fileName)) ?? manifest.orderByFileName.get(normalizeBaseNameKey(fileName));
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
  const manifestFile = files.find((file) => isBrowserRootFile(file, "directory.json"));
  if (!manifestFile) return emptyDirectoryManifest();

  try {
    return buildDirectoryManifest(JSON.parse(await manifestFile.text()));
  } catch {
    return {
      ...emptyDirectoryManifest(),
      warnings: ["directory.json 无法解析，已按文件名顺序导入。"],
    };
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
    return {
      ...emptyDirectoryManifest(),
      warnings: ["directory.json 无法解析，已按文件名顺序导入。"],
    };
  }
}

function buildDirectoryManifest(raw: unknown) {
  if (Array.isArray(raw)) return buildLegacyDirectoryManifest(raw);

  if (!raw || typeof raw !== "object") {
    return {
      ...emptyDirectoryManifest(),
      warnings: ["directory.json 格式不受支持，已按文件名顺序导入。"],
    };
  }

  const manifest = raw as {
    title?: unknown;
    author?: unknown;
    description?: unknown;
    cover?: unknown;
    chapters?: unknown;
  };
  const warnings: string[] = [];
  const chapters = Array.isArray(manifest.chapters) ? manifest.chapters : [];
  if ("chapters" in manifest && !Array.isArray(manifest.chapters)) {
    warnings.push("directory.json 的 chapters 字段不是数组，已忽略章节清单。");
  }

  const parsed = buildManifestFromEntries(chapters);
  if (chapters.length > 0 && parsed.total !== null && parsed.total < chapters.length) {
    warnings.push("directory.json 有部分章节字段不完整，已忽略这些条目。");
  }
  return {
    ...parsed,
    title: getOptionalString(manifest.title),
    author: getOptionalString(manifest.author),
    description: getOptionalString(manifest.description),
    cover: getOptionalString(manifest.cover),
    total: chapters.length > 0 ? chapters.length : null,
    warnings,
  };
}

function buildLegacyDirectoryManifest(raw: unknown[]) {
  const parsed = buildManifestFromEntries(raw);
  if (parsed.total !== null && parsed.total < raw.length) {
    return {
      ...parsed,
      warnings: ["directory.json 有部分章节字段不完整，已忽略这些条目。"],
    };
  }
  return parsed;
}

function buildManifestFromEntries(rawEntries: unknown[]): DirectoryManifest {
  const entries = rawEntries.filter(isDirectoryEntry);
  const fileNames: string[] = [];
  const fileGroups: string[][] = [];
  const titleByFileName = new Map<string, string>();
  const orderByFileName = new Map<string, number>();

  for (const entry of entries) {
    const explicitFile = getOptionalString(entry.file);
    const candidates = explicitFile ? [explicitFile] : buildLegacyChapterFileCandidates(entry);
    if (candidates.length === 0) continue;

    const fileName = candidates[0];
    fileNames.push(fileName);
    fileGroups.push(candidates);

    for (const candidate of candidates) {
      const key = normalizeFileKey(candidate);
      const baseNameKey = normalizeBaseNameKey(candidate);
      titleByFileName.set(key, entry.title);
      orderByFileName.set(key, entry.order);
      if (!titleByFileName.has(baseNameKey)) titleByFileName.set(baseNameKey, entry.title);
      if (!orderByFileName.has(baseNameKey)) orderByFileName.set(baseNameKey, entry.order);
    }
  }

  return {
    fileNames,
    fileGroups,
    total: entries.length,
    titleByFileName,
    orderByFileName,
    warnings: [],
  };
}

function emptyDirectoryManifest(): DirectoryManifest {
  return {
    fileNames: [],
    fileGroups: [],
    total: null as number | null,
    titleByFileName: new Map<string, string>(),
    orderByFileName: new Map<string, number>(),
    warnings: [],
  };
}

function buildLegacyChapterFileCandidates(entry: DirectoryEntry) {
  const orderFile = `${String(entry.order).padStart(4, "0")}.txt`;
  const candidates: string[] = [];
  if (entry.chapter_id) {
    const idFile = `${String(entry.order).padStart(4, "0")}_${entry.chapter_id}.txt`;
    candidates.push(idFile, `chapters/${idFile}`);
  }
  candidates.push(orderFile, `chapters/${orderFile}`);
  return candidates;
}

function isDirectoryEntry(value: unknown): value is DirectoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<DirectoryEntry>;
  return (
    typeof entry.order === "number" &&
    typeof entry.title === "string" &&
    (typeof entry.file === "string" || typeof entry.chapter_id === "string")
  );
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeFileKey(fileName: string) {
  return fileName.replace(/\\/g, "/").split("/").filter(Boolean).join("/").toLowerCase();
}

function normalizeBaseNameKey(fileName: string) {
  const normalized = fileName.replace(/\\/g, "/");
  return (normalized.split("/").filter(Boolean).pop() || normalized).toLowerCase();
}

async function readBrowserDirectoryCover(files: File[], manifest: DirectoryManifest) {
  const warnings: string[] = [];
  const coverPath = manifest.cover ? normalizeRelativeManifestPath(manifest.cover) : null;
  if (manifest.cover && !coverPath) {
    return { warnings: [`封面路径 ${manifest.cover} 无法识别，已使用自动文字封面。`] };
  }

  const coverFile = coverPath
    ? findBrowserFileByRelativePath(files, coverPath)
    : defaultCoverFileNames.map((fileName) => findBrowserRootFile(files, fileName)).find(Boolean);

  if (!coverFile) {
    return {
      warnings: manifest.cover ? [`未找到封面图片 ${manifest.cover}，已使用自动文字封面。`] : warnings,
    };
  }

  const mimeType = getImageMimeType(coverFile.name);
  if (!mimeType) {
    return { warnings: [`封面图片 ${coverFile.name} 格式不支持，已使用自动文字封面。`] };
  }
  if (coverFile.size > maxCoverBytes) {
    return { warnings: [`封面图片 ${coverFile.name} 超过 3MB，已使用自动文字封面。`] };
  }

  const bytes = new Uint8Array(await coverFile.arrayBuffer());
  return { imageUrl: bytesToDataUrl(bytes, mimeType), warnings };
}

async function readTauriDirectoryCover(
  fs: typeof import("@tauri-apps/plugin-fs"),
  entries: Array<{ name: string; isDirectory: boolean }>,
  directory: string,
  manifest: DirectoryManifest,
) {
  const coverPath = manifest.cover ? normalizeRelativeManifestPath(manifest.cover) : null;
  if (manifest.cover && !coverPath) {
    return { warnings: [`封面路径 ${manifest.cover} 无法识别，已使用自动文字封面。`] };
  }

  const coverFileName = coverPath || defaultCoverFileNames.find((fileName) =>
    entries.some((entry) => !entry.isDirectory && entry.name.toLowerCase() === fileName),
  );
  if (!coverFileName) return { warnings: [] };

  const mimeType = getImageMimeType(coverFileName);
  if (!mimeType) {
    return { warnings: [`封面图片 ${coverFileName} 格式不支持，已使用自动文字封面。`] };
  }

  try {
    const bytes = await fs.readFile(joinPath(directory, coverFileName));
    if (bytes.byteLength > maxCoverBytes) {
      return { warnings: [`封面图片 ${coverFileName} 超过 3MB，已使用自动文字封面。`] };
    }
    return { imageUrl: bytesToDataUrl(bytes, mimeType), warnings: [] };
  } catch {
    return {
      warnings: manifest.cover ? [`未找到封面图片 ${manifest.cover}，已使用自动文字封面。`] : [],
    };
  }
}

function findBrowserRootFile(files: File[], fileName: string) {
  return files.find((file) => isBrowserRootFile(file, fileName));
}

function findBrowserFileByRelativePath(files: File[], relativePath: string) {
  const normalizedPath = relativePath.toLowerCase();
  return files.find((file) => getBrowserRelativePath(file).toLowerCase() === normalizedPath);
}

function findBrowserFileByManifestName(files: File[], fileName: string) {
  const relativePath = normalizeRelativeManifestPath(fileName);
  if (!relativePath) return null;

  const exactMatch = findBrowserFileByRelativePath(files, relativePath);
  if (exactMatch) return exactMatch;

  const baseName = getPathBaseName(relativePath).toLowerCase();
  return files.find((file) => file.name.toLowerCase() === baseName) ?? null;
}

function getBrowserRelativePath(file: File) {
  const path = file.webkitRelativePath || file.name;
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return file.name;
  return parts.slice(1).join("/");
}

function isBrowserRootFile(file: File, fileName: string) {
  const parts = (file.webkitRelativePath || file.name).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 && parts[parts.length - 1]?.toLowerCase() === fileName.toLowerCase();
}

function normalizeRelativeManifestPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes(":")) return null;

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

function getPathBaseName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
}

function getImageMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function buildDirectoryWarnings(importedCount: number, manifestTotal: number | null) {
  if (manifestTotal === null) return [`已按文件名顺序导入 ${importedCount} 个 TXT 文件。`];
  if (importedCount < manifestTotal) {
    return [`检测到完整目录 ${manifestTotal} 章，当前已导入 ${importedCount} 个已采集 TXT 文件。`];
  }
  return [`已按章节目录导入 ${importedCount} 个 TXT 文件。`];
}
