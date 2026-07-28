"use client";

import { useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { WORLD_CONFIG } from "@/constants/worldConfig";
import { useGameStore } from "@/store/useGameStore";
import type { MemoryPlacementController } from "@/hooks/useMemoryPlacement";
import type { MemoryPlacementInput, RoomMemory } from "@/types/memoryRoom";
import { CharacterPreviewScene } from "./CharacterPreviewScene";
import { EXTERIOR_PERFORMANCE_BUDGETS } from "./exterior/exteriorLayout";
import { WorldScene } from "./WorldScene";

type GameCanvasProps = {
  memories?: RoomMemory[];
  memoryPlacement?: MemoryPlacementController;
  selectedMemoryId?: string | null;
  onSelectMemory?: (memoryId: string) => void;
  onPlaceGuestbook?: (placement: MemoryPlacementInput) => void;
  onOpenGuestbookEditor?: () => void;
  onCommitMemoryRelocation?: () => void;
};

function WorldAssetGate() {
  const phase = useGameStore((state) => state.phase);
  const setAssetsProgress = useGameStore((state) => state.setAssetsProgress);
  const enterWorld = useGameStore((state) => state.enterWorld);
  const setError = useGameStore((state) => state.setError);
  const { active, loaded, total, progress, errors } = useProgress();
  const startedAt = useRef(0);

  useEffect(() => {
    if (phase !== "preloading") {
      startedAt.current = 0;
      return;
    }
    if (!startedAt.current) startedAt.current = performance.now();
    const measured = total > 0 ? progress : active ? 28 : 100;
    setAssetsProgress(Math.max(12, Math.min(100, Math.round(measured))));

    if (errors.length > 0) {
      setError("선택한 캐릭터 에셋을 불러오지 못했어요.");
      return;
    }
    if (active || (total > 0 && loaded < total)) return;

    // Keep a short minimum dwell so cached assets do not flash the loading UI
    // and give the Canvas one frame to register new loader requests.
    const remaining = Math.max(0, 420 - (performance.now() - startedAt.current));
    const timer = window.setTimeout(enterWorld, remaining + 80);
    return () => window.clearTimeout(timer);
  }, [active, enterWorld, errors, loaded, phase, progress, setAssetsProgress, setError, total]);

  return null;
}

function WebGLHealthBridge({ onUnrecoverableLoss }: { onUnrecoverableLoss: () => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    let recoveryTimer = 0;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      // Browsers can restore a transient WebGL loss when the default action is
      // cancelled. Give Three.js a brief chance to recover before rebuilding
      // the renderer; failing immediately strands otherwise capable devices.
      window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(onUnrecoverableLoss, 120);
    };
    const handleContextRestored = () => window.clearTimeout(recoveryTimer);
    canvas.addEventListener("webglcontextlost", handleContextLost, false);
    canvas.addEventListener("webglcontextrestored", handleContextRestored, false);
    return () => {
      window.clearTimeout(recoveryTimer);
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
    };
  }, [gl, onUnrecoverableLoss]);

  return null;
}

export default function GameCanvas({
  memories = [],
  memoryPlacement,
  selectedMemoryId,
  onSelectMemory,
  onPlaceGuestbook,
  onOpenGuestbookEditor,
  onCommitMemoryRelocation,
}: GameCanvasProps) {
  const setError = useGameStore((state) => state.setError);
  const phase = useGameStore((state) => state.phase);
  const selected = useGameStore((state) => state.selectedCharacterId) || "sprout";
  const confirmed = useGameStore((state) => state.confirmedCharacterId) || selected;
  const isPreview = phase === "character-select" || phase === "preloading";
  const constrainedRenderBudget = typeof window !== "undefined" && (
    window.innerWidth <= 820
    || (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)
    || (typeof navigator !== "undefined" && navigator.webdriver)
    || (typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  );
  const dpr: number | [number, number] = constrainedRenderBudget
    ? EXTERIOR_PERFORMANCE_BUDGETS.mobile.maxDpr
    : [1, EXTERIOR_PERFORMANCE_BUDGETS.desktop.maxDpr];
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const recoveryAttempts = useRef(0);
  const handleUnrecoverableLoss = useCallback(() => {
    if (recoveryAttempts.current < 1) {
      recoveryAttempts.current += 1;
      setRendererAttempt((attempt) => attempt + 1);
      return;
    }
    setError("3D 그래픽 연결이 잠시 끊겼어요. 자동 복구하지 못해 새로고침이 필요해요.");
  }, [setError]);

  return (
    <Canvas
      key={rendererAttempt}
      className="game-canvas"
      shadows={!constrainedRenderBudget}
      dpr={dpr}
      camera={{ fov: 34, near: 0.1, far: 100, position: [...WORLD_CONFIG.cameraOffset] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.outputColorSpace = SRGBColorSpace;
      }}
      fallback={<div className="webgl-fallback">3D 화면을 시작할 수 없습니다.</div>}
    >
      <WorldAssetGate />
      <WebGLHealthBridge onUnrecoverableLoss={handleUnrecoverableLoss} />
      {isPreview ? <CharacterPreviewScene characterId={selected} /> : (
        <WorldScene
          characterId={confirmed}
          memories={memories}
          memoryPlacement={memoryPlacement}
          selectedMemoryId={selectedMemoryId}
          onSelectMemory={onSelectMemory}
          onPlaceGuestbook={onPlaceGuestbook}
          onOpenGuestbookEditor={onOpenGuestbookEditor}
          onCommitMemoryRelocation={onCommitMemoryRelocation}
        />
      )}
    </Canvas>
  );
}
