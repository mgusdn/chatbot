"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CounselReport } from "@/types/counseling";
import styles from "./CounselReportOverlay.module.css";

type ReportBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: Array<{ text: string; depth: number }> };

function inlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

export function parseReportMarkdown(markdown: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const paragraph: string[] = [];
  let listItems: Array<{ text: string; depth: number }> = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
    paragraph.length = 0;
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ kind: "list", items: listItems });
    listItems = [];
  };

  markdown.replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    const heading = line.match(/^\s*(##|###)\s+(.+?)\s*$/);
    const listItem = line.match(/^(\s*)-\s+(.+?)\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length as 2 | 3, text: heading[2] });
      return;
    }
    if (listItem) {
      flushParagraph();
      listItems.push({ text: listItem[2], depth: Math.min(2, Math.floor(listItem[1].length / 2)) });
      return;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      return;
    }
    flushList();
    paragraph.push(line.trim());
  });
  flushParagraph();
  flushList();
  return blocks;
}

function renderBlock(block: ReportBlock, key: number): ReactNode {
  if (block.kind === "heading") {
    return block.level === 2
      ? <h2 key={key}>{inlineText(block.text)}</h2>
      : <h3 key={key}>{inlineText(block.text)}</h3>;
  }
  if (block.kind === "list") {
    return (
      <ul key={key}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex} className={item.depth ? styles[`depth${item.depth}`] : undefined}>
            {inlineText(item.text)}
          </li>
        ))}
      </ul>
    );
  }
  return <p key={key}>{inlineText(block.text)}</p>;
}

type ReportSection = { heading: Extract<ReportBlock, { kind: "heading" }>; body: ReportBlock[] };

// A trailing paragraph that's nothing but "#word #word ..." is the closing
// hashtag line, not prose — pull it out and show it unhidden below the
// collapsible sections instead of leaving it stuck inside the last one.
const HASHTAG_LINE = /^(#\S+)(\s+#\S+)*$/;

function isHashtagParagraph(block: ReportBlock): block is Extract<ReportBlock, { kind: "paragraph" }> {
  return block.kind === "paragraph" && HASHTAG_LINE.test(block.text.trim());
}

/** Only ### (level 3) headings start a collapsible section; anything before
 * the first one (intro paragraph, the ## title) renders as a fixed preamble. */
function groupIntoSections(blocks: ReportBlock[]): { preamble: ReportBlock[]; sections: ReportSection[]; hashtags: string | null } {
  const preamble: ReportBlock[] = [];
  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;
  blocks.forEach((block) => {
    if (block.kind === "heading" && block.level === 3) {
      current = { heading: block, body: [] };
      sections.push(current);
      return;
    }
    (current ? current.body : preamble).push(block);
  });

  let hashtags: string | null = null;
  const lastSection = sections[sections.length - 1];
  const lastBlock = lastSection?.body[lastSection.body.length - 1];
  if (lastSection && lastBlock && isHashtagParagraph(lastBlock)) {
    hashtags = lastBlock.text.trim();
    lastSection.body = lastSection.body.slice(0, -1);
  }

  return { preamble, sections, hashtags };
}

export function SafeReportContent({ markdown }: { markdown: string }) {
  const { preamble, sections, hashtags } = groupIntoSections(parseReportMarkdown(markdown));
  const [openSections, setOpenSections] = useState<Set<number>>(() => new Set());

  const toggleSection = (index: number) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className={styles.content}>
      {preamble.map((block, index) => renderBlock(block, index))}
      {sections.map((section, index) => {
        const isOpen = openSections.has(index);
        return (
          <div key={index} className={`${styles.section} ${styles[`section${index + 1}`] ?? ""}`}>
            <button
              type="button"
              className={styles.sectionToggle}
              aria-expanded={isOpen}
              onClick={(event) => {
                event.stopPropagation();
                toggleSection(index);
              }}
            >
              <h3>{inlineText(section.heading.text)}</h3>
              <span className={styles.sectionChevron} aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className={styles.sectionBody}>
                {section.body.map((block, blockIndex) => renderBlock(block, blockIndex))}
              </div>
            )}
          </div>
        );
      })}
      {hashtags && <p className={styles.hashtags}>{hashtags}</p>}
    </div>
  );
}

type CounselReportOverlayProps = {
  report: CounselReport;
  onDismiss: () => void;
};

export function CounselReportOverlay({ report, onDismiss }: CounselReportOverlayProps) {
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    actionRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      // The report has one action. Keeping focus there prevents keyboard users
      // from moving into the paused world behind this modal surface.
      if (event.key === "Tab") {
        event.preventDefault();
        actionRef.current?.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [dismiss]);

  return (
    <motion.section
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid="counsel-report-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <motion.article
        className={styles.card}
        data-testid="counsel-report-card"
        initial={reducedMotion ? false : { opacity: 0, y: 44, rotate: -0.6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: 18, scale: 0.99 }}
        transition={{ duration: reducedMotion ? 0 : 0.44, delay: reducedMotion ? 0 : 0.08, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className={styles.tape} aria-hidden="true" />
        <header className={styles.header}>
          <span className={styles.eyebrow}>PBAO&apos;S SESSION NOTE</span>
          <h1 id={titleId}>마음 정리가 도착했어요</h1>
          <p id={descriptionId}>프바오와 나눈 이야기를 천천히 돌아보세요.</p>
        </header>

        <div className={styles.scroll} data-report-scroll>
          {report.reportFallback && (
            <p className={styles.fallback} role="status">
              연결이 불안정해 기본 양식으로 정리했어요. 대화에서 확인된 내용은 그대로 담았습니다.
            </p>
          )}
          <SafeReportContent markdown={report.markdown} />
        </div>

        <footer className={styles.actions}>
          <p><kbd>Enter</kbd>를 눌러 마을로 돌아갈 수도 있어요.</p>
          <button
            ref={actionRef}
            type="button"
            aria-keyshortcuts="Enter Escape"
            onClick={(event) => {
              event.stopPropagation();
              dismiss();
            }}
          >
            확인하고 계속 둘러보기
          </button>
        </footer>
      </motion.article>
    </motion.section>
  );
}
