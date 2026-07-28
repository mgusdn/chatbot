"use client";

import { useState } from "react";
import type {
  CommonsObjectKind,
  CommonsReportCategory,
  CommonsTrace,
} from "@/types/commons";
import type { CommonsPendingAction } from "@/store/useCommonsStore";
import styles from "./CommonsPanel.module.css";

const OBJECT_LABELS: Record<CommonsObjectKind, string> = {
  flower: "꽃",
  lantern: "등불",
  book: "책",
  stone: "돌",
};

const REPORT_LABELS: Record<CommonsReportCategory, string> = {
  personal_information: "개인정보",
  crisis: "위기 내용",
  harassment: "괴롭힘",
  spam: "스팸",
};

const CREATED_BUCKET_LABELS: Record<string, string> = {
  morning: "아침",
  afternoon: "오후",
  evening: "저녁",
  night: "밤",
};

type Props = {
  traces: CommonsTrace[];
  pendingActions: Record<string, CommonsPendingAction>;
  reactedTraceIds: string[];
  reportedTraceIds: string[];
  ownsTrace: (traceId: string) => boolean;
  onReact: (traceId: string) => Promise<void> | void;
  onDelete: (traceId: string) => Promise<void> | void;
  onReport: (traceId: string, category: CommonsReportCategory) => Promise<void> | void;
};

function TraceCard({
  trace,
  owned,
  reacted,
  reported,
  pending,
  onReact,
  onDelete,
  onReport,
}: {
  trace: CommonsTrace;
  owned: boolean;
  reacted: boolean;
  reported: boolean;
  pending?: CommonsPendingAction;
  onReact: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onReport: (category: CommonsReportCategory) => Promise<void> | void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showReport, setShowReport] = useState(false);

  return (
    <article className={styles.traceCard}>
      <div className={styles.traceMeta}>
        <span><span className={styles.traceAlias}>{trace.alias}</span>{trace.object_kind ? <span className={styles.objectBadge}>{OBJECT_LABELS[trace.object_kind]}</span> : null}</span>
        <span>{CREATED_BUCKET_LABELS[trace.created_bucket] || trace.created_bucket}</span>
      </div>
      <p className={styles.traceMessage}>{trace.message || "말없이 머문 흔적"}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.actionButton} ${reacted ? styles.actionButtonActive : ""}`}
          disabled={reacted || Boolean(pending)}
          aria-label={`공감 ${trace.reaction_count}개`}
          onClick={() => void Promise.resolve(onReact()).catch(() => undefined)}
        >
          {reacted ? "공감했어요" : "♡ 공감"} {trace.reaction_count}
        </button>

        {owned ? (
          <button type="button" className={styles.actionButton} disabled={Boolean(pending)} onClick={() => setConfirmDelete(true)}>지우기</button>
        ) : (
          <button type="button" className={styles.actionButton} disabled={reported || Boolean(pending)} onClick={() => setShowReport((value) => !value)}>
            {reported ? "신고됨" : "신고"}
          </button>
        )}

        {confirmDelete ? (
          <div className={styles.confirmRow} role="group" aria-label="흔적 삭제 확인">
            <span>정말 지울까요?</span>
            <button type="button" className={styles.categoryButton} disabled={Boolean(pending)} onClick={() => void Promise.resolve(onDelete()).catch(() => undefined)}>네, 지우기</button>
            <button type="button" className={styles.actionButton} onClick={() => setConfirmDelete(false)}>취소</button>
          </div>
        ) : null}

        {showReport && !reported ? (
          <div className={styles.reportChoices} role="group" aria-label="신고 사유 선택">
            {(Object.entries(REPORT_LABELS) as [CommonsReportCategory, string][]).map(([category, label]) => (
              <button
                key={category}
                type="button"
                className={styles.categoryButton}
                disabled={Boolean(pending)}
                onClick={() => void Promise.resolve(onReport(category)).then(() => setShowReport(false)).catch(() => undefined)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function CommonsTraceList({ traces, pendingActions, reactedTraceIds, reportedTraceIds, ownsTrace, onReact, onDelete, onReport }: Props) {
  return (
    <ul className={styles.list} aria-label="오늘 남겨진 흔적">
      {traces.map((trace) => (
        <li key={trace.id}>
          <TraceCard
            trace={trace}
            owned={ownsTrace(trace.id)}
            reacted={reactedTraceIds.includes(trace.id)}
            reported={reportedTraceIds.includes(trace.id)}
            pending={pendingActions[trace.id]}
            onReact={() => onReact(trace.id)}
            onDelete={() => onDelete(trace.id)}
            onReport={(category) => onReport(trace.id, category)}
          />
        </li>
      ))}
    </ul>
  );
}
