"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMemoryPlacement, type MemoryPlacementController } from "@/hooks/useMemoryPlacement";
import { useMemoryRoom, type MemoryRoomController } from "@/hooks/useMemoryRoom";
import { getGuestbookTemplate } from "@/lib/guestbook";
import {
  COMPOSER_MEMORY_SURFACE_IDS,
  MEMORY_BODY_LIMITS,
  MEMORY_CARD_STYLES,
  MEMORY_EMOTIONS,
  MEMORY_KINDS,
  MEMORY_REPORT_CATEGORIES,
  countMemoryBody,
  type MemoryCardStyle,
  type MemoryEmotion,
  type MemoryKind,
  type MemoryPlacementInput,
  type MemoryReportCategory,
  type MemorySurfaceId,
  type RoomMemory,
} from "@/types/memoryRoom";
import styles from "./MemoryRoomPanel.module.css";

const KIND_LABELS: Record<MemoryKind, string> = { note: "한 줄 추억", mood: "오늘의 기분", story: "짧은 이야기" };
const EMOTION_LABELS: Record<MemoryEmotion, string> = {
  calm: "고요", joy: "기쁨", tender: "다정", sad: "슬픔", hope: "희망", tired: "지침",
};
const STYLE_LABELS: Record<MemoryCardStyle, string> = {
  cream: "햇살", sage: "새잎", sky: "물빛", rose: "노을", lilac: "새벽",
};
const SURFACE_LABELS = {
  "wall.north": "추억 게시판",
  "wall.west": "서쪽 벽",
  "desk.main": "기록 테이블",
} as const;
const REPORT_LABELS: Record<MemoryReportCategory, string> = {
  personal_information: "개인정보", crisis: "위기 내용", harassment: "괴롭힘", spam: "도배",
  copyright: "권리 침해", other: "기타",
};

const AUTO_PLACEMENT_SLOTS = [
  [0.18, 0.78], [0.5, 0.8], [0.82, 0.76],
  [0.2, 0.5], [0.52, 0.52], [0.8, 0.48],
  [0.17, 0.22], [0.48, 0.2], [0.83, 0.24],
] as const;

/** Picks a tidy free-looking slot while keeping coordinates surface-local. */
export function suggestMemoryPlacement(
  memories: readonly RoomMemory[],
  surfaceId: MemorySurfaceId,
): MemoryPlacementInput {
  const onSurface = memories.filter((memory) => memory.placement.surface_id === surfaceId);
  const index = onSurface.length;
  const [baseU, baseV] = AUTO_PLACEMENT_SLOTS[index % AUTO_PLACEMENT_SLOTS.length];
  const cycle = Math.floor(index / AUTO_PLACEMENT_SLOTS.length);
  const nudge = Math.min(0.045, cycle * 0.012);
  const rotations = [-4, 2, -2, 4, 0, -3, 3, -1, 1] as const;
  return {
    surface_id: surfaceId,
    u: Math.max(0.08, Math.min(0.92, baseU + (cycle % 2 ? nudge : -nudge))),
    v: Math.max(0.08, Math.min(0.92, baseV + (cycle % 3 === 2 ? -nudge : nudge))),
    rotation_deg: rotations[index % rotations.length],
    scale: 1,
    z_index: Math.max(0, ...onSurface.map((memory) => memory.placement.z_index)) + 1,
  };
}

type MemoryRoomPanelProps = {
  roomSlug?: string;
  controller?: MemoryRoomController;
  placement?: MemoryPlacementController;
  autoStart?: boolean;
  modal?: boolean;
  className?: string;
  onClose?: () => void;
  selectedMemoryId?: string | null;
  onSelectMemory?: (memoryId: string) => void;
  viewerOnly?: boolean;
  onBeginRelocation?: (memory: RoomMemory) => void;
  /** @deprecated Use onSelectMemory. */
  onFocusMemory?: (memoryId: string) => void;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "남겨진 추억";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function MemoryRoomPanel({
  roomSlug = "prometheus",
  controller: externalController,
  placement: externalPlacement,
  autoStart = true,
  modal = true,
  className,
  onClose,
  selectedMemoryId,
  onSelectMemory,
  viewerOnly = false,
  onBeginRelocation,
  onFocusMemory,
}: MemoryRoomPanelProps) {
  const internalController = useMemoryRoom(roomSlug);
  const internalPlacement = useMemoryPlacement();
  const controller = externalController || internalController;
  const placement = externalPlacement || internalPlacement;
  const [tab, setTab] = useState<"compose" | "album">(viewerOnly ? "album" : "compose");
  const [kind, setKind] = useState<MemoryKind>("note");
  const [body, setBody] = useState("");
  const [emotion, setEmotion] = useState<MemoryEmotion | "">("");
  const [cardStyle, setCardStyle] = useState<MemoryCardStyle>("cream");
  const [alias, setAlias] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<MemoryReportCategory>("spam");
  const [placementAdjusted, setPlacementAdjusted] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const bodyLength = countMemoryBody(body);
  const maxLength = MEMORY_BODY_LIMITS[kind];
  const selectMemory = onSelectMemory || onFocusMemory;

  useEffect(() => {
    if (autoStart) void controller.load();
    // The controller can be shared with Canvas and intentionally has mutable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, roomSlug]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    return () => previouslyFocusedRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!modal) return;
    headingRef.current?.focus();
  }, [modal]);

  useEffect(() => {
    const handleModalKeys = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (placement.active) placement.cancel();
        else onClose?.();
        return;
      }
      if (!modal || event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;
      const focusOutsidePanel = !panelRef.current.contains(focused);
      if (event.shiftKey && (focused === first || focused === headingRef.current || focusOutsidePanel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || focused === headingRef.current || focusOutsidePanel)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleModalKeys);
    return () => window.removeEventListener("keydown", handleModalKeys);
  }, [modal, onClose, placement.active, placement.cancel]);

  useEffect(() => {
    if (!selectedMemoryId) return;
    setTab("album");
    const frame = window.requestAnimationFrame(() => {
      const selected = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-memory-id]") || [])
        .find((element) => element.dataset.memoryId === selectedMemoryId);
      selected?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [controller.memories.length, selectedMemoryId]);

  useEffect(() => {
    if (viewerOnly) setTab("album");
  }, [viewerOnly]);

  const resetComposer = () => {
    setBody("");
    setAlias("");
    setEmotion("");
    setPlacementAdjusted(false);
    placement.reset();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    controller.clearError();
    try {
      const trimmed = body.trim();
      if (!trimmed || bodyLength > maxLength) return;
      const finalPlacement = placementAdjusted
        ? {
            ...placement.value,
            z_index: Math.max(
              placement.value.z_index,
              ...controller.memories
                .filter((memory) => memory.placement.surface_id === placement.value.surface_id)
                .map((memory) => memory.placement.z_index + 1),
            ),
          }
        : suggestMemoryPlacement(controller.memories, placement.value.surface_id);
      const created = await controller.createMemory({
        kind,
        body: trimmed,
        emotion: emotion || null,
        card_style: cardStyle,
        author_alias: alias.trim() || null,
        placement: finalPlacement,
      });
      const revealedMemoryId = created.id;
      resetComposer();
      if (revealedMemoryId && selectMemory) selectMemory(revealedMemoryId);
      else setTab("album");
    } catch {
      // The shared controller exposes the friendly error in its live region.
    } finally {
      setSubmitting(false);
    }
  };

  const deleteMemory = async (memoryId: string) => {
    try {
      await controller.deleteMemory(memoryId);
      setConfirmDeleteId(null);
    } catch {
      // Controller error is rendered above the active tab.
    }
  };

  const reportMemory = async (memoryId: string) => {
    try {
      await controller.report(memoryId, reportCategory);
      setReportingId(null);
    } catch {
      // Controller error is rendered above the active tab.
    }
  };

  const chooseSurface = (surfaceId: MemorySurfaceId) => {
    placement.update(suggestMemoryPlacement(controller.memories, surfaceId));
    setPlacementAdjusted(true);
  };

  return (
    <section
      ref={panelRef}
      className={`${styles.panel}${className ? ` ${className}` : ""}`}
      role={modal ? "dialog" : undefined}
      aria-modal={modal || undefined}
      aria-labelledby="memory-room-title"
      data-testid="memory-room-panel"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PROMETHEUS MEMORY ROOM</p>
          <h2 id="memory-room-title" className={styles.title} tabIndex={-1} ref={headingRef}>프로메테우스 추억방</h2>
          <p className={styles.subtitle}>그날의 마음과 이야기를 방 안 한 자리에 조용히 붙여두세요.</p>
        </div>
        {onClose ? <button type="button" className={styles.close} aria-label="추억방 닫기" onClick={onClose}>×</button> : null}
      </header>

      <div className={styles.tabs} role="tablist" aria-label="추억방 메뉴">
        {!viewerOnly ? <button type="button" role="tab" aria-selected={tab === "compose"} className={tab === "compose" ? styles.tabActive : styles.tab} onClick={() => setTab("compose")}>추억 남기기</button> : null}
        <button type="button" role="tab" aria-selected={tab === "album"} className={tab === "album" ? styles.tabActive : styles.tab} onClick={() => setTab("album")}>추억 앨범 <span>{controller.memories.length}</span></button>
      </div>

      {controller.error ? <p className={styles.notice} role="alert">{controller.error}<button type="button" onClick={controller.clearError}>닫기</button></p> : null}

      <div className={styles.body}>
        {tab === "compose" ? (
          <form className={styles.composer} onSubmit={(event) => void submit(event)}>
            <>
                <fieldset className={styles.fieldset}>
                  <legend>어떤 기억인가요?</legend>
                  <div className={styles.choiceGrid}>
                    {MEMORY_KINDS.map((value) => (
                      <button key={value} type="button" className={kind === value ? styles.choiceActive : styles.choice} aria-pressed={kind === value} onClick={() => setKind(value)}>{KIND_LABELS[value]}</button>
                    ))}
                  </div>
                </fieldset>
                <label className={styles.label} htmlFor="memory-body">남기고 싶은 말</label>
                <textarea
                  id="memory-body"
                  className={styles.textarea}
                  value={body}
                  maxLength={maxLength}
                  rows={kind === "story" ? 6 : 3}
                  placeholder={kind === "mood" ? "지금의 마음을 짧게 적어주세요." : "프로메테우스에서 기억하고 싶은 순간은 무엇인가요?"}
                  aria-describedby="memory-body-help memory-body-count"
                  onChange={(event) => setBody(event.target.value)}
                  required
                />
                <div className={styles.helpRow}><span id="memory-body-help">상담 내용은 자동으로 가져오지 않아요.</span><span id="memory-body-count">{bodyLength}/{maxLength}</span></div>
                <div className={styles.twoColumns}>
                  <label className={styles.label}>마음의 색
                    <select value={emotion} onChange={(event) => setEmotion(event.target.value as MemoryEmotion | "")}>
                      <option value="">선택 안 함</option>
                      {MEMORY_EMOTIONS.map((value) => <option key={value} value={value}>{EMOTION_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className={styles.label}>익명 별명
                    <input value={alias} maxLength={24} placeholder="비우면 자동 생성" onChange={(event) => setAlias(event.target.value)} />
                  </label>
                </div>
                <fieldset className={styles.fieldset}>
                  <legend>카드 색</legend>
                  <div className={styles.styleChoices}>
                    {MEMORY_CARD_STYLES.map((value) => (
                      <button key={value} type="button" data-style={value} className={cardStyle === value ? styles.styleActive : styles.style} aria-pressed={cardStyle === value} onClick={() => setCardStyle(value)}><span />{STYLE_LABELS[value]}</button>
                    ))}
                  </div>
                </fieldset>
            </>

            <fieldset className={styles.placement}>
              <legend>어디에 둘까요?</legend>
              <div className={styles.surfaceChoices}>
                {COMPOSER_MEMORY_SURFACE_IDS.map((surfaceId) => (
                  <button key={surfaceId} type="button" className={placement.value.surface_id === surfaceId ? styles.surfaceActive : styles.surface} aria-pressed={placement.value.surface_id === surfaceId} onClick={() => chooseSurface(surfaceId)}>{SURFACE_LABELS[surfaceId]}</button>
                ))}
              </div>
              <button type="button" className={placement.active ? styles.previewActive : styles.previewButton} onClick={() => {
                setPlacementAdjusted(true);
                if (placement.active) placement.finish();
                else placement.begin(suggestMemoryPlacement(controller.memories, placement.value.surface_id));
              }}>
                {placement.active ? "공간에서 위치 선택 중 · 완료" : "공간을 눌러 위치 고르기"}
              </button>
              <div className={styles.sliders}>
                <label>좌우 <input type="range" min="0" max="1" step="0.01" value={placement.value.u} onChange={(event) => { setPlacementAdjusted(true); placement.update({ u: Number(event.target.value) }); }} /></label>
                <label>위아래 <input type="range" min="0" max="1" step="0.01" value={placement.value.v} onChange={(event) => { setPlacementAdjusted(true); placement.update({ v: Number(event.target.value) }); }} /></label>
                <label>기울기 <input type="range" min="-20" max="20" step="1" value={placement.value.rotation_deg} onChange={(event) => { setPlacementAdjusted(true); placement.update({ rotation_deg: Number(event.target.value) }); }} /></label>
                <label>크기 <input type="range" min="0.75" max="1.35" step="0.05" value={placement.value.scale} onChange={(event) => { setPlacementAdjusted(true); placement.update({ scale: Number(event.target.value) }); }} /></label>
              </div>
            </fieldset>
            <button type="submit" className={styles.submit} disabled={submitting || !body.trim() || bodyLength > maxLength}>
              {submitting ? "추억을 놓는 중…" : "이 자리에 추억 남기기"}
            </button>
          </form>
        ) : (
          <div className={styles.album} aria-live="polite">
            <div className={styles.albumHeader}>
              <div><strong>{controller.room?.title || "프로메테우스 추억방"}</strong><span>서로의 마음을 판단하지 않고 천천히 읽어주세요.</span></div>
              <button type="button" onClick={() => void controller.load()} disabled={controller.status === "loading"}>새로고침</button>
            </div>
            {controller.status === "loading" || controller.status === "idle" ? <div className={styles.empty} role="status">추억을 펼치는 중이에요.</div> : null}
            {controller.status === "error" ? <div className={styles.empty}><strong>앨범을 열지 못했어요.</strong><button type="button" onClick={() => void controller.load()}>다시 시도</button></div> : null}
            {controller.status === "empty" ? <div className={styles.empty}><strong>아직 놓인 추억이 없어요.</strong><span>편집대에서 방명록을 만들어보세요.</span>{!viewerOnly ? <button type="button" onClick={() => setTab("compose")}>추억 남기기</button> : null}</div> : null}
            <ol className={styles.memoryList} aria-label="프로메테우스 추억 목록">
              {controller.memories.map((memory) => {
                const pending = controller.pendingIds.includes(memory.id);
                const owned = controller.ownsMemory(memory.id);
                return (
                  <li key={memory.id}>
                    <article className={styles.memoryCard} data-memory-id={memory.id} tabIndex={-1} data-card-style={memory.card_style} data-selected={selectedMemoryId === memory.id || undefined}>
                      <header className={styles.memoryMeta}>
                        <span>{KIND_LABELS[memory.kind]}{memory.emotion ? ` · ${EMOTION_LABELS[memory.emotion]}` : ""}</span>
                        <time dateTime={memory.created_at}>{formatDate(memory.created_at)}</time>
                      </header>
                      <p>{memory.body}</p>
                      {memory.design ? (
                        <p className={styles.designMeta}>
                          편지지: {getGuestbookTemplate(memory.design.template_id).label}
                          {memory.design.version === 2 && memory.design.signature
                            ? ` · 서명: ${memory.design.signature}`
                            : ""}
                        </p>
                      ) : null}
                      <footer>
                        <strong>{memory.author_alias}</strong>
                        <div className={styles.actions}>
                          {selectMemory ? <button type="button" onClick={() => selectMemory(memory.id)}>공간에서 보기</button> : null}
                          <button type="button" disabled={pending || controller.reactedIds.includes(memory.id)} aria-pressed={controller.reactedIds.includes(memory.id)} onClick={() => { void controller.react(memory.id).catch(() => undefined); }}>♡ 공감 {memory.reaction_count}</button>
                          {owned && onBeginRelocation
                            ? <button type="button" disabled={pending} onClick={() => onBeginRelocation(memory)}>위치 옮기기</button>
                            : null}
                          <button type="button" disabled={pending} onClick={() => setConfirmDeleteId(memory.id)}>지우기</button>
                          {!owned && !controller.reportedIds.includes(memory.id) ? <button type="button" disabled={pending} onClick={() => setReportingId(memory.id)}>신고</button> : null}
                        </div>
                        {confirmDeleteId === memory.id ? <div className={styles.confirm} role="alert"><span>이 추억을 지울까요?</span><button type="button" onClick={() => void deleteMemory(memory.id)}>지우기</button><button type="button" onClick={() => setConfirmDeleteId(null)}>취소</button></div> : null}
                        {reportingId === memory.id ? <div className={styles.confirm}><label>신고 이유 <select value={reportCategory} onChange={(event) => setReportCategory(event.target.value as MemoryReportCategory)}>{MEMORY_REPORT_CATEGORIES.map((value) => <option key={value} value={value}>{REPORT_LABELS[value]}</option>)}</select></label><button type="button" onClick={() => void reportMemory(memory.id)}>접수</button><button type="button" onClick={() => setReportingId(null)}>취소</button></div> : null}
                      </footer>
                    </article>
                  </li>
                );
              })}
            </ol>
            {controller.nextCursor ? <button type="button" className={styles.more} disabled={controller.loadingMore} onClick={() => void controller.load({ append: true })}>{controller.loadingMore ? "더 펼치는 중…" : "이전 추억 더 보기"}</button> : null}
          </div>
        )}
      </div>
      <p className={styles.safety}>공개 추억방에는 연락처나 다른 사람의 개인정보를 남기지 말아주세요. 이 브라우저의 저장 데이터를 지우면 내 추억을 옮기거나 삭제할 열쇠도 사라져요. 위험한 순간에는 112·119 등 즉시 도움받을 수 있는 곳에 연락해주세요.</p>
    </section>
  );
}
