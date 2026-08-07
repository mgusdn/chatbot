"use client";

import { motion, useReducedMotion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { counselingApi } from "@/lib/api/counselingClient";
import type { CounselReport, KeepsakeCreateResponse } from "@/types/counseling";
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

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** A loopback address only ever resolves back to the device that opened it. */
function isLoopback(url: string) {
  return LOOPBACK_HOSTS.includes(hostnameOf(url));
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
  const qrCloseRef = useRef<HTMLButtonElement>(null);
  const dismissedRef = useRef(false);
  const [keepsake, setKeepsake] = useState<KeepsakeCreateResponse | null>(null);
  const [keepsakeBusy, setKeepsakeBusy] = useState(false);
  const [keepsakeError, setKeepsakeError] = useState<string | null>(null);

  const [lanOrigin, setLanOrigin] = useState<string | null>(null);
  const [lanAddresses, setLanAddresses] = useState<string[] | null>(null);

  // Asked for once per report rather than per letter, so the QR appears without
  // a network round trip when the visitor taps through quickly.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/lan-origin", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { origin?: string | null; addresses?: string[] } | null) => {
        if (!data) return;
        setLanOrigin(data.origin ?? null);
        setLanAddresses(data.addresses ?? []);
      })
      .catch(() => {
        // Detection is a convenience; the address bar is still authoritative.
      });
    return () => controller.abort();
  }, []);

  // The address the booth browser is already open at wins whenever a phone
  // could reach it: the operator typed the venue's IP, so by definition it is
  // routable from the same wifi. A stale NEXT_PUBLIC_APP_URL must never be able
  // to override that — a hardcoded IP is wrong the moment the network changes.
  const publicBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const strip = (value: string) => value.replace(/\/$/, "");
    const here = window.location.origin;
    if (!isLoopback(here)) return strip(here);
    const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (configured && !isLoopback(configured)) return strip(configured);
    // Opened at localhost with nothing configured: fall back to the address the
    // server sees on its own interfaces, so the QR still works.
    if (lanOrigin) return strip(lanOrigin);
    return strip(here);
  }, [lanOrigin]);

  const shareUrl = keepsake ? `${publicBaseUrl}/letter/${keepsake.share_token}` : "";
  const shareHost = shareUrl ? hostnameOf(shareUrl) : "";
  const localOnlyUrl = shareUrl ? isLoopback(shareUrl) : false;
  // A literal IPv4 that no longer matches any interface means the configured
  // address went stale — the venue reassigned it, and the phone would hit a host
  // that is not this laptop. Hostnames are left alone: they resolve elsewhere.
  const staleHostUrl = Boolean(shareUrl)
    && !localOnlyUrl
    && /^\d{1,3}(\.\d{1,3}){3}$/.test(shareHost)
    && lanAddresses !== null
    && lanAddresses.length > 0
    && !lanAddresses.includes(shareHost);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (keepsake) qrCloseRef.current?.focus({ preventScroll: true });
    else actionRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && keepsake) {
        event.preventDefault();
        setKeepsake(null);
        window.setTimeout(() => actionRef.current?.focus({ preventScroll: true }), 0);
        return;
      }
      if ((event.key === "Enter" || event.key === "Escape") && !keepsakeBusy) {
        event.preventDefault();
        dismiss();
        return;
      }
      // The report has one action. Keeping focus there prevents keyboard users
      // from moving into the paused world behind this modal surface.
      if (event.key === "Tab") {
        event.preventDefault();
        if (keepsake) qrCloseRef.current?.focus({ preventScroll: true });
        else actionRef.current?.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [dismiss, keepsake, keepsakeBusy]);

  const createKeepsake = useCallback(async () => {
    if (keepsakeBusy) return;
    setKeepsakeBusy(true);
    setKeepsakeError(null);
    try {
      setKeepsake(await counselingApi.createKeepsake(report.experimentId));
    } catch (error) {
      setKeepsakeError(error instanceof Error ? error.message : "기념 편지를 만들지 못했어요.");
    } finally {
      setKeepsakeBusy(false);
    }
  }, [keepsakeBusy, report.experimentId]);

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setKeepsakeError("링크를 복사하지 못했어요. QR을 휴대폰 카메라로 비춰주세요.");
    }
  }, [shareUrl]);

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
          <div className={styles.actionCopy}>
            <strong>오늘 발견한 마음을 편지로 간직해보세요.</strong>
            <span>{keepsakeError || "휴대폰으로 받아 2×3인치 사진으로 인쇄할 수 있어요."}</span>
          </div>
          <div className={styles.actionButtons}>
            <button
              type="button"
              className={styles.keepsakeButton}
              disabled={keepsakeBusy}
              onClick={(event) => {
                event.stopPropagation();
                void createKeepsake();
              }}
            >
              {keepsakeBusy ? "편지를 만드는 중…" : "기념 편지 가져가기"}
            </button>
            <button
              ref={actionRef}
              type="button"
              className={styles.continueButton}
              aria-keyshortcuts="Enter Escape"
              onClick={(event) => {
                event.stopPropagation();
                dismiss();
              }}
            >
              확인하고 계속 둘러보기
            </button>
          </div>
        </footer>

        {keepsake && shareUrl ? (
          <div
            className={styles.qrOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="기념 편지 QR"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.qrPanel}>
              <span className={styles.qrEyebrow}>YOUR KEEPSAKE IS READY</span>
              <h2>{keepsake.letter.recipient_name}님의 편지가 준비됐어요</h2>
              <p>휴대폰 카메라로 QR을 비추면 편지를 사진으로 저장할 수 있어요.</p>
              <div className={styles.qrCode}>
                <QRCodeSVG
                  value={shareUrl}
                  size={224}
                  level="M"
                  marginSize={2}
                  bgColor="#fffdf5"
                  fgColor="#3f4e40"
                  title="기념 편지 열기"
                />
              </div>
              <p className={styles.qrUrl} data-testid="keepsake-share-url">{shareUrl}</p>
              {localOnlyUrl ? (
                <p className={styles.qrWarning} role="status">
                  ⚠️ 이 QR은 현재 컴퓨터에서만 열 수 있어요. 이 컴퓨터가 와이파이에 연결됐는지 확인한 뒤, 브라우저 주소창을 LAN IP(예: 192.168.x.x:3000)로 바꿔서 다시 접속해 주세요.
                </p>
              ) : null}
              {staleHostUrl ? (
                <p className={styles.qrWarning} role="status">
                  ⚠️ QR 주소({shareHost})가 이 컴퓨터의 현재 주소와 달라요. 지금 주소는 {lanAddresses?.join(", ")} 입니다. 브라우저를 그 주소로 다시 열어 주세요.
                </p>
              ) : null}
              <div className={styles.qrActions}>
                <button type="button" onClick={() => void copyShareUrl()}>링크 복사</button>
                <button ref={qrCloseRef} type="button" onClick={() => setKeepsake(null)}>닫기</button>
              </div>
              <small>링크는 {new Date(keepsake.expires_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지 열 수 있어요.</small>
            </div>
          </div>
        ) : null}
      </motion.article>
    </motion.section>
  );
}
