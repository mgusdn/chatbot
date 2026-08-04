"use client";

import { Physics, RigidBody, CapsuleCollider, type RapierRigidBody } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MathUtils, Vector3, type Group } from "three";
import { CHARACTER_BY_ID } from "@/constants/characterCatalog";
import { COMMONS_INTERACTION_ANCHORS, COMMONS_TRACE_ANCHORS } from "@/constants/interiorLayout";
import {
  getMemorySurface,
  type MemoryRelocationSurfaceId,
} from "@/constants/memorySurfaces";
import { WORLD_CONFIG } from "@/constants/worldConfig";
import { GuestbookLetterMesh } from "@/components/guestbook";
import { resolveGameKey } from "@/lib/gameInput";
import { GUESTBOOK_LETTER_SIZE } from "@/lib/guestbook/guestbookPlacement";
import { GUESTBOOK_PLACE_EVENT } from "@/lib/guestbook/placementEvents";
import {
  getMemoryRelocationBaseSize,
  evaluateMemoryRelocation,
  type MemoryRelocationEvaluation,
  type MemoryRelocationValidation,
} from "@/lib/memoryRelocation";
import {
  MEMORY_RELOCATION_CANCEL_EVENT,
  MEMORY_RELOCATION_COMMIT_EVENT,
} from "@/lib/memory-room/relocationEvents";
import { withinRadius } from "@/lib/gameState";
import { useGameStore } from "@/store/useGameStore";
import { useCommonsStore } from "@/store/useCommonsStore";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import { useMemoryRelocationStore } from "@/store/useMemoryRelocationStore";
import { useRoomMultiplayer } from "@/hooks/useRoomMultiplayer";
import type { CharacterId } from "@/types/character";
import type { InteractableId } from "@/types/game";
import type { MemoryPlacementInput } from "@/types/memoryRoom";
import type { LocalPlayerTelemetry, MultiplayerStatus } from "@/types/multiplayer";
import { CharacterRenderer } from "./CharacterRenderer";
import { RemotePlayers } from "./RemotePlayers";
import { CommonsTraceField } from "@/components/commons";
import {
  MemoryRoomField,
  memorySurfaceLocalPoint,
} from "@/components/memory-room";
import type { MemoryPlacementController } from "@/hooks/useMemoryPlacement";
import type { RoomMemory } from "@/types/memoryRoom";
import { ExteriorWorld } from "./exterior/ExteriorWorld";
import { getCoastCameraReveal, softenVelocityAtCoast } from "./exterior/exteriorLayout";
import { InteriorScene, preloadInteriorScene } from "./interior/InteriorScene";
import { VillagerNpcs, type PlayerPositionRef } from "./npc/VillagerNpcs";

const isTypingControl = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
};

const isButtonControl = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("button"));
};

// Keyboard state lives outside the renderer subtree so a recoverable WebGL
// remount cannot swallow a key that is already being held down.
const pressedWorldKeys = new Set<string>();

// The editor opens beside the worktable. Requiring a short walk away keeps the
// freshly armed letter from immediately appearing as a red table collision.
export const GUESTBOOK_STATION_PROTECTION_RADIUS = WORLD_CONFIG.interactionRadius + 0.8;

export function hasClearedGuestbookStation(position: { x: number; z: number }) {
  const anchor = COMMONS_INTERACTION_ANCHORS.guestbook;
  return Math.hypot(position.x - anchor[0], position.z - anchor[2])
    > GUESTBOOK_STATION_PROTECTION_RADIUS;
}

type GuestbookGhostState = MemoryRelocationEvaluation;

function guestbookPlacementMessage(validation: MemoryRelocationValidation) {
  if (validation.valid) return "";
  if (validation.reason === "entrance-clearance") return "입구 통로는 비워주세요. 조금 안쪽에서 놓아주세요.";
  if (validation.reason === "furniture-collision") return "가구와 겹쳐요. 조금 더 열린 바닥에서 놓아주세요.";
  if (validation.reason === "wall-fixture-collision") return "벽의 가구나 게시물과 겹쳐요. 옆으로 조금 이동해주세요.";
  if (validation.reason === "surface-bounds" || validation.reason === "surface-too-small") {
    return "편지가 벽이나 바닥 밖으로 나가요. 가장자리에서 떨어져주세요.";
  }
  return "지금 위치에서는 방명록을 놓을 수 없어요.";
}

function relocationPlacementMessage(reason: string | null) {
  if (reason === "entrance-clearance") return "입구 통로는 비워주세요. 조금 안쪽으로 옮겨주세요.";
  if (reason === "furniture-collision") return "가구와 겹쳐요. 열린 바닥으로 옮겨주세요.";
  if (reason === "wall-fixture-collision") return "벽의 가구나 게시물과 겹쳐요. 옆으로 조금 이동해주세요.";
  if (reason === "surface-bounds" || reason === "surface-too-small") {
    return "편지가 벽이나 바닥 밖으로 나가요. 가장자리에서 떨어져주세요.";
  }
  return "지금 위치에는 붙일 수 없어요. 조금 이동해주세요.";
}

function PlayerController({
  characterId,
  onPlaceGuestbook,
  onOpenGuestbookEditor,
  onCommitMemoryRelocation,
  playerPositionRef,
  localPlayerTelemetryRef,
}: {
  characterId: CharacterId;
  onPlaceGuestbook?: (placement: MemoryPlacementInput) => void;
  onOpenGuestbookEditor?: () => void;
  onCommitMemoryRelocation?: () => void;
  playerPositionRef?: PlayerPositionRef;
  localPlayerTelemetryRef?: MutableRefObject<LocalPlayerTelemetry>;
}) {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<Group>(null);
  const { camera, invalidate } = useThree();
  const smoothedTarget = useMemo(() => new Vector3(), []);
  const [moving, setMoving] = useState(false);
  const [running, setRunning] = useState(false);
  const [guestbookGhost, setGuestbookGhost] = useState<GuestbookGhostState | null>(null);
  const ghostSnapshot = useRef("");
  const previousGuestbookSurface = useRef<MemoryRelocationSurfaceId | null>(null);
  const relocationSnapshot = useRef("");
  const previousRelocationSurface = useRef<MemoryRelocationSurfaceId | null>(null);
  const phase = useGameStore((state) => state.phase);
  const scene = useGameStore((state) => state.scene);
  const mobileMove = useGameStore((state) => state.mobileMove);
  const nearby = useGameStore((state) => state.nearbyInteractable);
  const interactionNonce = useGameStore((state) => state.interactionNonce);
  const returnSnapshot = useGameStore((state) => state.returnSnapshot);
  const clearReturnSnapshot = useGameStore((state) => state.clearReturnSnapshot);
  const activeCommonsStation = useGameStore((state) => state.activeCommonsStation);
  const setNearby = useGameStore((state) => state.setNearbyInteractable);
  const consumeInteraction = useGameStore((state) => state.consumeInteraction);
  const beginBuildingTransition = useGameStore((state) => state.beginBuildingTransition);
  const beginCounsel = useGameStore((state) => state.beginCounsel);
  const openCommonsStation = useGameStore((state) => state.openCommonsStation);
  const guestbookStatus = useGuestbookVoucherStore((state) => state.status);
  const guestbookDesign = useGuestbookVoucherStore((state) => state.design);
  const guestbookRotation = useGuestbookVoucherStore((state) => state.rotation_offset_deg);
  const guestbookPlacementReady = useGuestbookVoucherStore((state) => state.placement_ready);
  const relocationStatus = useMemoryRelocationStore((state) => state.status);
  const relocationKind = useMemoryRelocationStore((state) => state.kind);
  const relocationDesign = useMemoryRelocationStore((state) => state.design);
  const relocationOriginal = useMemoryRelocationStore((state) => state.original);
  const relocationRequestId = useMemoryRelocationStore((state) => state.requestId);
  const relocationActive = relocationStatus !== "idle";
  const guestbookVoucherActive = scene === "interior"
    && ["armed", "submitting", "error"].includes(guestbookStatus);

  const active = !activeCommonsStation
    && (phase === "exploring-exterior" || phase === "exploring-interior" || phase === "interaction-ready");
  const spawn = useRef<[number, number, number]>(
    returnSnapshot?.scene === scene
      ? [...returnSnapshot.position]
      : [...(scene === "exterior" ? WORLD_CONFIG.exteriorSpawn : WORLD_CONFIG.interiorSpawn)],
  );
  const character = CHARACTER_BY_ID[characterId];

  const placeGuestbook = useCallback(() => {
    const voucher = useGuestbookVoucherStore.getState();
    if (
      scene !== "interior"
      || !active
      || !["armed", "error"].includes(voucher.status)
      || !voucher.placement_ready
      || !voucher.design
      || !body.current
      || !visual.current
    ) return;
    const translation = body.current.translation();
    const result = evaluateMemoryRelocation(
      { x: translation.x, z: translation.z, yaw: visual.current.rotation.y },
      {
        baseSize: GUESTBOOK_LETTER_SIZE,
        scale: 1,
        zIndex: 0,
        previousSurfaceId: previousGuestbookSurface.current,
        rotationOffsetDeg: voucher.rotation_offset_deg,
      },
    );
    if (!result.validation.valid) {
      voucher.fail(guestbookPlacementMessage(result.validation));
      return;
    }
    if (!voucher.setSubmitting()) return;
    if (!onPlaceGuestbook) {
      voucher.fail("방명록을 저장할 수 없어요. 잠시 후 다시 시도해주세요.");
      return;
    }
    onPlaceGuestbook({
      ...result.candidate.placement,
    });
  }, [active, onPlaceGuestbook, scene]);

  const commitMemoryRelocation = useCallback(() => {
    const relocation = useMemoryRelocationStore.getState();
    if (
      scene !== "interior"
      || !active
      || !["carrying", "error"].includes(relocation.status)
      || !relocation.requestId
    ) return;
    if (!relocation.validation?.valid) {
      relocation.fail(
        relocationPlacementMessage(relocation.validation?.reason || null),
        relocation.requestId,
      );
      return;
    }
    if (!relocation.setSubmitting(relocation.requestId)) return;
    if (!onCommitMemoryRelocation) {
      relocation.fail("추억을 저장할 수 없어요. 잠시 후 다시 시도해주세요.", relocation.requestId);
      return;
    }
    onCommitMemoryRelocation();
  }, [active, onCommitMemoryRelocation, scene]);

  const cancelMemoryRelocation = useCallback(() => {
    const relocation = useMemoryRelocationStore.getState();
    if (relocation.status === "submitting") return;
    relocation.cancel();
  }, []);

  useEffect(() => {
    // Restore the exact pre-counsel view while the transition curtain is still
    // covering the world. The report can then arrive over an already-settled
    // scene, and cancelling an unfinished counseling session returns correctly
    // even though no report phase follows.
    if (
      !["leaving-counsel", "report-active", "exploring-exterior", "exploring-interior", "interaction-ready"].includes(phase)
      || !returnSnapshot
      || returnSnapshot.scene !== scene
      || !body.current
    ) return;
    body.current.setTranslation(
      { x: returnSnapshot.position[0], y: returnSnapshot.position[1], z: returnSnapshot.position[2] },
      true,
    );
    body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (visual.current) visual.current.rotation.y = returnSnapshot.rotationY;
    camera.position.set(...returnSnapshot.cameraPosition);
    smoothedTarget.set(...returnSnapshot.cameraTarget);
    camera.lookAt(smoothedTarget);
    invalidate();
    clearReturnSnapshot();
  }, [camera, clearReturnSnapshot, invalidate, phase, returnSnapshot, scene, smoothedTarget]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!active || isTypingControl(event.target)) return;
      const key = resolveGameKey(event);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
        pressedWorldKeys.add(key);
        if (key.startsWith("arrow")) event.preventDefault();
      }
      if (relocationActive) {
        if (key === "q" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          commitMemoryRelocation();
          return;
        }
        if ((key === "r" || key === "escape") && !event.repeat) {
          event.preventDefault();
          cancelMemoryRelocation();
          return;
        }
        if (key === "e" || key === " ") {
          event.preventDefault();
          return;
        }
      }
      if (guestbookVoucherActive && (key === "e" || key === " ")) {
        if (key === " " && isButtonControl(event.target)) return;
        event.preventDefault();
        return;
      }
      if ((key === "e" || key === " ") && !event.repeat) {
        if (key === " " && isButtonControl(event.target)) return;
        event.preventDefault();
        useGameStore.getState().requestInteraction();
      }
      if (key === "q" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        placeGuestbook();
      }
      if (key === "r" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const voucher = useGuestbookVoucherStore.getState();
        if (scene === "interior" && ["armed", "error"].includes(voucher.status)) {
          event.preventDefault();
          if (voucher.placement_preview?.kind !== "wall") {
            voucher.rotate(event.shiftKey ? -15 : 15);
          }
        }
      }
    };
    const up = (event: KeyboardEvent) => pressedWorldKeys.delete(resolveGameKey(event));
    const blur = () => pressedWorldKeys.clear();
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [
    active,
    cancelMemoryRelocation,
    commitMemoryRelocation,
    placeGuestbook,
    relocationActive,
    scene,
    guestbookVoucherActive,
  ]);

  useEffect(() => {
    window.addEventListener(GUESTBOOK_PLACE_EVENT, placeGuestbook);
    return () => window.removeEventListener(GUESTBOOK_PLACE_EVENT, placeGuestbook);
  }, [placeGuestbook]);

  useEffect(() => {
    window.addEventListener(MEMORY_RELOCATION_COMMIT_EVENT, commitMemoryRelocation);
    window.addEventListener(MEMORY_RELOCATION_CANCEL_EVENT, cancelMemoryRelocation);
    return () => {
      window.removeEventListener(MEMORY_RELOCATION_COMMIT_EVENT, commitMemoryRelocation);
      window.removeEventListener(MEMORY_RELOCATION_CANCEL_EVENT, cancelMemoryRelocation);
    };
  }, [cancelMemoryRelocation, commitMemoryRelocation]);

  useEffect(() => {
    if (active) return;
    pressedWorldKeys.clear();
    useGameStore.getState().setMobileMove([0, 0]);
  }, [active]);

  useEffect(() => {
    if (!interactionNonce || !body.current) return;
    if (relocationActive || guestbookVoucherActive) {
      consumeInteraction();
      return;
    }
    const requestedTarget = consumeInteraction();
    if (!requestedTarget) return;
    const translation = body.current.translation();
    if (requestedTarget === "counseling-house" || requestedTarget === "exit-house") {
      body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      beginBuildingTransition();
      return;
    }
    if (requestedTarget === "pbao") {
      body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (visual.current) visual.current.rotation.y = Math.PI;
      beginCounsel({
        scene: "interior",
        position: [translation.x, translation.y, translation.z],
        rotationY: visual.current?.rotation.y || 0,
        cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
        cameraTarget: [smoothedTarget.x, smoothedTarget.y, smoothedTarget.z],
      });
      return;
    }
    if (requestedTarget === "guestbook") {
      body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (onOpenGuestbookEditor) onOpenGuestbookEditor();
      else openCommonsStation("guestbook");
      return;
    }
    if (requestedTarget === "installation") {
      body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      openCommonsStation("installation");
    }
  }, [
    interactionNonce,
    beginBuildingTransition,
    beginCounsel,
    camera,
    consumeInteraction,
    onOpenGuestbookEditor,
    openCommonsStation,
    relocationActive,
    guestbookVoucherActive,
    smoothedTarget,
  ]);

  useFrame((_, delta) => {
    if (!body.current) return;
    const velocity = body.current.linvel();
    const playerPosition = body.current.translation();
    if (playerPositionRef) {
      playerPositionRef.current.x = playerPosition.x;
      playerPositionRef.current.z = playerPosition.z;
    }
    const canPreviewRelocation = scene === "interior"
      && !activeCommonsStation
      && relocationActive
      && relocationStatus !== "submitting"
      && Boolean(relocationKind)
      && Boolean(relocationOriginal)
      && Boolean(relocationRequestId);
    if (
      canPreviewRelocation
      && visual.current
      && relocationKind
      && relocationOriginal
      && relocationRequestId
    ) {
      const result = evaluateMemoryRelocation(
        { x: playerPosition.x, z: playerPosition.z, yaw: visual.current.rotation.y },
        {
          baseSize: getMemoryRelocationBaseSize({
            kind: relocationKind,
            design: relocationDesign,
          }),
          scale: relocationOriginal.scale,
          zIndex: relocationOriginal.z_index,
          previousSurfaceId: previousRelocationSurface.current,
        },
      );
      previousRelocationSurface.current = result.candidate.surfaceId;
      const nextSnapshot = [
        relocationRequestId,
        result.candidate.surfaceId,
        result.candidate.placement.u.toFixed(4),
        result.candidate.placement.v.toFixed(4),
        result.candidate.placement.rotation_deg.toFixed(1),
        result.validation.valid ? "1" : result.validation.reason,
        result.validation.blockerId || "",
      ].join(":");
      if (relocationSnapshot.current !== nextSnapshot) {
        relocationSnapshot.current = nextSnapshot;
        useMemoryRelocationStore.getState().update(result, relocationRequestId);
      }
    } else if (!relocationActive) {
      relocationSnapshot.current = "";
      previousRelocationSurface.current = null;
    }
    if (
      guestbookVoucherActive
      && !guestbookPlacementReady
      && hasClearedGuestbookStation(playerPosition)
    ) {
      useGuestbookVoucherStore.getState().enablePlacement();
    }
    const canPreviewGuestbook = scene === "interior"
      && !activeCommonsStation
      && !relocationActive
      && guestbookPlacementReady
      && Boolean(guestbookDesign)
      && ["armed", "submitting", "error"].includes(guestbookStatus);
    if (canPreviewGuestbook && visual.current) {
      const result = evaluateMemoryRelocation(
        { x: playerPosition.x, z: playerPosition.z, yaw: visual.current.rotation.y },
        {
          baseSize: GUESTBOOK_LETTER_SIZE,
          scale: 1,
          zIndex: 0,
          previousSurfaceId: previousGuestbookSurface.current,
          rotationOffsetDeg: guestbookRotation,
        },
      );
      previousGuestbookSurface.current = result.candidate.surfaceId;
      const nextSnapshot = [
        result.candidate.surfaceId,
        result.candidate.placement.u.toFixed(4),
        result.candidate.placement.v.toFixed(4),
        result.candidate.placement.rotation_deg.toFixed(1),
        result.validation.valid ? "1" : result.validation.reason,
        result.validation.blockerId || "",
      ].join(":");
      if (ghostSnapshot.current !== nextSnapshot) {
        ghostSnapshot.current = nextSnapshot;
        setGuestbookGhost(result);
        useGuestbookVoucherStore.getState().setPlacementPreview({
          surface_id: result.candidate.surfaceId,
          kind: result.candidate.kind,
          valid: result.validation.valid,
          invalid_reason: result.validation.valid ? null : result.validation.reason,
        });
      }
    } else if (guestbookGhost) {
      ghostSnapshot.current = "";
      previousGuestbookSurface.current = null;
      setGuestbookGhost(null);
      useGuestbookVoucherStore.getState().setPlacementPreview(null);
    }
    if (!active) {
      body.current.setLinvel({ x: 0, y: velocity.y, z: 0 }, true);
      if (localPlayerTelemetryRef) {
        localPlayerTelemetryRef.current = {
          ready: true,
          position: [playerPosition.x, playerPosition.y, playerPosition.z],
          rotationY: visual.current?.rotation.y ?? 0,
          moving: false,
          running: false,
        };
      }
      if (moving) setMoving(false);
      if (running) setRunning(false);
      return;
    }

    const x = (pressedWorldKeys.has("d") || pressedWorldKeys.has("arrowright") ? 1 : 0)
      - (pressedWorldKeys.has("a") || pressedWorldKeys.has("arrowleft") ? 1 : 0) + mobileMove[0];
    const z = (pressedWorldKeys.has("s") || pressedWorldKeys.has("arrowdown") ? 1 : 0)
      - (pressedWorldKeys.has("w") || pressedWorldKeys.has("arrowup") ? 1 : 0) + mobileMove[1];
    const length = Math.hypot(x, z);
    const isMoving = length > 0.08;
    const isRunning = pressedWorldKeys.has("shift") && isMoving;
    const speed = isRunning ? WORLD_CONFIG.runSpeed : WORLD_CONFIG.walkSpeed;
    const nx = isMoving ? x / Math.max(1, length) : 0;
    const nz = isMoving ? z / Math.max(1, length) : 0;
    const position = playerPosition;
    const plannedVelocity: [number, number] = [nx * speed, nz * speed];
    const [velocityX, velocityZ] = scene === "exterior"
      ? softenVelocityAtCoast([position.x, position.z], plannedVelocity)
      : plannedVelocity;
    body.current.setLinvel({ x: velocityX, y: velocity.y, z: velocityZ }, true);

    if (visual.current && isMoving) {
      const desired = Math.atan2(nx, nz);
      visual.current.rotation.y = MathUtils.damp(visual.current.rotation.y, desired, 10, delta);
    }
    if (moving !== isMoving) setMoving(isMoving);
    if (running !== isRunning) setRunning(isRunning);
    if (localPlayerTelemetryRef) {
      localPlayerTelemetryRef.current = {
        ready: true,
        position: [position.x, position.y, position.z],
        rotationY: visual.current?.rotation.y ?? 0,
        moving: isMoving,
        running: isRunning,
      };
    }

    const tuple: [number, number, number] = [position.x, position.y, position.z];
    let target: InteractableId | null = null;
    const radius = WORLD_CONFIG.interactionRadius + (nearby ? 0.15 : 0);
    if (!relocationActive && scene === "exterior" && withinRadius(tuple, WORLD_CONFIG.houseDoor, radius)) {
      target = "counseling-house";
    }
    if (!relocationActive && !guestbookVoucherActive && scene === "interior") {
      if (withinRadius(tuple, WORLD_CONFIG.pbaoInteraction, radius)) target = "pbao";
      else if (withinRadius(tuple, COMMONS_INTERACTION_ANCHORS.guestbook, radius)) target = "guestbook";
      else if (withinRadius(tuple, COMMONS_INTERACTION_ANCHORS.installation, radius)) target = "installation";
      else if (withinRadius(tuple, WORLD_CONFIG.interiorExit, radius)) target = "exit-house";
    }
    if (target !== nearby) setNearby(target);

    const lookAhead = isMoving ? 0.42 : 0;
    const coastReveal = scene === "exterior" ? getCoastCameraReveal([position.x, position.z]) : null;
    const desiredTarget = new Vector3(
      position.x + nx * lookAhead + (coastReveal?.targetShift[0] ?? 0),
      position.y + character.visual.worldTargetHeight,
      position.z + nz * lookAhead + (coastReveal?.targetShift[1] ?? 0),
    );
    const alpha = 1 - Math.exp(-6 * delta);
    smoothedTarget.lerp(desiredTarget, alpha);
    const cameraOffset = scene === "interior" ? WORLD_CONFIG.interiorCameraOffset : WORLD_CONFIG.cameraOffset;
    const desiredPosition = desiredTarget.clone().add(new Vector3(
      cameraOffset[0] + (coastReveal?.cameraShift[0] ?? 0),
      cameraOffset[1],
      cameraOffset[2] + (coastReveal?.cameraShift[1] ?? 0),
    ));
    camera.position.lerp(desiredPosition, alpha);
    camera.lookAt(smoothedTarget);
  });

  const guestbookGhostSurface = guestbookGhost
    ? getMemorySurface(guestbookGhost.candidate.surfaceId)
    : null;

  return (
    <>
      <RigidBody ref={body} position={spawn.current} colliders={false} enabledRotations={[false, false, false]} linearDamping={8} canSleep={false} name="player-rigidbody">
        <CapsuleCollider args={[character.collider.halfHeight, character.collider.radius]} />
        <group ref={visual}>
          <CharacterRenderer character={character} moving={moving} running={running} />
        </group>
      </RigidBody>
      {!relocationActive && guestbookGhost && guestbookGhostSurface && guestbookDesign ? (
        <group
          name="guestbook-placement-ghost-surface"
          position={guestbookGhostSurface.position}
          rotation={guestbookGhostSurface.rotation}
        >
          <group
            name="guestbook-placement-ghost"
            position={memorySurfaceLocalPoint(
              guestbookGhostSurface,
              guestbookGhost.candidate.placement,
            )}
            rotation={[
              0,
              0,
              guestbookGhost.candidate.placement.rotation_deg * Math.PI / 180,
            ]}
            scale={guestbookGhost.candidate.placement.scale}
          >
            <GuestbookLetterMesh
              design={guestbookDesign}
              opacity={guestbookStatus === "submitting" ? 0.78 : 0.62}
              selected={guestbookStatus === "submitting"}
              valid={guestbookGhost.validation.valid}
              resolution="high"
            />
          </group>
        </group>
      ) : null}
    </>
  );
}

function GameLoopGate({ paused }: { paused: boolean }) {
  const setFrameloop = useThree((state) => state.setFrameloop);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    setFrameloop(paused ? "demand" : "always");
    invalidate();
    return () => setFrameloop("always");
  }, [paused, setFrameloop, invalidate]);
  return null;
}

type WorldSceneProps = {
  characterId: CharacterId;
  nickname?: string;
  onMultiplayerStateChange?: (status: MultiplayerStatus, count: number) => void;
  memories?: RoomMemory[];
  memoryPlacement?: MemoryPlacementController;
  selectedMemoryId?: string | null;
  onSelectMemory?: (memoryId: string) => void;
  onPlaceGuestbook?: (placement: MemoryPlacementInput) => void;
  onOpenGuestbookEditor?: () => void;
  onCommitMemoryRelocation?: () => void;
};

export function WorldScene({
  characterId,
  nickname = "",
  onMultiplayerStateChange,
  memories = [],
  memoryPlacement,
  selectedMemoryId,
  onSelectMemory,
  onPlaceGuestbook,
  onOpenGuestbookEditor,
  onCommitMemoryRelocation,
}: WorldSceneProps) {
  const scene = useGameStore((state) => state.scene);
  const phase = useGameStore((state) => state.phase);
  const activeCommonsStation = useGameStore((state) => state.activeCommonsStation);
  const npcPlayerPositionRef = useRef({ x: 0, z: 0 });
  const multiplayer = useRoomMultiplayer({
    enabled: scene === "interior",
    roomSlug: "prometheus",
    characterId,
    nickname,
  });
  const commonsTraces = useCommonsStore((state) => state.traces);
  const installationTraces = useMemo(
    () => commonsTraces.filter((trace) => trace.kind === "installation"),
    [commonsTraces],
  );
  useEffect(() => {
    onMultiplayerStateChange?.(multiplayer.status, multiplayer.remotePlayers.length);
  }, [multiplayer.remotePlayers.length, multiplayer.status, onMultiplayerStateChange]);
  const paused = phase === "entering-counsel"
    || phase === "counsel-active"
    || phase === "leaving-counsel"
    || phase === "report-active"
    || Boolean(activeCommonsStation);

  useEffect(() => {
    if (scene !== "exterior") return;
    const timer = window.setTimeout(preloadInteriorScene, 450);
    return () => window.clearTimeout(timer);
  }, [scene]);

  return (
    <>
      <color attach="background" args={[scene === "exterior" ? "#b9d4ce" : "#b9906e"]} />
      <GameLoopGate paused={paused} />
      <Suspense fallback={
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[2, 0.2, 2]} />
          <meshBasicMaterial color="#f2cf67" />
        </mesh>
      }>
        <Physics gravity={[0, -18, 0]} timeStep={1 / 60} paused={paused}>
          {scene === "exterior" ? <ExteriorWorld /> : (
            <>
              <InteriorScene />
              <CommonsTraceField traces={installationTraces} anchors={COMMONS_TRACE_ANCHORS} />
              <MemoryRoomField
                memories={memories}
                placement={memoryPlacement}
                selectedMemoryId={selectedMemoryId}
                onSelectMemory={onSelectMemory}
              />
              <VillagerNpcs playerPositionRef={npcPlayerPositionRef} />
              <RemotePlayers players={multiplayer.remotePlayers} />
            </>
          )}
          <PlayerController
            key={`${scene}-${characterId}`}
            characterId={characterId}
            onPlaceGuestbook={onPlaceGuestbook}
            onOpenGuestbookEditor={onOpenGuestbookEditor}
            onCommitMemoryRelocation={onCommitMemoryRelocation}
            playerPositionRef={npcPlayerPositionRef}
            localPlayerTelemetryRef={multiplayer.localPlayerTelemetryRef}
          />
        </Physics>
      </Suspense>
    </>
  );
}
