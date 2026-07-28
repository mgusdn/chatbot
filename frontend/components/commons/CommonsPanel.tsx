"use client";

import { useEffect } from "react";
import { useCommonsStore } from "@/store/useCommonsStore";
import type { CommonsComposerSubmission } from "@/types/commons";
import type { CommonsStation } from "@/types/game";
import { CommonsComposer } from "./CommonsComposer";
import { CommonsTraceList } from "./CommonsTraceList";
import styles from "./CommonsPanel.module.css";

type CommonsPanelProps = {
  autoStart?: boolean;
  pollIntervalMs?: number;
  className?: string;
  station?: CommonsStation;
  onClose?: () => void;
};

export function CommonsPanel({ autoStart = true, pollIntervalMs, className, station = "guestbook", onClose }: CommonsPanelProps) {
  const state = useCommonsStore();

  useEffect(() => {
    if (autoStart) state.startPolling(pollIntervalMs);
    else state.hydrateOwnership();
    return () => { if (autoStart) state.stopPolling(); };
    // Store actions are stable; status changes must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, pollIntervalMs]);

  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const submit = (submission: CommonsComposerSubmission) => submission.kind === "guestbook"
    ? state.createGuestbook(submission.message)
    : state.createInstallation(submission.message, submission.object_kind);

  const status = (() => {
    if (state.status === "loading" || state.status === "idle") {
      return <div className={styles.statusCard} role="status"><div><strong>오늘의 흔적을 모으는 중이에요.</strong><span>잠시만 기다려주세요.</span></div></div>;
    }
    if (state.status === "error") {
      return <div className={styles.statusCard} role="alert"><div><strong>흔적을 불러오지 못했어요.</strong><span>{state.error}</span><br /><button type="button" className={styles.secondaryButton} onClick={() => void state.loadToday()}>다시 시도</button></div></div>;
    }
    if (state.status === "empty") {
      return <div className={styles.statusCard}><div><strong>오늘의 첫 흔적을 남겨보세요.</strong><span>방명록을 쓰거나 작은 오브젝트를 놓을 수 있어요.</span></div></div>;
    }
    return (
      <CommonsTraceList
        traces={state.traces}
        pendingActions={state.pendingActions}
        reactedTraceIds={state.reactedTraceIds}
        reportedTraceIds={state.reportedTraceIds}
        ownsTrace={state.ownsTrace}
        onReact={state.react}
        onDelete={state.deleteTrace}
        onReport={state.reportTrace}
      />
    );
  })();

  return (
    <section
      className={`${styles.panel}${className ? ` ${className}` : ""}`}
      aria-label={station === "guestbook" ? "오늘의 방명록" : "오늘의 설치 갤러리"}
      data-testid="commons-panel"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>TODAY'S COMMONS</p>
          <h2 className={styles.title}>{station === "guestbook" ? "오늘의 방명록" : "오늘의 설치 갤러리"}</h2>
          <p className={styles.subtitle}>
            {station === "guestbook"
              ? "오늘 머문 사람들이 따로 적어 둔 짧은 마음이에요."
              : "오늘 머문 사람들이 골라 놓고 간 작은 오브젝트예요."}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.refreshButton} disabled={state.isRefreshing} onClick={() => void state.loadToday({ background: true })}>
            {state.isRefreshing ? "새로고침 중…" : "새로고침"}
          </button>
          {onClose ? <button type="button" className={styles.closeButton} aria-label="오늘의 흔적 닫기" onClick={onClose}>×</button> : null}
        </div>
      </header>
      <div className={styles.counts} aria-label="오늘의 흔적 수">
        {([["전체", state.counts.total], ["방명록", state.counts.guestbook], ["오브젝트", state.counts.installation]] as const).map(([label, value]) => (
          <span className={styles.countItem} key={label}><strong className={styles.countValue}>{value}</strong><span className={styles.countLabel}>{label}</span></span>
        ))}
      </div>
      <div className={styles.body}>
        {state.error && state.traces.length > 0 ? <p className={styles.notice} role="alert">{state.error}</p> : null}
        {state.actionError ? <p className={styles.notice} role="alert">{state.actionError}</p> : null}
        {status}
      </div>
      {state.submitError ? <p className={styles.notice} role="alert">{state.submitError}</p> : null}
      <CommonsComposer onSubmit={submit} initialKind={station} submitting={state.isSubmitting} />
    </section>
  );
}
