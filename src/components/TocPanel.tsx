import type { Book } from "../lib/types";

interface TocPanelProps {
  book: Book;
  activeChapter: number;
  onSelect: (chapterIndex: number) => void;
}

export function TocPanel({ book, activeChapter, onSelect }: TocPanelProps) {
  return (
    <aside className="side-panel toc-panel" aria-label="目录">
      <h2>目录</h2>
      <nav>
        {book.chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            className={index === activeChapter ? "is-active" : ""}
            onClick={() => onSelect(index)}
          >
            {chapter.title}
          </button>
        ))}
      </nav>
    </aside>
  );
}
