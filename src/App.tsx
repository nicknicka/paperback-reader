import { useCallback, useEffect, useMemo, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { deleteBook, listBooks, saveBook } from "./lib/bookshelf";
import {
  importBrowserDirectory,
  importBrowserFile,
  importTauriDirectory,
  importTauriFile,
  isTauriRuntime,
} from "./lib/importer";
import type { Book, ImportError, ImportMode, ReaderView } from "./lib/types";
import "./styles.css";

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [view, setView] = useState<ReaderView>("library");
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeBook = useMemo(
    () => books.find((book) => book.id === activeBookId) ?? null,
    [activeBookId, books],
  );

  useEffect(() => {
    listBooks().then(setBooks).catch((reason) => {
      setError({
        title: "书库读取失败",
        message: reason instanceof Error ? reason.message : "无法打开本地书库。",
      });
    });
  }, []);

  const upsertBook = useCallback(async (book: Book) => {
    setBooks((current) => {
      const next = current.some((item) => item.id === book.id)
        ? current.map((item) => (item.id === book.id ? book : item))
        : [book, ...current];
      return [...next].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    });
    await saveBook(book);
  }, []);

  const handleImport = async (mode: ImportMode, payload?: File | FileList) => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        mode === "file"
          ? payload instanceof File
            ? await importBrowserFile(payload)
            : isTauriRuntime()
              ? await importTauriFile()
              : null
          : payload instanceof FileList
            ? await importBrowserDirectory(payload)
            : isTauriRuntime()
              ? await importTauriDirectory()
              : null;

      if (!result) return;
      await upsertBook(result.book);
      setActiveBookId(result.book.id);
      setView("reader");
      if (result.warnings.length > 0) {
        setNotice(result.warnings.join(" "));
      }
    } catch (reason) {
      const fallback = reason as Partial<ImportError>;
      setError({
        title: fallback.title ?? "导入失败",
        message: fallback.message ?? (reason instanceof Error ? reason.message : "文件无法读取。"),
      });
    } finally {
      setImporting(false);
    }
  };

  const handleOpen = async (book: Book) => {
    const updated = { ...book, lastOpenedAt: Date.now() };
    await upsertBook(updated);
    setActiveBookId(book.id);
    setView("reader");
  };

  const handleDelete = async (book: Book) => {
    await deleteBook(book.id);
    setBooks((current) => current.filter((item) => item.id !== book.id));
    if (activeBookId === book.id) {
      setActiveBookId(null);
      setView("library");
    }
  };

  const handleReaderChange = useCallback(
    (book: Book) => {
      void upsertBook(book);
    },
    [upsertBook],
  );

  if (view === "reader" && activeBook) {
    return (
      <Reader
        book={activeBook}
        onBack={() => setView("library")}
        onChange={handleReaderChange}
      />
    );
  }

  return (
    <Library
      books={books}
      importing={importing}
      error={error}
      notice={notice}
      onImport={handleImport}
      onOpen={handleOpen}
      onDelete={handleDelete}
    />
  );
}
