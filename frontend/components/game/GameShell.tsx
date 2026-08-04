"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AudioDirector } from "@/components/audio/AudioDirector";
import { CounselReportOverlay } from "@/components/counseling/CounselReportOverlay";
import { CounselingScreen } from "@/components/counseling/CounselingScreen";
import { CommonsPanel } from "@/components/commons";
import { GuestbookLetterEditorModal } from "@/components/guestbook";
import { MemoryRoomPanel } from "@/components/memory-room";
import { useMemoryPlacement } from "@/hooks/useMemoryPlacement";
import { friendlyMemoryRoomError, useMemoryRoom } from "@/hooks/useMemoryRoom";
import { useMemoryRoomRealtime } from "@/hooks/useMemoryRoomRealtime";
import { MemoryRoomApiError } from "@/lib/api/memoryRoomClient";
import { readPlayerProfile, writePlayerProfile } from "@/lib/storage/playerProfile";
import { useCommonsStore } from "@/store/useCommonsStore";
import { useGameStore } from "@/store/useGameStore";
import { getGuestbookVoucherSubmission, useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import { useMemoryRelocationStore } from "@/store/useMemoryRelocationStore";
import type { MemoryPlacementInput, RoomMemory } from "@/types/memoryRoom";
import type { MultiplayerStatus } from "@/types/multiplayer";
import { CharacterSelectScreen } from "./CharacterSelectScreen";
import { EntryScreen } from "./EntryScreen";
import { WorldHud } from "./WorldHud";
import { resolveSelectableCharacterId } from "@/constants/characterCatalog";

const GameCanvas = dynamic(() => import("./GameCanvas"), {
  ssr: false,
  loading: () => <div className="canvas-loading"><span></span><p>3D 마을을 준비하고 있어요.</p></div>,
});

export function GameShell() {
  const phase = useGameStore((state) => state.phase);
  const scene = useGameStore((state) => state.scene);
  const selected = useGameStore((state) => state.selectedCharacterId);
  const confirmed = useGameStore((state) => state.confirmedCharacterId);
  const assetsProgress = useGameStore((state) => state.assetsProgress);
  const counselReport = useGameStore((state) => state.counselReport);
  const activeCommonsStation = useGameStore((state) => state.activeCommonsStation);
  const worldError = useGameStore((state) => state.error);
  const start = useGameStore((state) => state.start);
  const hydrateCharacter = useGameStore((state) => state.hydrateCharacter);
  const confirmCharacter = useGameStore((state) => state.confirmCharacter);
  const finishSpawn = useGameStore((state) => state.finishSpawn);
  const enterInterior = useGameStore((state) => state.enterInterior);
  const exitInterior = useGameStore((state) => state.exitInterior);
  const activateCounsel = useGameStore((state) => state.activateCounsel);
  const finishCounselReturn = useGameStore((state) => state.finishCounselReturn);
  const dismissCounselReport = useGameStore((state) => state.dismissCounselReport);
  const openCommonsStation = useGameStore((state) => state.openCommonsStation);
  const closeCommonsStation = useGameStore((state) => state.closeCommonsStation);
  const startCommonsPolling = useCommonsStore((state) => state.startPolling);
  const stopCommonsPolling = useCommonsStore((state) => state.stopPolling);
  const reducedMotion = useReducedMotion();
  const memoryRoom = useMemoryRoom("prometheus");
  const memoryRealtimeStatus = useMemoryRoomRealtime({
    enabled: scene === "interior",
    roomSlug: "prometheus",
    revision: memoryRoom.room?.revision ?? null,
    refresh: memoryRoom.load,
  });
  const memoryPlacement = useMemoryPlacement();
  const [hydrated, setHydrated] = useState(false);
  const [nickname, setNickname] = useState("");
  const [multiplayerState, setMultiplayerState] = useState<{ status: MultiplayerStatus; count: number }>({
    status: "idle",
    count: 0,
  });
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const guestbookStatus = useGuestbookVoucherStore((state) => state.status);
  const relocationStatus = useMemoryRelocationStore((state) => state.status);
  const relocationSurface = useMemoryRelocationStore((state) => state.candidate?.surfaceId || null);
  const hydrateGuestbookVoucher = useGuestbookVoucherStore((state) => state.hydrate);
  const beginGuestbookEditing = useGuestbookVoucherStore((state) => state.beginEditing);

  useEffect(() => {
    const profile = readPlayerProfile(window.localStorage);
    hydrateCharacter(resolveSelectableCharacterId(profile?.characterId || null));
    hydrateGuestbookVoucher(window.localStorage);
    setNickname(profile?.nickname || "");
    setHydrated(true);
  }, [hydrateCharacter, hydrateGuestbookVoucher]);

  useEffect(() => {
    if (scene !== "interior") {
      stopCommonsPolling();
      memoryPlacement.cancel();
      useMemoryRelocationStore.getState().cancel();
      setSelectedMemoryId(null);
      return;
    }
    startCommonsPolling();
    return stopCommonsPolling;
  }, [memoryPlacement.cancel, scene, startCommonsPolling, stopCommonsPolling]);

  useEffect(() => {
    if (phase === "entry" || phase === "character-select" || phase === "world-error") {
      useMemoryRelocationStore.getState().cancel();
    }
  }, [phase]);

  useEffect(() => {
    if (scene === "interior" && memoryRoom.status === "idle") void memoryRoom.load();
  }, [memoryRoom.load, memoryRoom.status, scene]);

  useEffect(() => {
    if (activeCommonsStation !== "guestbook" && memoryPlacement.active) {
      memoryPlacement.cancel();
    }
  }, [activeCommonsStation, memoryPlacement.active, memoryPlacement.cancel]);

  useEffect(() => {
    if (activeCommonsStation !== "guestbook" || selectedMemoryId) return;
    beginGuestbookEditing();
    // Opening the station is the transition. Status changes inside the editor
    // must not reopen or reset the voucher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCommonsStation, selectedMemoryId]);

  useEffect(() => {
    if (phase !== "spawning") return;
    const timer = window.setTimeout(finishSpawn, reducedMotion ? 80 : 650);
    return () => window.clearTimeout(timer);
  }, [phase, finishSpawn, reducedMotion]);

  useEffect(() => {
    if (phase !== "entering-building") return;
    const fromScene = scene;
    const timer = window.setTimeout(() => {
      if (fromScene === "exterior") enterInterior();
      else exitInterior();
    }, reducedMotion ? 100 : 650);
    return () => window.clearTimeout(timer);
  }, [phase, scene, enterInterior, exitInterior, reducedMotion]);

  useEffect(() => {
    if (phase !== "entering-counsel") return;
    const timer = window.setTimeout(activateCounsel, reducedMotion ? 120 : 520);
    return () => window.clearTimeout(timer);
  }, [phase, activateCounsel, reducedMotion]);

  useEffect(() => {
    if (phase !== "leaving-counsel") return;
    const timer = window.setTimeout(finishCounselReturn, reducedMotion ? 120 : 650);
    return () => window.clearTimeout(timer);
  }, [phase, finishCounselReturn, reducedMotion]);

  const handleConfirm = (nextNickname: string) => {
    const characterId = confirmCharacter();
    if (characterId) {
      const profile = writePlayerProfile(window.localStorage, characterId, nextNickname);
      setNickname(profile.nickname);
    }
  };

  const openSelectedMemory = useCallback((memoryId: string) => {
    setSelectedMemoryId(memoryId);
    openCommonsStation("guestbook");
  }, [openCommonsStation]);

  const openGuestbookEditor = useCallback(() => {
    memoryPlacement.cancel();
    setSelectedMemoryId(null);
    openCommonsStation("guestbook");
  }, [memoryPlacement.cancel, openCommonsStation]);

  const closeMemoryRoom = useCallback(() => {
    memoryPlacement.cancel();
    setSelectedMemoryId(null);
    closeCommonsStation();
  }, [closeCommonsStation, memoryPlacement.cancel]);

  const closeGuestbookEditor = useCallback(() => {
    const voucher = useGuestbookVoucherStore.getState();
    const hasText = voucher.design?.layers.some(
      (layer) => layer.type === "text" && layer.text.trim().length > 0,
    );
    if (hasText) {
      if (!voucher.arm()) return;
      useGameStore.getState().setNearbyInteractable(null);
    } else {
      voucher.discard();
    }
    setSelectedMemoryId(null);
    closeCommonsStation();
  }, [closeCommonsStation]);

  const armGuestbookVoucher = useCallback(() => {
    setSelectedMemoryId(null);
    useGameStore.getState().setNearbyInteractable(null);
    closeCommonsStation();
  }, [closeCommonsStation]);

  const updateMultiplayerState = useCallback((status: MultiplayerStatus, count: number) => {
    setMultiplayerState((current) => (
      current.status === status && current.count === count ? current : { status, count }
    ));
  }, []);

  const placeGuestbook = useCallback((placement: MemoryPlacementInput) => {
    const voucher = useGuestbookVoucherStore.getState();
    const submission = getGuestbookVoucherSubmission(voucher);
    if (!submission) {
      voucher.fail("방명록 교환권을 다시 확인해주세요.");
      return;
    }
    void memoryRoom.createMemory({
      kind: "story",
      design: submission.design,
      client_request_id: submission.client_request_id,
      ownership_token: submission.ownership_token,
      emotion: null,
      card_style: "cream",
      author_alias: null,
      placement,
    }).then((memory) => {
      useGuestbookVoucherStore.getState().complete();
      setSelectedMemoryId(memory.id);
    }).catch((caught) => {
      useGuestbookVoucherStore.getState().fail(
        friendlyMemoryRoomError(caught, "방명록을 놓지 못했어요. 교환권은 그대로 보관했어요."),
      );
    });
  }, [memoryRoom]);

  const beginMemoryRelocation = useCallback((memory: RoomMemory) => {
    if (!memoryRoom.ownsMemory(memory.id)) return;
    const requestId = useMemoryRelocationStore.getState().begin(memory);
    if (!requestId) return;
    memoryPlacement.cancel();
    setSelectedMemoryId(null);
    useGameStore.getState().setNearbyInteractable(null);
    closeCommonsStation();
  }, [closeCommonsStation, memoryPlacement, memoryRoom]);

  const commitMemoryRelocation = useCallback(() => {
    const relocation = useMemoryRelocationStore.getState();
    if (
      relocation.status !== "submitting"
      || !relocation.memoryId
      || !relocation.original
      || !relocation.candidate
      || !relocation.requestId
    ) return;
    const requestId = relocation.requestId;
    const memoryId = relocation.memoryId;
    const target = relocation.candidate.placement;
    void memoryRoom.relocateMemory(memoryId, {
      client_request_id: requestId,
      expected_version: relocation.original.version,
      surface_id: target.surface_id,
      u: target.u,
      v: target.v,
      rotation_deg: target.rotation_deg,
      scale: target.scale,
    }).then((memory) => {
      useMemoryRelocationStore.getState().complete(requestId);
      setSelectedMemoryId(memory.id);
    }).catch((caught) => {
      const terminal = caught instanceof MemoryRoomApiError
        && [403, 404, 409].includes(caught.status);
      const fallback = terminal
        ? "다른 곳에서 추억이 바뀌었어요. R로 내려놓고 앨범에서 다시 선택해주세요."
        : "추억을 옮기지 못했어요. 교환권은 그대로 들고 있으니 Q로 다시 시도해주세요.";
      useMemoryRelocationStore.getState().fail(
        friendlyMemoryRoomError(caught, fallback),
        requestId,
      );
      if (terminal) void memoryRoom.load();
    });
  }, [memoryRoom]);

  const focusMemoryInRoom = useCallback((memoryId: string) => {
    memoryPlacement.cancel();
    setSelectedMemoryId(memoryId);
    closeCommonsStation();
  }, [closeCommonsStation, memoryPlacement.cancel]);

  const showWorldHud = useMemo(
    () => ["spawning", "exploring-exterior", "exploring-interior", "interaction-ready"].includes(phase),
    [phase],
  );
  // Entry and resident selection each own a deliberately lightweight Canvas.
  // The full world Canvas starts only once preloading begins.
  const showCanvas = !["entry", "character-select"].includes(phase) && hydrated;
  const shouldPrepareCounsel = !["entry", "character-select"].includes(phase);
  const counselOpen = phase === "counsel-active";
  const transitionActive = ["entering-building", "entering-counsel", "leaving-counsel"].includes(phase);

  return (
    <div
      className="game-shell"
      data-game-phase={phase}
      data-scene={scene}
      data-player-character={confirmed || ""}
      data-player-nickname={nickname}
      data-commons-station={activeCommonsStation || ""}
      data-selected-memory={selectedMemoryId || ""}
      data-guestbook-voucher={guestbookStatus}
      data-memory-relocation={relocationStatus}
      data-memory-relocation-surface={relocationSurface || ""}
      data-memory-realtime={memoryRealtimeStatus}
      data-multiplayer-status={multiplayerState.status}
      data-multiplayer-count={multiplayerState.count}
      data-game-error={worldError || ""}
    >
      <AudioDirector />
      {phase === "entry" ? <EntryScreen onStart={start} /> : null}
      {showCanvas ? (
        <GameCanvas
          nickname={nickname}
          onMultiplayerStateChange={updateMultiplayerState}
          memories={memoryRoom.memories}
          memoryPlacement={memoryPlacement}
          selectedMemoryId={selectedMemoryId}
          onSelectMemory={memoryPlacement.active || relocationStatus !== "idle" ? undefined : openSelectedMemory}
          onPlaceGuestbook={placeGuestbook}
          onOpenGuestbookEditor={openGuestbookEditor}
          onCommitMemoryRelocation={commitMemoryRelocation}
        />
      ) : null}

      <AnimatePresence>
        {phase === "character-select" && (
          <CharacterSelectScreen key="character-select" initialNickname={nickname} onConfirm={handleConfirm} />
        )}
      </AnimatePresence>

      {phase === "preloading" && (
        <motion.div className="world-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="loading-leaf">●</div>
          <h2>{selected ? "선택한 친구와 마을로 가는 중" : "마을로 가는 중"}</h2>
          <div className="loading-track"><span style={{ width: `${assetsProgress}%` }}></span></div>
          <p>{assetsProgress < 70 ? "산책길과 오늘의 마음연구소를 준비하고 있어요." : "오늘 남겨진 흔적을 정리하고 있어요."}</p>
        </motion.div>
      )}

      {showWorldHud && !activeCommonsStation && <WorldHud />}
      {transitionActive && <div className={`scene-transition ${phase}`} aria-hidden="true"><span></span></div>}

      <AnimatePresence>
        {activeCommonsStation ? (
          <motion.div
            key={activeCommonsStation}
            className={`commons-overlay${activeCommonsStation === "guestbook" ? " memory-room-overlay" : ""}${memoryPlacement.active ? " is-placement-mode" : ""}`}
            data-testid="commons-overlay"
            data-memory-placement={memoryPlacement.active || undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (!memoryPlacement.active && event.currentTarget === event.target) {
                if (activeCommonsStation === "guestbook") {
                  if (selectedMemoryId) closeMemoryRoom();
                  else closeGuestbookEditor();
                }
                else closeCommonsStation();
              }
            }}
          >
            <motion.div
              initial={reducedMotion ? false : { y: 22, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { y: 14, scale: 0.985 }}
            >
              {activeCommonsStation === "guestbook" ? (
                selectedMemoryId ? (
                  <MemoryRoomPanel
                    controller={memoryRoom}
                    placement={memoryPlacement}
                    autoStart={false}
                    modal={!memoryPlacement.active}
                    selectedMemoryId={selectedMemoryId}
                    onSelectMemory={focusMemoryInRoom}
                    onClose={closeMemoryRoom}
                    onBeginRelocation={beginMemoryRelocation}
                    viewerOnly
                  />
                ) : (
                  <GuestbookLetterEditorModal
                    open
                    onArmed={armGuestbookVoucher}
                    onClose={closeGuestbookEditor}
                  />
                )
              ) : (
                <CommonsPanel
                  autoStart={false}
                  station="installation"
                  onClose={closeCommonsStation}
                />
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {phase === "world-error" && (
        <div className="world-error-panel" role="alert">
          <h2>3D 마을을 열지 못했어요</h2>
          <p>{worldError || "브라우저의 WebGL 설정을 확인하거나 기존 상담 화면을 이용해 주세요."}</p>
          <a href="http://127.0.0.1:8000/demo">기존 상담 화면 열기</a>
        </div>
      )}

      <CounselingScreen isOpen={counselOpen} shouldPrepare={shouldPrepareCounsel} />
      <AnimatePresence>
        {phase === "report-active" && counselReport && (
          <CounselReportOverlay key={counselReport.id} report={counselReport} onDismiss={dismissCounselReport} />
        )}
      </AnimatePresence>
      <div className="sr-only" aria-live="polite">
        현재 단계 {phase}. {selected ? `선택 캐릭터 ${selected}.` : ""}
      </div>
    </div>
  );
}
