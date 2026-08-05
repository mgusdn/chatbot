"use client";

import { requestBackgroundAudioPlayback } from "@/components/audio/AudioDirector";
import { CHARACTER_BY_ID } from "@/constants/characterCatalog";
import { INTERACTION_PROMPTS } from "@/constants/interactionPrompts";
import { getMemorySurface } from "@/constants/memorySurfaces";
import { requestMemoryRelocationCancel } from "@/lib/memory-room/relocationEvents";
import { useGameStore } from "@/store/useGameStore";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import { useMemoryRelocationStore } from "@/store/useMemoryRelocationStore";
import { MobileControls } from "./MobileControls";

function companionLabel(name: string) {
  const lastCode = name.charCodeAt(name.length - 1);
  const hasFinalConsonant = lastCode >= 0xac00 && lastCode <= 0xd7a3 && (lastCode - 0xac00) % 28 !== 0;
  return `${name}${hasFinalConsonant ? "과" : "와"}`;
}

export function WorldHud() {
  const characterId = useGameStore((state) => state.confirmedCharacterId);
  const scene = useGameStore((state) => state.scene);
  const nearby = useGameStore((state) => state.nearbyInteractable);
  const muted = useGameStore((state) => state.muted);
  const toggleMuted = useGameStore((state) => state.toggleMuted);
  const changeCharacter = useGameStore((state) => state.changeCharacter);
  const requestInteraction = useGameStore((state) => state.requestInteraction);
  const lastCounselReport = useGameStore((state) => state.lastCounselReport);
  const reopenLastReport = useGameStore((state) => state.reopenLastReport);
  const guestbookStatus = useGuestbookVoucherStore((state) => state.status);
  const guestbookError = useGuestbookVoucherStore((state) => state.error);
  const guestbookPreview = useGuestbookVoucherStore((state) => state.placement_preview);
  const guestbookPlacementReady = useGuestbookVoucherStore((state) => state.placement_ready);
  const discardGuestbook = useGuestbookVoucherStore((state) => state.discard);
  const relocationStatus = useMemoryRelocationStore((state) => state.status);
  const relocationCandidate = useMemoryRelocationStore((state) => state.candidate);
  const relocationValidation = useMemoryRelocationStore((state) => state.validation);
  const relocationError = useMemoryRelocationStore((state) => state.error);
  if (!characterId) return null;
  const characterName = CHARACTER_BY_ID[characterId].name;
  const hasMemoryRelocation = scene === "interior" && relocationStatus !== "idle";
  const hasGuestbookVoucher = !hasMemoryRelocation && scene === "interior"
    && ["armed", "submitting", "error"].includes(guestbookStatus);
  const guestbookSurface = guestbookPlacementReady && guestbookPreview
    ? getMemorySurface(guestbookPreview.surface_id)
    : null;
  const guestbookOnWall = guestbookPreview?.kind === "wall";
  const guestbookValidationMessage = guestbookPreview?.valid === false
    ? guestbookPreview.invalid_reason === "entrance-clearance"
      ? "입구 통로는 비워주세요."
      : guestbookPreview.invalid_reason === "furniture-collision"
        ? "가구와 겹쳐요. 열린 곳으로 이동해주세요."
        : guestbookPreview.invalid_reason === "wall-fixture-collision"
          ? "벽의 가구나 게시물과 겹쳐요."
          : "가장자리 밖으로 나가요. 조금 이동해주세요."
    : null;
  const relocationSurface = relocationCandidate
    ? getMemorySurface(relocationCandidate.surfaceId)
    : null;
  const relocationAction = relocationCandidate?.kind === "wall" ? "붙이기" : "내려놓기";
  const relocationValidationMessage = !relocationValidation?.valid
    ? relocationValidation?.reason === "entrance-clearance"
      ? "입구 통로는 비워주세요."
      : relocationValidation?.reason === "furniture-collision"
        ? "가구와 겹쳐요. 열린 곳으로 이동해주세요."
        : relocationValidation?.reason === "wall-fixture-collision"
          ? "벽의 가구나 게시물과 겹쳐요."
          : "가장자리 밖으로 나가요. 조금 이동해주세요."
    : null;

  return (
    <div className="world-hud">
      <header className="world-topbar">
        <div className="world-location">
          <span>{scene === "exterior" ? "프바오 마을" : "오늘의 마음연구소"}</span>
          <strong>{companionLabel(characterName)} 산책 중</strong>
        </div>
        <div className="world-actions">
          <button
            type="button"
            onClick={() => {
              toggleMuted();
              requestBackgroundAudioPlayback();
            }}
            aria-pressed={!muted}
          >
            {muted ? "음향 켜기" : "음향 끄기"}
          </button>
          <button type="button" disabled={relocationStatus === "submitting"} onClick={changeCharacter}>캐릭터 바꾸기</button>
          {lastCounselReport && (
            <button type="button" onClick={reopenLastReport}>마음 정리 다시 보기</button>
          )}
        </div>
      </header>
      <div className="desktop-help"><kbd>WASD</kbd><span>이동</span><kbd>Shift</kbd><span>달리기</span></div>
      {hasGuestbookVoucher ? (
        <aside
          className={`guestbook-voucher-hud${guestbookStatus === "error" || guestbookPreview?.valid === false ? " is-error" : ""}`}
          data-testid="guestbook-voucher-hud"
          aria-live="polite"
        >
          <div>
            <span>방명록 교환권</span>
            <strong>
              {guestbookStatus === "submitting"
                ? guestbookOnWall ? "벽에 붙이는 중…" : "바닥에 놓는 중…"
                : !guestbookPlacementReady
                  ? "방명록을 들었어요"
                : guestbookSurface
                  ? `현재: ${guestbookSurface.label}`
                  : "캐릭터 앞에 놓을 준비가 됐어요"}
            </strong>
            <small>
              {!guestbookPlacementReady
                ? "책상 주변을 벗어나 열린 곳으로 이동해주세요."
                : guestbookValidationMessage
                || guestbookError
                || (guestbookOnWall
                  ? "Q 벽에 붙이기 · 벽에서 멀어지면 다시 회전할 수 있어요"
                  : "Q 놓기 · R 회전 · 벽을 바라보면 자동으로 붙어요")}
            </small>
          </div>
          <button
            type="button"
            disabled={guestbookStatus === "submitting"}
            onClick={() => {
              if (window.confirm("만든 방명록 교환권을 버릴까요?")) discardGuestbook();
            }}
          >
            버리기
          </button>
        </aside>
      ) : null}
      {hasMemoryRelocation ? (
        <aside
          className={`memory-relocation-hud${relocationStatus === "error" || relocationValidation?.valid === false ? " is-error" : ""}`}
          data-testid="memory-relocation-hud"
          aria-live="polite"
        >
          <div>
            <span>추억을 옮기는 중</span>
            <strong>
              {relocationStatus === "submitting"
                ? `새 위치에 ${relocationAction}는 중…`
                : relocationSurface
                  ? `현재: ${relocationSurface.label}`
                  : "캐릭터 앞에 들고 있어요"}
            </strong>
            <small>
              {relocationError
                || relocationValidationMessage
                || `Q ${relocationAction} · R 원래 자리 · 벽을 바라보면 자동으로 붙어요`}
            </small>
          </div>
          <button
            type="button"
            disabled={relocationStatus === "submitting"}
            onClick={requestMemoryRelocationCancel}
          >
            원래 자리
          </button>
        </aside>
      ) : null}
      {nearby && !hasMemoryRelocation && !hasGuestbookVoucher && (
        <button className="interaction-prompt" type="button" onClick={requestInteraction} data-testid="interaction-prompt">
          <kbd>E</kbd><span>{INTERACTION_PROMPTS[nearby]}</span>
        </button>
      )}
      <MobileControls />
    </div>
  );
}
