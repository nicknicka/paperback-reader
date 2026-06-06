import { defaultSettings, normalizeSettings } from "./defaults";
import type { Book, BookSummary, Chapter, ReaderSettings, ReadingProgress } from "./types";

const dbName = "paperback-reader";
const dbVersion = 2;
const bookStoreName = "books";
const chapterStoreName = "chapters";
const progressStoreName = "progress";
const settingsStoreName = "settings";
const chapterBookIndex = "byBookId";

type BookRecord = Omit<Book, "chapters" | "settings" | "progress"> & {
  chapterCount: number;
};

type ChapterRecord = Chapter & {
  storageId: string;
  bookId: string;
  index: number;
};

type ProgressRecord = ReadingProgress & {
  bookId: string;
};

type SettingsRecord = ReaderSettings & {
  bookId: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;

      const books = db.objectStoreNames.contains(bookStoreName)
        ? tx.objectStore(bookStoreName)
        : db.createObjectStore(bookStoreName, { keyPath: "id" });
      const chapters = db.objectStoreNames.contains(chapterStoreName)
        ? tx.objectStore(chapterStoreName)
        : db.createObjectStore(chapterStoreName, { keyPath: "storageId" });
      if (!chapters.indexNames.contains(chapterBookIndex)) {
        chapters.createIndex(chapterBookIndex, "bookId", { unique: false });
      }
      const progress = db.objectStoreNames.contains(progressStoreName)
        ? tx.objectStore(progressStoreName)
        : db.createObjectStore(progressStoreName, { keyPath: "bookId" });
      const settings = db.objectStoreNames.contains(settingsStoreName)
        ? tx.objectStore(settingsStoreName)
        : db.createObjectStore(settingsStoreName, { keyPath: "bookId" });

      migrateLegacyBooks(books, chapters, progress, settings);
    };

    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("书库数据库正在被另一个窗口使用，请关闭其它阅读器窗口后重试。"));
  });

  return dbPromise;
}

export async function listBooks(): Promise<BookSummary[]> {
  const db = await openDb();
  const records = await getAll<BookRecord>(db, bookStoreName);
  const summaries = await Promise.all(records.map((record) => readSummary(db, record)));
  return summaries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getBook(id: string): Promise<Book | null> {
  const db = await openDb();
  const [record, chapters, progress, settings] = await Promise.all([
    getOne<BookRecord>(db, bookStoreName, id),
    getBookChapters(db, id),
    getOne<ProgressRecord>(db, progressStoreName, id),
    getOne<SettingsRecord>(db, settingsStoreName, id),
  ]);

  if (!record) return null;
  if (chapters.length === 0) return null;

  const storedSettings = stripBookId(settings);

  return {
    ...record,
    chapters,
    progress: stripBookId(progress) ?? defaultProgress(),
    settings: storedSettings ? normalizeSettings(storedSettings) : { ...defaultSettings },
  };
}

export async function saveBook(book: Book): Promise<void> {
  const db = await openDb();
  const existing = await getOne<BookRecord>(db, bookStoreName, book.id);
  const shouldWriteChapters = !existing || existing.chapterCount !== book.chapters.length;

  await withTransaction(
    db,
    [bookStoreName, progressStoreName, settingsStoreName, ...(shouldWriteChapters ? [chapterStoreName] : [])],
    "readwrite",
    (stores) => {
      getTxStore(stores, bookStoreName).put(toBookRecord(book));
      getTxStore(stores, progressStoreName).put(toProgressRecord(book.id, book.progress));
      getTxStore(stores, settingsStoreName).put(toSettingsRecord(book.id, book.settings));

      if (shouldWriteChapters) {
        const chapterStore = getTxStore(stores, chapterStoreName);
        book.chapters.forEach((chapter, index) => {
          chapterStore.put(toChapterRecord(book.id, chapter, index));
        });
      }
    },
  );
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  const chapterRecords = await getBookChapterRecords(db, id);

  await withTransaction(
    db,
    [bookStoreName, progressStoreName, settingsStoreName, chapterStoreName],
    "readwrite",
    (stores) => {
      getTxStore(stores, bookStoreName).delete(id);
      getTxStore(stores, progressStoreName).delete(id);
      getTxStore(stores, settingsStoreName).delete(id);
      const chapterStore = getTxStore(stores, chapterStoreName);
      for (const chapter of chapterRecords) {
        chapterStore.delete(chapter.storageId);
      }
    },
  );
}

export function toBookSummary(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    fileName: book.fileName,
    fileKind: book.fileKind,
    sourceKind: book.sourceKind,
    contentHash: book.contentHash,
    importedAt: book.importedAt,
    lastOpenedAt: book.lastOpenedAt,
    progress: book.progress,
    chapterCount: book.chapters.length,
    currentChapterTitle: book.chapters[book.progress.chapterIndex]?.title ?? "正文",
    cover: book.cover,
  };
}

async function readSummary(db: IDBDatabase, record: BookRecord): Promise<BookSummary> {
  const progress = stripBookId(await getOne<ProgressRecord>(db, progressStoreName, record.id)) ?? defaultProgress();
  const currentChapter = await getOne<ChapterRecord>(db, chapterStoreName, chapterStorageId(record.id, progress.chapterIndex));

  return {
    id: record.id,
    title: record.title,
    author: record.author,
    fileName: record.fileName,
    fileKind: record.fileKind,
    sourceKind: record.sourceKind,
    contentHash: record.contentHash,
    importedAt: record.importedAt,
    lastOpenedAt: record.lastOpenedAt,
    progress,
    chapterCount: record.chapterCount,
    currentChapterTitle: currentChapter?.title ?? "正文",
    cover: record.cover,
  };
}

function migrateLegacyBooks(
  books: IDBObjectStore,
  chapters: IDBObjectStore,
  progress: IDBObjectStore,
  settings: IDBObjectStore,
) {
  const request = books.getAll();
  request.onsuccess = () => {
    const legacyBooks = request.result.filter(isLegacyBook);
    for (const book of legacyBooks) {
      books.put(toBookRecord(book));
      progress.put(toProgressRecord(book.id, book.progress));
      settings.put(toSettingsRecord(book.id, book.settings));
      book.chapters.forEach((chapter, index) => {
        chapters.put(toChapterRecord(book.id, chapter, index));
      });
    }
  };
}

function isLegacyBook(value: unknown): value is Book {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Book>;
  return Array.isArray(record.chapters);
}

function toBookRecord(book: Book): BookRecord {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    fileName: book.fileName,
    fileKind: book.fileKind,
    sourceKind: book.sourceKind,
    contentHash: book.contentHash,
    importedAt: book.importedAt,
    lastOpenedAt: book.lastOpenedAt,
    cover: book.cover,
    chapterCount: book.chapters.length,
  };
}

function toChapterRecord(bookId: string, chapter: Chapter, index: number): ChapterRecord {
  return {
    ...chapter,
    storageId: chapterStorageId(bookId, index),
    bookId,
    index,
  };
}

function toProgressRecord(bookId: string, progress: ReadingProgress): ProgressRecord {
  return {
    ...progress,
    bookId,
  };
}

function toSettingsRecord(bookId: string, settings: ReaderSettings): SettingsRecord {
  return {
    ...normalizeSettings(settings),
    bookId,
  };
}

function chapterStorageId(bookId: string, index: number) {
  return `${bookId}:${index}`;
}

function defaultProgress(): ReadingProgress {
  return {
    chapterIndex: 0,
    pageIndex: 0,
    updatedAt: Date.now(),
  };
}

function stripBookId<T extends { bookId: string }>(record?: T | null): Omit<T, "bookId"> | null {
  if (!record) return null;
  const { bookId: _bookId, ...rest } = record;
  return rest;
}

async function getBookChapters(db: IDBDatabase, bookId: string): Promise<Chapter[]> {
  const records = await getBookChapterRecords(db, bookId);
  return records.map(({ storageId: _storageId, bookId: _bookId, index: _index, ...chapter }) => chapter);
}

async function getBookChapterRecords(db: IDBDatabase, bookId: string): Promise<ChapterRecord[]> {
  const records = await getAllByIndex<ChapterRecord>(db, chapterStoreName, chapterBookIndex, bookId);
  return records.sort((a, b) => a.index - b.index);
}

async function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return withTransaction(db, [storeName], "readonly", (stores) => getTxStore(stores, storeName).getAll() as IDBRequest<T[]>);
}

async function getOne<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return withTransaction(db, [storeName], "readonly", (stores) => getTxStore(stores, storeName).get(key) as IDBRequest<T>);
}

async function getAllByIndex<T>(
  db: IDBDatabase,
  storeName: string,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  return withTransaction(
    db,
    [storeName],
    "readonly",
    (stores) => getTxStore(stores, storeName).index(indexName).getAll(key) as IDBRequest<T[]>,
  );
}

function getTxStore(stores: Map<string, IDBObjectStore>, storeName: string): IDBObjectStore {
  const store = stores.get(storeName);
  if (!store) throw new Error(`Missing IndexedDB store: ${storeName}`);
  return store;
}

function withTransaction<T>(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  run: (stores: Map<string, IDBObjectStore>) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = new Map(storeNames.map((storeName) => [storeName, tx.objectStore(storeName)]));
    const request = run(stores);
    let result: T;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
