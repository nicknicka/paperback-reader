import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BookCover } from "./BookCover";
import { isTauriRuntime } from "../lib/importer";
import type { BookSummary, ImportError, ImportMode } from "../lib/types";

interface LibraryProps {
  books: BookSummary[];
  importing: boolean;
  error: ImportError | null;
  notice: string | null;
  newBookId: string | null;
  onImport: (mode: ImportMode, payload?: File | FileList) => void;
  onDismissNotice: () => void;
  onOpen: (book: BookSummary) => void;
  onDelete: (book: BookSummary) => void;
  onUpdateBookInfo: (
    book: BookSummary,
    updates: { title: string; author?: string; coverImageUrl?: string },
  ) => Promise<void>;
}

export function Library({
  books,
  importing,
  error,
  notice,
  newBookId,
  onImport,
  onDismissNotice,
  onOpen,
  onDelete,
  onUpdateBookInfo,
}: LibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<BookSummary | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (importMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (importing) setMenuOpen(false);
  }, [importing]);

  const pickFile = () => {
    setMenuOpen(false);
    if (isTauriRuntime()) {
      onImport("file");
      return;
    }
    fileInputRef.current?.click();
  };
  const pickDirectory = () => {
    setMenuOpen(false);
    if (isTauriRuntime()) {
      onImport("directory");
      return;
    }
    directoryInputRef.current?.click();
  };

  return (
    <main className="library-shell">
      <header className="library-header">
        <div>
          <h1>本地书库</h1>
          {books.length > 0 && <p className="library-count">{books.length} 本书</p>}
        </div>
        <div className="import-menu" ref={importMenuRef}>
          <button
            className="button button--primary"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={importing}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls="import-menu-panel"
          >
            {importing ? "导入中" : "导入小说"}
          </button>
          {menuOpen && (
            <div className="import-menu__panel" id="import-menu-panel" role="menu">
              <button role="menuitem" onClick={pickFile}>
                <strong>导入文件</strong>
                <span>TXT、DOCX 或 DOC</span>
              </button>
              <button role="menuitem" onClick={pickDirectory}>
                <strong>导入目录</strong>
                <span>多个 TXT 合并为一本书</span>
              </button>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          className="file-input-hidden"
          aria-hidden="true"
          tabIndex={-1}
          type="file"
          accept=".txt,.doc,.docx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport("file", file);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={directoryInputRef}
          className="file-input-hidden"
          aria-hidden="true"
          tabIndex={-1}
          type="file"
          webkitdirectory=""
          multiple
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) onImport("directory", files);
            event.currentTarget.value = "";
          }}
        />
      </header>

      {error && (
        <section className="notice notice--error" role="alert">
          <strong>{error.title}</strong>
          <span>{error.message}</span>
        </section>
      )}
      {!error && notice && (
        <section className="notice" role="status">
          <div className="notice__body">
            <strong>导入完成</strong>
            <span>{notice}</span>
          </div>
          <button className="notice__close" type="button" onClick={onDismissNotice} aria-label="关闭导入完成提示">
            ×
          </button>
        </section>
      )}

      {books.length === 0 ? (
        <section className="empty-library">
          <div className="empty-library__cover" aria-hidden="true">
            书
          </div>
          <h2>把小说放进一个安静的地方。</h2>
          <div className="empty-library__actions">
            <button className="button button--primary" onClick={pickFile} disabled={importing}>
              导入文件
            </button>
            <button className="button" onClick={pickDirectory} disabled={importing}>
              导入目录
            </button>
          </div>
        </section>
      ) : (
        <section className="book-grid" aria-label="本地书籍">
          {books.map((book) => (
            <article className="book-card" key={book.id}>
              {book.id === newBookId && <span className="book-card__badge">新书</span>}
              <button className="book-card__open" onClick={() => onOpen(book)}>
                <BookCover book={book} />
                <div className="book-card__body">
                  <h2>{book.title}</h2>
                  <p>{book.currentChapterTitle}</p>
                  <span>{progressLabel(book)}</span>
                </div>
              </button>
              <div className="book-card__actions">
                <button onClick={() => setEditingBook(book)} aria-label={`编辑 ${book.title}`} title="编辑">
                  编辑
                </button>
                <button onClick={() => onDelete(book)} aria-label={`删除 ${book.title}`} title="删除">
                  删除
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {editingBook && (
        <BookEditDialog
          book={editingBook}
          onClose={() => setEditingBook(null)}
          onSave={async (updates) => {
            await onUpdateBookInfo(editingBook, updates);
          }}
        />
      )}
    </main>
  );
}

function progressLabel(book: BookSummary) {
  const chapterCount = Math.max(book.chapterCount, 1);
  const percent = Math.round(((book.progress.chapterIndex + 1) / chapterCount) * 100);
  return `阅读进度 ${percent}%`;
}

function BookEditDialog({
  book,
  onClose,
  onSave,
}: {
  book: BookSummary;
  onClose: () => void;
  onSave: (updates: { title: string; author?: string; coverImageUrl?: string }) => Promise<void>;
}) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(book.cover.imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isClosing]);

  useEffect(() => {
    if (!isClosing) return;

    const handle = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(handle);
  }, [isClosing, onClose]);

  function requestClose() {
    if (isClosing) return;
    setIsClosing(true);
  }

  async function handleCoverFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLocalError("请选择图片文件。");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setLocalError("封面图片不能超过 3MB。");
      return;
    }

    setLocalError(null);
    setCoverImageUrl(await readFileAsDataUrl(file));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setLocalError("书名不能为空。");
      return;
    }

    setSaving(true);
    setLocalError(null);
    try {
      await onSave({
        title,
        author,
        coverImageUrl,
      });
      requestClose();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "保存失败，请稍后重试。");
      setSaving(false);
    }
  }

  const previewBook = {
    ...book,
    title,
    author: author.trim() || undefined,
    cover: {
      ...book.cover,
      imageUrl: coverImageUrl || undefined,
    },
  };

  return (
    <div
      className={`modal-backdrop ${isClosing ? "is-closing" : ""}`}
      role="presentation"
      onAnimationEnd={(event) => {
        if (isClosing && event.target === event.currentTarget) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <form className="book-edit-dialog" role="dialog" aria-modal="true" aria-label={`编辑 ${book.title}`} onSubmit={handleSubmit}>
        <div className="book-edit-dialog__cover">
          <BookCover book={previewBook} />
          <input
            ref={coverInputRef}
            className="file-input-hidden"
            aria-hidden="true"
            tabIndex={-1}
            type="file"
            accept="image/*"
            onChange={(event) => {
              void handleCoverFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button type="button" className="text-button" onClick={() => coverInputRef.current?.click()}>
            选择图片
          </button>
          {coverImageUrl && (
            <button type="button" className="text-button" onClick={() => setCoverImageUrl("")}>
              移除封面
            </button>
          )}
        </div>

        <div className="book-edit-dialog__body">
          <div>
            <p className="app-label">编辑书籍信息</p>
            <h2>{book.title}</h2>
          </div>
          <label className="field">
            <span>书名</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
          </label>
          <label className="field">
            <span>作者</span>
            <input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={60} placeholder="可留空" />
          </label>
          <div className="book-edit-dialog__meta" aria-label="导入信息">
            <span>{book.fileKind.toUpperCase()}</span>
            <span>{book.sourceKind === "directory" ? "目录导入" : "文件导入"}</span>
            <span>{book.chapterCount} 章</span>
          </div>
          {localError && <p className="book-edit-dialog__error">{localError}</p>}
          <div className="book-edit-dialog__actions">
            <button type="button" className="button" onClick={requestClose}>
              取消
            </button>
            <button type="submit" className="button button--primary" disabled={saving}>
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
