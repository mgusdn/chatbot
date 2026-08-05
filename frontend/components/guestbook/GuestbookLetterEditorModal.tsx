"use client";

import { useEffect, useRef, useState } from "react";
import { createDefaultGuestbookDesign, isGuestbookDesignArmable } from "@/lib/guestbook";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import type { GuestbookDesign } from "@/types/memoryRoom";
import { GuestbookLetterEditor } from "./GuestbookLetterEditor";
import styles from "./GuestbookLetterEditor.module.css";

export type GuestbookLetterEditorModalProps = {
  open: boolean;
  onClose: () => void;
  onArmed?: (design: GuestbookDesign) => void;
};

export function GuestbookLetterEditorModal({
  open,
  onClose,
  onArmed,
}: GuestbookLetterEditorModalProps) {
  const storedDesign = useGuestbookVoucherStore((state) => state.design);
  const status = useGuestbookVoucherStore((state) => state.status);
  const error = useGuestbookVoucherStore((state) => state.error);
  const beginEditing = useGuestbookVoucherStore((state) => state.beginEditing);
  const updateDesign = useGuestbookVoucherStore((state) => state.updateDesign);
  const arm = useGuestbookVoucherStore((state) => state.arm);
  const [draft, setDraft] = useState<GuestbookDesign>(() => storedDesign || createDefaultGuestbookDesign());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    beginEditing();
    const next = useGuestbookVoucherStore.getState().design || createDefaultGuestbookDesign();
    setDraft(next);
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [beginEditing, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => updateDesign(draft), 140);
    return () => window.clearTimeout(timer);
  }, [draft, open, updateDesign]);

  useEffect(() => {
    if (!open) return;
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        updateDesign(draft);
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const modal = modalRef.current;
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !modal.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", containKeyboardFocus);
    return () => window.removeEventListener("keydown", containKeyboardFocus);
  }, [draft, onClose, open, updateDesign]);

  if (!open) return null;

  const close = () => {
    updateDesign(draft);
    onClose();
  };

  const finish = () => {
    if (!arm(draft)) return;
    const armedDesign = useGuestbookVoucherStore.getState().design;
    if (armedDesign) onArmed?.(armedDesign);
    onClose();
  };

  return (
    <div
      className={styles.modalBackdrop}
      data-testid="guestbook-letter-editor-modal"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guestbook-editor-title"
      >
        <header className={styles.modalHeader}>
          <div>
            <p>GUESTBOOK LETTER TICKET</p>
            <h2 id="guestbook-editor-title" ref={headingRef} tabIndex={-1}>방명록 꾸미기</h2>
            <span>글씨와 스티커를 자유롭게 놓아 나만의 편지를 만들어보세요.</span>
          </div>
          <button type="button" aria-label="방명록 편집기 닫기" onClick={close}>×</button>
        </header>

        {error ? <p className={styles.modalError} role="alert">{error}</p> : null}
        <GuestbookLetterEditor design={draft} onChange={setDraft} />

        <footer className={styles.modalFooter}>
          <p>완료한 뒤 방 안을 걷다가 원하는 위치에서 Q를 누르면 놓을 수 있어요.</p>
          <div>
            <button type="button" className={styles.cancelButton} onClick={close}>초안으로 닫기</button>
            <button
              type="button"
              className={styles.armButton}
              onClick={finish}
              disabled={status === "submitting" || !isGuestbookDesignArmable(draft)}
            >
              꾸미기 완료
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
