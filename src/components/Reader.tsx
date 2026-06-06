import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { paginateFromOffset, paginateParagraphs, paginatePreviousPage } from "../lib/pagination";
import { fontStacks } from "../lib/defaults";
import type { Book, Page, ReaderSettings } from "../lib/types";
import { SettingsPanel } from "./SettingsPanel";
import { TocPanel } from "./TocPanel";

gsap.registerPlugin(useGSAP);

interface ReaderProps {
  book: Book;
  onBack: () => void;
  onChange: (book: Book) => void;
}

export function Reader({ book, onBack, onChange }: ReaderProps) {
  const hasStoredCharOffset = typeof book.progress.charOffset === "number";
  const [chapterIndex, setChapterIndex] = useState(book.progress.chapterIndex);
  const [pages, setPages] = useState<Page[]>([]);
  const [anchorOffset, setAnchorOffset] = useState(book.progress.charOffset ?? 0);
  const [pagesBeforeAnchor, setPagesBeforeAnchor] = useState(hasStoredCharOffset ? book.progress.pagesBeforeAnchor ?? book.progress.pageIndex ?? 0 : 0);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTopChrome, setShowTopChrome] = useState(false);
  const [showBottomChrome, setShowBottomChrome] = useState(false);
  const [pageBox, setPageBox] = useState({ width: 0, height: 0 });
  const [isPaginating, setIsPaginating] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const turnDirectionRef = useRef(1);
  const jumpToChapterEndRef = useRef(false);
  const latestBookRef = useRef(book);
  const forcedFirstPageRef = useRef<Page | null>(null);
  const pageCacheRef = useRef(new Map<string, Page[]>());
  const idleHandleRef = useRef<number | null>(null);
  const idleCancelRef = useRef<((handle: number) => void) | null>(null);
  const topChromeHideRef = useRef<number | null>(null);
  const bottomChromeHideRef = useRef<number | null>(null);
  const legacyPageIndexRef = useRef<number | null>(hasStoredCharOffset ? null : book.progress.pageIndex);
  latestBookRef.current = book;

  const chapter = book.chapters[chapterIndex] ?? book.chapters[0];
  const settings = book.settings;
  const chapterParagraphs = useMemo(() => {
    if (!chapter) return [];
    return chapter.paragraphs;
  }, [chapter]);
  const settingsKey = useMemo(
    () =>
      [
        settings.fontSize,
        settings.lineHeight,
        settings.pageMargin,
        settings.paragraphGap,
        settings.fontFamily,
        settings.theme,
      ].join(":"),
    [settings],
  );
  const pageBoxKey = `${Math.round(pageBox.width)}x${Math.round(pageBox.height)}`;
  const paginationKey = chapter ? makePaginationKey(book.id, chapter.id, anchorOffset, pageBoxKey, settingsKey) : "";

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const updateSize = () => {
      setPageBox({
        width: page.offsetWidth,
        height: page.offsetHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("is-reader-open");
    document.body.classList.add("is-reader-open");
    return () => {
      if (topChromeHideRef.current !== null) window.clearTimeout(topChromeHideRef.current);
      if (bottomChromeHideRef.current !== null) window.clearTimeout(bottomChromeHideRef.current);
      document.documentElement.classList.remove("is-reader-open");
      document.body.classList.remove("is-reader-open");
    };
  }, []);

  useEffect(() => {
    if (!measureRef.current || pageBox.width === 0 || pageBox.height === 0 || chapterParagraphs.length === 0) return;

    const forcedFirstPage = forcedFirstPageRef.current;
    if (!forcedFirstPage) {
      const cached = pageCacheRef.current.get(paginationKey);
      if (cached) {
        applyPages(cached);
        return;
      }
    }

    setIsPaginating(true);
    const frame = window.requestAnimationFrame(() => {
      if (!measureRef.current) return;
      const forcedFirstPage = forcedFirstPageRef.current;
      let nextPages = paginateFromOffset(chapterParagraphs, measureRef.current, settings, anchorOffset);
      if (forcedFirstPage?.startOffset === anchorOffset) {
        forcedFirstPageRef.current = null;
        nextPages = [
          forcedFirstPage,
          ...paginateFromOffset(chapterParagraphs, measureRef.current, settings, forcedFirstPage.endOffset),
        ];
      } else {
        storePagesInCache(pageCacheRef.current, paginationKey, nextPages);
      }
      applyPages(nextPages);
      setIsPaginating(false);
      scheduleAdjacentPagination();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      cancelAdjacentPagination();
      setIsPaginating(false);
    };
  }, [anchorOffset, chapterParagraphs, paginationKey, pageBox.width, pageBox.height, settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === "Escape") {
        setShowToc(false);
        setShowSettings(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const progressPage = pages[0];
    if (!progressPage) return;

    const latestBook = latestBookRef.current;
    const updated: Book = {
      ...latestBook,
      lastOpenedAt: Date.now(),
      progress: {
        chapterIndex,
        pageIndex: pagesBeforeAnchor,
        charOffset: progressPage.startOffset,
        pagesBeforeAnchor,
        updatedAt: Date.now(),
      },
    };
    onChange(updated);
  }, [chapterIndex, pages, pagesBeforeAnchor, onChange]);

  const page = pages[0];
  const currentPageNumber = pagesBeforeAnchor + 1;
  const totalPages = pagesBeforeAnchor + (pages.length || 1);
  const pageAnimationKey = `${chapterIndex}:${anchorOffset}:${page?.startOffset ?? "empty"}`;

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!shellRef.current || reduce) return;

      gsap.fromTo(
        shellRef.current,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out", clearProps: "opacity,visibility,transform" },
      );
    },
    { scope: shellRef },
  );

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = pageRef.current;
      if (!target || !page || reduce) return;

      const direction = turnDirectionRef.current;
      gsap.fromTo(
        target,
        {
          autoAlpha: 0,
          x: direction * 14,
          scale: 0.996,
        },
        {
          autoAlpha: 1,
          x: 0,
          scale: 1,
          duration: 0.22,
          ease: "power2.out",
          overwrite: "auto",
          clearProps: "opacity,visibility,transform",
        },
      );
    },
    { scope: stageRef, dependencies: [pageAnimationKey] },
  );

  function applyPages(nextPages: Page[]) {
    if (legacyPageIndexRef.current !== null && anchorOffset === 0) {
      const legacyPageIndex = Math.min(legacyPageIndexRef.current, Math.max(nextPages.length - 1, 0));
      legacyPageIndexRef.current = null;
      const legacyPage = nextPages[legacyPageIndex];
      if (legacyPage && legacyPage.startOffset > 0) {
        setPagesBeforeAnchor(legacyPageIndex);
        setAnchorOffset(legacyPage.startOffset);
        return;
      }
    }

    if (jumpToChapterEndRef.current) {
      jumpToChapterEndRef.current = false;
      const lastPage = nextPages.at(-1);
      const nextPrefix = Math.max(nextPages.length - 1, 0);
      setPagesBeforeAnchor(nextPrefix);
      if (lastPage && lastPage.startOffset !== anchorOffset) {
        setAnchorOffset(lastPage.startOffset);
        return;
      }
      setPages(lastPage ? [lastPage] : nextPages);
      return;
    }

    setPages(nextPages);
  }

  function scheduleAdjacentPagination() {
    cancelAdjacentPagination();
    const idle =
      window.requestIdleCallback?.bind(window) ??
      ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 350));
    const cancelIdle =
      window.cancelIdleCallback?.bind(window) ??
      ((handle: number) => window.clearTimeout(handle));
    idleCancelRef.current = cancelIdle;
    idleHandleRef.current = idle(() => {
      idleHandleRef.current = null;
      const measure = measureRef.current;
      if (!measure) return;
      for (const adjacentIndex of [chapterIndex + 1, chapterIndex - 1]) {
        const adjacent = book.chapters[adjacentIndex];
        if (!adjacent) continue;
        const key = makePaginationKey(book.id, adjacent.id, 0, pageBoxKey, settingsKey);
        if (pageCacheRef.current.has(key)) continue;
        const adjacentPages = paginateParagraphs(adjacent.paragraphs, measure, settings);
        storePagesInCache(pageCacheRef.current, key, adjacentPages);
      }
    });
  }

  function cancelAdjacentPagination() {
    if (idleHandleRef.current === null) return;
    idleCancelRef.current?.(idleHandleRef.current);
    idleHandleRef.current = null;
  }

  function goNext() {
    turnDirectionRef.current = 1;
    const nextPage = pages[1];
    if (nextPage) {
      setPagesBeforeAnchor((current) => current + 1);
      setAnchorOffset(nextPage.startOffset);
      return;
    }

    if (chapterIndex + 1 < book.chapters.length) {
      setPagesBeforeAnchor(0);
      setAnchorOffset(0);
      setChapterIndex(chapterIndex + 1);
    }
  }

  function goPrevious() {
    turnDirectionRef.current = -1;
    const measure = measureRef.current;
    if (measure && anchorOffset > 0) {
      const previousPage = paginatePreviousPage(chapterParagraphs, measure, settings, anchorOffset);
      if (!previousPage) return;

      if (previousPage.startOffset === 0) {
        setPagesBeforeAnchor(0);
        setAnchorOffset(0);
        return;
      }

      forcedFirstPageRef.current = previousPage;
      setPagesBeforeAnchor((current) => Math.max(current - 1, 0));
      setAnchorOffset(previousPage.startOffset);
      return;
    }

    if (chapterIndex > 0) {
      jumpToChapterEndRef.current = true;
      setPagesBeforeAnchor(0);
      setAnchorOffset(0);
      setChapterIndex(chapterIndex - 1);
    }
  }

  function updateSettings(settings: ReaderSettings) {
    onChange({
      ...book,
      settings,
      progress: {
        chapterIndex,
        pageIndex: pagesBeforeAnchor,
        charOffset: anchorOffset,
        pagesBeforeAnchor,
        updatedAt: Date.now(),
      },
    });
  }

  function toggleToc() {
    setShowSettings(false);
    setShowToc((value) => !value);
  }

  function toggleSettings() {
    setShowToc(false);
    setShowSettings((value) => !value);
  }

  function closePanels() {
    setShowToc(false);
    setShowSettings(false);
  }

  function showChrome(area: "top" | "bottom") {
    const hideRef = area === "top" ? topChromeHideRef : bottomChromeHideRef;
    if (hideRef.current !== null) {
      window.clearTimeout(hideRef.current);
      hideRef.current = null;
    }
    if (area === "top") setShowTopChrome(true);
    else setShowBottomChrome(true);
  }

  function hideChromeSoon(area: "top" | "bottom") {
    scheduleChromeHide(area, 420);
  }

  function scheduleChromeHide(area: "top" | "bottom", delay: number) {
    const hideRef = area === "top" ? topChromeHideRef : bottomChromeHideRef;
    if (hideRef.current !== null) window.clearTimeout(hideRef.current);
    hideRef.current = window.setTimeout(() => {
      if (area === "top") setShowTopChrome(false);
      else setShowBottomChrome(false);
      hideRef.current = null;
    }, delay);
  }

  function revealReaderChrome() {
    showChrome("top");
    showChrome("bottom");
    scheduleChromeHide("top", 2600);
    scheduleChromeHide("bottom", 2600);
  }

  function hideReaderChrome() {
    if (topChromeHideRef.current !== null) {
      window.clearTimeout(topChromeHideRef.current);
      topChromeHideRef.current = null;
    }
    if (bottomChromeHideRef.current !== null) {
      window.clearTimeout(bottomChromeHideRef.current);
      bottomChromeHideRef.current = null;
    }
    setShowTopChrome(false);
    setShowBottomChrome(false);
  }

  function toggleReaderChrome() {
    if (showTopChrome || showBottomChrome) {
      hideReaderChrome();
      return;
    }

    revealReaderChrome();
  }

  function handleStagePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;

    if (showToc || showSettings) {
      closePanels();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const leftBoundary = rect.width * 0.32;
    const rightBoundary = rect.width * 0.68;

    if (x < leftBoundary) {
      goPrevious();
      return;
    }

    if (x > rightBoundary) {
      goNext();
      return;
    }

    toggleReaderChrome();
  }

  return (
    <main
      ref={shellRef}
      className={`reader-shell theme-${settings.theme}`}
      style={
        {
          "--reader-font": fontStacks[settings.fontFamily],
          "--reader-margin": `${settings.pageMargin}px`,
        } as CSSProperties
      }
    >
      <div
        className={`reader-chrome reader-chrome--top ${showTopChrome ? "is-visible" : ""}`}
        onMouseEnter={() => showChrome("top")}
        onMouseMove={() => showChrome("top")}
        onMouseLeave={() => hideChromeSoon("top")}
      >
        <header className="reader-topbar">
          <button className="text-button text-button--back" aria-label="返回书库" onClick={onBack}>
            <span aria-hidden="true">‹</span>
          </button>
          <nav aria-label="阅读工具">
            <button
              className={`text-button ${showToc ? "is-active" : ""}`}
              aria-pressed={showToc}
              onClick={toggleToc}
            >
              目录
            </button>
            <button
              className={`text-button ${showSettings ? "is-active" : ""}`}
              aria-pressed={showSettings}
              onClick={toggleSettings}
            >
              排版
            </button>
          </nav>
        </header>
      </div>

      <div className={`reader-workspace ${showToc ? "has-toc" : ""} ${showSettings ? "has-settings" : ""}`}>
        {showToc && <TocPanel book={book} activeChapter={chapterIndex} onSelect={(index) => {
          turnDirectionRef.current = index >= chapterIndex ? 1 : -1;
          setPagesBeforeAnchor(0);
          setAnchorOffset(0);
          setChapterIndex(index);
        }} />}

        <section className="reader-stage" ref={stageRef} aria-label="阅读正文" onPointerDown={handleStagePointerDown}>
          <div className="reader-chapter-badge" aria-label="当前章节">
            <strong>{chapter?.title ?? "正文"}</strong>
          </div>
          <article
            ref={pageRef}
            className="reader-page"
            data-start-offset={page?.startOffset ?? 0}
            data-end-offset={page?.endOffset ?? 0}
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              "--reader-margin": `${settings.pageMargin}px`,
              "--paragraph-gap": `${settings.paragraphGap}px`,
            } as CSSProperties}
          >
            {page ? (
              page.blocks.map((block, index) => (
                <p
                  key={`${block.paragraphIndex}-${block.startOffset}-${block.endOffset}-${index}`}
                  className={block.startsParagraph ? undefined : "is-continuation"}
                  data-start-offset={block.startOffset}
                  data-end-offset={block.endOffset}
                >
                  {block.text}
                </p>
              ))
            ) : (
              <p>{isPaginating ? "正在分页..." : "正在准备正文..."}</p>
            )}
          </article>
          <div
            ref={measureRef}
            className="reader-page reader-page--measure"
            style={{
              width: `${pageBox.width}px`,
              height: `${pageBox.height}px`,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              "--reader-margin": `${settings.pageMargin}px`,
              "--paragraph-gap": `${settings.paragraphGap}px`,
            } as CSSProperties}
          />
          <div className="reader-page-indicator" aria-label="阅读进度">
            {currentPageNumber} / {totalPages}
          </div>
        </section>

        {showSettings && <SettingsPanel settings={settings} onChange={updateSettings} />}
      </div>

      <div
        className={`reader-chrome reader-chrome--bottom ${showBottomChrome ? "is-visible" : ""}`}
        onMouseEnter={() => showChrome("bottom")}
        onMouseMove={() => showChrome("bottom")}
        onMouseLeave={() => hideChromeSoon("bottom")}
      >
        <footer className="reader-footer">
          <button className="text-button" onClick={goPrevious}>
            上一页
          </button>
          <span>
            {currentPageNumber} / {totalPages} · {chapterIndex + 1} / {book.chapters.length}
          </span>
          <button className="text-button" onClick={goNext}>
            下一页
          </button>
        </footer>
      </div>
    </main>
  );
}

function makePaginationKey(bookId: string, chapterId: string, anchorOffset: number, pageBoxKey: string, settingsKey: string) {
  return `${bookId}:${chapterId}:${anchorOffset}:${pageBoxKey}:${settingsKey}`;
}

function storePagesInCache(cache: Map<string, Page[]>, key: string, pages: Page[]) {
  cache.set(key, pages);
  if (cache.size <= 48) return;
  const oldest = cache.keys().next().value;
  if (oldest) cache.delete(oldest);
}
