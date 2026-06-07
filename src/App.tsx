import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { deleteBook, getBook, listBooks, saveBook, toBookSummary } from "./lib/bookshelf";
import {
  importBrowserDirectory,
  importBrowserFile,
  importTauriDirectory,
  importTauriFile,
  isTauriRuntime,
} from "./lib/importer";
import type { Book, BookSummary, ImportError, ImportMode, ReaderView } from "./lib/types";
import "./styles.css";

export default function App() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [view, setView] = useState<ReaderView>("library");
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newBookId, setNewBookId] = useState<string | null>(null);

  useEffect(() => {
    listBooks().then(setBooks).catch((reason) => {
      setError({
        title: "书库读取失败",
        message: reason instanceof Error ? reason.message : "无法打开本地书库。",
      });
    });
  }, []);

  const upsertBook = useCallback(async (book: Book) => {
    const summary = toBookSummary(book);
    setBooks((current) => {
      const next = current.some((item) => item.id === book.id)
        ? current.map((item) => (item.id === book.id ? summary : item))
        : [summary, ...current];
      return [...next].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    });
    setActiveBook((current) => (current?.id === book.id ? book : current));
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
      setNewBookId(result.book.id);
      setActiveBookId(null);
      setActiveBook(null);
      setView("library");
      setNotice(result.warnings.length > 0 ? result.warnings.join(" ") : `已导入《${result.book.title}》。`);
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

  const handleOpen = async (book: BookSummary) => {
    const fullBook = await getBook(book.id);
    if (!fullBook) {
      setError({
        title: "无法打开这本书",
        message: "本地书库里缺少这本书的章节数据，请重新导入。",
      });
      return;
    }

    const updated = { ...fullBook, lastOpenedAt: Date.now() };
    await upsertBook(updated);
    if (newBookId === book.id) setNewBookId(null);
    setActiveBookId(book.id);
    setActiveBook(updated);
    setView("reader");
  };

  const handleDelete = async (book: BookSummary) => {
    await deleteBook(book.id);
    setBooks((current) => current.filter((item) => item.id !== book.id));
    if (newBookId === book.id) setNewBookId(null);
    if (activeBookId === book.id) {
      setActiveBookId(null);
      setActiveBook(null);
      setView("library");
    }
  };

  const handleUpdateBookInfo = async (
    book: BookSummary,
    updates: { title: string; author?: string; coverImageUrl?: string },
  ) => {
    const fullBook = await getBook(book.id);
    if (!fullBook) {
      setError({
        title: "无法编辑这本书",
        message: "本地书库里缺少这本书的章节数据，请重新导入。",
      });
      return;
    }

    const title = updates.title.trim() || fullBook.title;
    const author = updates.author?.trim() || undefined;
    await upsertBook({
      ...fullBook,
      title,
      author,
      cover: {
        ...fullBook.cover,
        mark: title.replace(/\s+/g, "").slice(0, 1) || "书",
        imageUrl: updates.coverImageUrl || undefined,
      },
    });
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
        onBack={() => {
          setView("library");
          setActiveBookId(null);
          setActiveBook(null);
        }}
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
      newBookId={newBookId}
      onImport={handleImport}
      onDismissNotice={() => setNotice(null)}
      onOpen={handleOpen}
      onDelete={handleDelete}
      onUpdateBookInfo={handleUpdateBookInfo}
    />
  );
}
