import type { Book } from "../lib/types";

interface BookCoverProps {
  book: Pick<Book, "title" | "author" | "cover" | "fileKind">;
  compact?: boolean;
}

export function BookCover({ book, compact = false }: BookCoverProps) {
  return (
    <div
      className={`book-cover ${compact ? "book-cover--compact" : ""}`}
      style={{
        background: book.cover.tone,
        color: book.cover.accent,
        borderColor: colorWithAlpha(book.cover.accent, 0.26),
      }}
    >
      <div className="book-cover__mark" aria-hidden="true">
        {book.cover.mark}
      </div>
      <div className="book-cover__title">{book.title}</div>
      <div className="book-cover__meta">{book.author || book.fileKind.toUpperCase()}</div>
    </div>
  );
}

function colorWithAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}
