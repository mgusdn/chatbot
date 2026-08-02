"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { INTERACTION_PROMPTS } from "@/constants/interactionPrompts";
import { requestGuestbookPlacement } from "@/lib/guestbook/placementEvents";
import {
  requestMemoryRelocationCancel,
  requestMemoryRelocationCommit,
} from "@/lib/memory-room/relocationEvents";
import { useGameStore } from "@/store/useGameStore";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import { useMemoryRelocationStore } from "@/store/useMemoryRelocationStore";

export function MobileControls() {
  const setMove = useGameStore((state) => state.setMobileMove);
  const nearby = useGameStore((state) => state.nearbyInteractable);
  const scene = useGameStore((state) => state.scene);
  const requestInteraction = useGameStore((state) => state.requestInteraction);
  const guestbookStatus = useGuestbookVoucherStore((state) => state.status);
  const guestbookPreview = useGuestbookVoucherStore((state) => state.placement_preview);
  const guestbookPlacementReady = useGuestbookVoucherStore((state) => state.placement_ready);
  const rotateGuestbook = useGuestbookVoucherStore((state) => state.rotate);
  const relocationStatus = useMemoryRelocationStore((state) => state.status);
  const relocationCandidate = useMemoryRelocationStore((state) => state.candidate);
  const relocationValidation = useMemoryRelocationStore((state) => state.validation);
  const activePointer = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const radius = 42;
  const canRelocateMemory = scene === "interior" && relocationStatus !== "idle";
  const hasGuestbookVoucher = !canRelocateMemory && scene === "interior"
    && ["armed", "error", "submitting"].includes(guestbookStatus);
  const canPlaceGuestbook = hasGuestbookVoucher && guestbookPlacementReady;
  const guestbookOnWall = guestbookPreview?.kind === "wall";
  const guestbookPlacementInvalid = guestbookPreview?.valid === false;

  const reset = useCallback(() => {
    activePointer.current = null;
    setKnob({ x: 0, y: 0 });
    setMove([0, 0]);
  }, [setMove]);

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState !== "visible") reset();
    };
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      reset();
    };
  }, [reset]);

  const update = (clientX: number, clientY: number) => {
    const dx = clientX - center.current.x;
    const dy = clientY - center.current.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const limited = Math.min(radius, length);
    const x = (dx / length) * limited;
    const y = (dy / length) * limited;
    setKnob({ x, y });
    setMove([x / radius, y / radius]);
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    center.current = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    update(event.clientX, event.clientY);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current === event.pointerId) update(event.clientX, event.clientY);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return;
    reset();
  };

  return (
    <div className="mobile-controls" aria-label="모바일 게임 조작">
      <div
        className="virtual-joystick"
        role="application"
        aria-label="이동 조이스틱"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={reset}
      >
        <span style={{ transform: `translate3d(${knob.x}px, ${knob.y}px, 0)` }}></span>
      </div>
      <button
        type="button"
        data-testid="mobile-interaction-button"
        className={`mobile-interact ${nearby && !canRelocateMemory && !hasGuestbookVoucher ? "is-visible" : ""}`}
        disabled={!nearby || canRelocateMemory || hasGuestbookVoucher}
        onClick={() => {
          if (navigator.vibrate) navigator.vibrate(18);
          requestInteraction();
        }}
      >
        {nearby ? INTERACTION_PROMPTS[nearby] : "상호작용"}
      </button>
      <div className={`mobile-guestbook-controls ${canPlaceGuestbook ? "is-visible" : ""}`}>
        <button
          type="button"
          aria-label="방명록 왼쪽으로 회전"
          disabled={!canPlaceGuestbook || guestbookStatus === "submitting" || guestbookOnWall}
          onClick={() => rotateGuestbook(-15)}
        >
          ↶
        </button>
        <button
          type="button"
          data-testid="mobile-guestbook-place"
          className="mobile-guestbook-place"
          disabled={
            !canPlaceGuestbook
            || guestbookStatus === "submitting"
            || guestbookPlacementInvalid
          }
          onClick={() => {
            if (navigator.vibrate) navigator.vibrate(18);
            requestGuestbookPlacement();
          }}
        >
          {guestbookStatus === "submitting"
            ? guestbookOnWall ? "붙이는 중" : "놓는 중"
            : guestbookOnWall ? "벽에 붙이기" : "방명록 놓기"}
        </button>
        <button
          type="button"
          aria-label="방명록 오른쪽으로 회전"
          disabled={!canPlaceGuestbook || guestbookStatus === "submitting" || guestbookOnWall}
          onClick={() => rotateGuestbook(15)}
        >
          ↷
        </button>
      </div>
      <div className={`mobile-memory-relocation-controls ${canRelocateMemory ? "is-visible" : ""}`}>
        <button
          type="button"
          data-testid="mobile-memory-relocation-cancel"
          disabled={!canRelocateMemory || relocationStatus === "submitting"}
          onClick={() => {
            if (navigator.vibrate) navigator.vibrate(12);
            requestMemoryRelocationCancel();
          }}
        >
          원래 자리
        </button>
        <button
          type="button"
          data-testid="mobile-memory-relocation-commit"
          className="mobile-memory-relocation-commit"
          disabled={
            !canRelocateMemory
            || relocationStatus === "submitting"
            || !relocationValidation?.valid
          }
          onClick={() => {
            if (navigator.vibrate) navigator.vibrate(18);
            requestMemoryRelocationCommit();
          }}
        >
          {relocationStatus === "submitting"
            ? "옮기는 중"
            : relocationCandidate?.kind === "wall"
              ? "벽에 붙이기"
              : "여기에 놓기"}
        </button>
      </div>
    </div>
  );
}
