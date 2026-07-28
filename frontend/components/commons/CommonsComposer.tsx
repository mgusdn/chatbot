"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  COMMONS_MESSAGE_MAX_LENGTH,
  COMMONS_OBJECT_KINDS,
  countCommonsMessage,
  limitCommonsMessage,
  trimCommonsMessage,
  type CommonsComposerSubmission,
  type CommonsObjectKind,
  type CommonsTraceKind,
} from "@/types/commons";
import styles from "./CommonsPanel.module.css";

const OBJECT_LABELS: Record<CommonsObjectKind, { icon: string; label: string }> = {
  flower: { icon: "✿", label: "꽃" },
  lantern: { icon: "◈", label: "연구등" },
  book: { icon: "▤", label: "책" },
  stone: { icon: "●", label: "작은 조형물" },
};

type Props = {
  onSubmit: (submission: CommonsComposerSubmission) => Promise<unknown> | unknown;
  initialKind?: CommonsTraceKind;
  submitting?: boolean;
  disabled?: boolean;
};

export function CommonsComposer({ onSubmit, initialKind = "guestbook", submitting = false, disabled = false }: Props) {
  const [kind, setKind] = useState<CommonsTraceKind>(initialKind);
  const [message, setMessage] = useState("");
  const [objectKind, setObjectKind] = useState<CommonsObjectKind | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const messageComposingRef = useRef(false);

  const messageLength = countCommonsMessage(message);
  const valid = message.trim().length > 0 && (kind === "guestbook" || objectKind !== null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleaned = trimCommonsMessage(message);
    if (!cleaned) {
      setLocalError("짧게라도 오늘의 마음을 적어주세요.");
      return;
    }
    if (kind === "installation" && !objectKind) {
      setLocalError("마을에 남길 오브젝트를 골라주세요.");
      return;
    }

    setLocalError(null);
    try {
      await onSubmit(kind === "guestbook"
        ? { kind, message: cleaned }
        : { kind, message: cleaned, object_kind: objectKind as CommonsObjectKind });
      setMessage("");
      setObjectKind(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "흔적을 남기지 못했어요.");
    }
  };

  return (
    <form className={styles.composer} onSubmit={submit} aria-label="오늘의 흔적 남기기">
      <div className={styles.modeTabs} role="tablist" aria-label="흔적 종류">
        {(["guestbook", "installation"] as const).map((mode) => (
          <button
            key={mode}
            className={`${styles.modeButton} ${kind === mode ? styles.modeButtonActive : ""}`}
            type="button"
            role="tab"
            aria-selected={kind === mode}
            onClick={() => { setKind(mode); setLocalError(null); }}
          >
            {mode === "guestbook" ? "방명록" : "마을에 놓기"}
          </button>
        ))}
      </div>

      {kind === "installation" ? (
        <div className={styles.objectPicker} role="radiogroup" aria-label="설치 오브젝트 선택">
          {COMMONS_OBJECT_KINDS.map((object) => (
            <button
              key={object}
              className={`${styles.objectButton} ${objectKind === object ? styles.objectButtonActive : ""}`}
              type="button"
              role="radio"
              aria-checked={objectKind === object}
              onClick={() => setObjectKind(object)}
            >
              <span aria-hidden="true">{OBJECT_LABELS[object].icon}</span>
              {OBJECT_LABELS[object].label}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.textareaWrap}>
        <textarea
          className={styles.textarea}
          value={message}
          disabled={disabled || submitting}
          aria-label="남길 메시지"
          aria-describedby="commons-message-counter"
          placeholder={kind === "guestbook" ? "오늘 이곳에 머문 마음을 남겨주세요." : "이 오브젝트에 담을 마음을 적어주세요."}
          onCompositionStart={() => { messageComposingRef.current = true; }}
          onCompositionEnd={(event) => {
            messageComposingRef.current = false;
            setMessage(limitCommonsMessage(event.currentTarget.value));
          }}
          onChange={(event) => {
            if (
              messageComposingRef.current
              || (event.nativeEvent as InputEvent).isComposing
            ) {
              setMessage(event.currentTarget.value);
              return;
            }
            setMessage(limitCommonsMessage(event.currentTarget.value));
          }}
          onBlur={(event) => {
            messageComposingRef.current = false;
            setMessage(limitCommonsMessage(event.currentTarget.value));
          }}
        />
        <span id="commons-message-counter" className={styles.counter}>{messageLength}/{COMMONS_MESSAGE_MAX_LENGTH}</span>
      </div>

      <div className={styles.composerFooter}>
        <p className={styles.formError} role={localError ? "alert" : undefined}>{localError || "익명 별칭으로 오늘 하루만 함께 보여요."}</p>
        <button className={styles.submitButton} type="submit" disabled={disabled || submitting || !valid}>
          {submitting ? "남기는 중…" : "흔적 남기기"}
        </button>
      </div>
    </form>
  );
}
