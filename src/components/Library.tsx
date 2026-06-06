import { useRef, useState } from "react";
import { BookCover } from "./BookCover";
import { isTauriRuntime } from "../lib/importer";
import type { Book, ImportError, ImportMode } from "../lib/types";

interface LibraryProps {
  books: Book[];
  importing: boolean;
  error: ImportError | null;
  notice: string | null;
  onImport: (mode: ImportMode, payload?: File | FileList) => void;
  onOpen: (book: Book) => void;
  onDelete: (book: Book) => void;
}

export function Library({ books, importing, error, notice, onImport, onOpen, onDelete }: LibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
          <p className="app-label">Paperback Reader</p>
          <h1>本地书库</h1>
          {books.length > 0 && <p className="library-count">{books.length} 本书</p>}
        </div>
        <div className="import-menu">
          <button
            className="button button--primary"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={importing}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            {importing ? "导入中" : "导入小说"}
          </button>
          {menuOpen && (
            <div className="import-menu__panel" role="menu">
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
          <strong>导入完成</strong>
          <span>{notice}</span>
        </section>
      )}

      {books.length === 0 ? (
        <section className="empty-library">
          <div className="empty-library__cover" aria-hidden="true">
            书
          </div>
          <h2>把小说放进一个安静的地方。</h2>
          <p>导入单个文件，或选择一个由多个 TXT 组成的目录。本地保存，不需要账号。</p>
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
              <button className="book-card__open" onClick={() => onOpen(book)}>
                <BookCover book={book} />
                <div className="book-card__body">
                  <h2>{book.title}</h2>
                  <p>{book.chapters[book.progress.chapterIndex]?.title ?? "正文"}</p>
                  <span>{progressLabel(book)}</span>
                </div>
              </button>
              <button className="book-card__delete" onClick={() => onDelete(book)} aria-label={`删除 ${book.title}`} title="删除">
                删除
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function progressLabel(book: Book) {
  const chapterCount = Math.max(book.chapters.length, 1);
  const percent = Math.round(((book.progress.chapterIndex + 1) / chapterCount) * 100);
  return `阅读进度 ${percent}%`;
}
