"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { GuestbookLetterMesh } from "@/components/guestbook";
import {
  MEMORY_SURFACE_REGISTRY,
  type MemorySurfaceDefinition,
} from "@/constants/memorySurfaces";
import type { MemoryPlacementController } from "@/hooks/useMemoryPlacement";
import { GUESTBOOK_LETTER_SIZE } from "@/lib/guestbook/guestbookPlacement";
import { useMemoryRelocationStore } from "@/store/useMemoryRelocationStore";
import type {
  MemoryCardStyle,
  MemoryKind,
  MemoryPlacementInput,
  MemorySurfaceId,
  RoomMemory,
} from "@/types/memoryRoom";

export type { MemorySurfaceDefinition } from "@/constants/memorySurfaces";

/** Default placements align with the existing open-plan guestbook commons. */
export const PROMETHEUS_MEMORY_SURFACES: readonly MemorySurfaceDefinition[] =
  Object.values(MEMORY_SURFACE_REGISTRY);

const CARD_COLORS: Record<MemoryCardStyle, string> = {
  cream: "#f0dfba",
  sage: "#adc1a5",
  sky: "#a9c9d7",
  rose: "#ddb0aa",
  lilac: "#c4b4d5",
};

const KIND_SIZE: Record<MemoryKind, readonly [number, number]> = {
  note: [0.34, 0.25],
  mood: [0.3, 0.3],
  story: [0.44, 0.31],
};

export function memorySurfaceLocalPoint(
  surface: Pick<MemorySurfaceDefinition, "size">,
  placement: Pick<MemoryPlacementInput, "u" | "v" | "z_index">,
): [number, number, number] {
  return [
    (placement.u - 0.5) * surface.size[0],
    (placement.v - 0.5) * surface.size[1],
    0.012 + placement.z_index * 0.00001,
  ];
}

type MemoryCardMeshProps = {
  memory: Pick<RoomMemory, "id" | "kind" | "card_style" | "emotion" | "design" | "placement">;
  surface: MemorySurfaceDefinition;
  ghost?: boolean;
  valid?: boolean;
  selected?: boolean;
  onSelect?: (memoryId: string) => void;
};

function MemoryCardMesh({
  memory,
  surface,
  ghost = false,
  valid = true,
  selected = false,
  onSelect,
}: MemoryCardMeshProps) {
  const isDesignedLetter = Boolean(memory.design);
  const size = isDesignedLetter ? GUESTBOOK_LETTER_SIZE : KIND_SIZE[memory.kind];
  const position = memorySurfaceLocalPoint(surface, memory.placement);
  return (
    <group
      name={ghost ? "memory-placement-ghost" : `memory-card-${memory.id}`}
      position={position}
      rotation={[0, 0, memory.placement.rotation_deg * Math.PI / 180]}
      scale={memory.placement.scale * (selected ? (isDesignedLetter ? 1.025 : 1.08) : 1)}
    >
      {!ghost && onSelect ? (
        <mesh
          position={[0, 0, -0.002]}
          onClick={(event) => { event.stopPropagation(); onSelect(memory.id); }}
          onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { document.body.style.cursor = "auto"; }}
        >
          <planeGeometry args={[Math.max(0.52, size[0] * 1.28), Math.max(0.42, size[1] * 1.35)]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ) : null}
      {isDesignedLetter && memory.design ? (
        <GuestbookLetterMesh
          design={memory.design}
          width={size[0]}
          height={size[1]}
          selected={selected}
          opacity={ghost ? 0.72 : 1}
          valid={valid}
          resolution={ghost || selected ? "high" : "standard"}
        />
      ) : (
        <>
          <mesh
            castShadow={!ghost}
            renderOrder={10 + memory.placement.z_index}
            onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(memory.id); } : undefined}
          >
            <planeGeometry args={[size[0], size[1]]} />
            <meshStandardMaterial
              color={CARD_COLORS[memory.card_style]}
              emissive={ghost ? (valid ? "#fff4bd" : "#ff7d68") : selected ? "#fff4bd" : "#33291f"}
              emissiveIntensity={ghost ? 0.3 : selected ? 0.16 : 0.025}
              transparent={ghost}
              opacity={ghost ? 0.72 : 1}
              polygonOffset
              polygonOffsetFactor={-2}
              roughness={0.9}
            />
          </mesh>
          <mesh position={[-size[0] * 0.34, size[1] * 0.3, 0.004]} renderOrder={12 + memory.placement.z_index}>
            <circleGeometry args={[0.025, 12]} />
            <meshBasicMaterial color={memory.emotion ? "#fff7dd" : "#8a7867"} transparent opacity={ghost ? 0.7 : 0.9} />
          </mesh>
        </>
      )}
    </group>
  );
}

type MemoryRoomFieldProps = {
  memories: RoomMemory[];
  placement?: MemoryPlacementController;
  surfaces?: readonly MemorySurfaceDefinition[];
  draftAppearance?: Partial<Pick<RoomMemory, "kind" | "card_style" | "emotion">>;
  maxVisible?: number;
  selectedMemoryId?: string | null;
  onSelectMemory?: (memoryId: string) => void;
};

/**
 * Canvas-side renderer and raycast surface picker. Full text intentionally lives
 * in the accessible DOM album rather than as unreadable 3D glyphs.
 */
export function MemoryRoomField({
  memories,
  placement,
  surfaces = PROMETHEUS_MEMORY_SURFACES,
  draftAppearance,
  maxVisible = 40,
  selectedMemoryId,
  onSelectMemory,
}: MemoryRoomFieldProps) {
  const relocationStatus = useMemoryRelocationStore((state) => state.status);
  const relocationMemoryId = useMemoryRelocationStore((state) => state.memoryId);
  const relocationKind = useMemoryRelocationStore((state) => state.kind);
  const relocationCardStyle = useMemoryRelocationStore((state) => state.cardStyle);
  const relocationEmotion = useMemoryRelocationStore((state) => state.emotion);
  const relocationDesign = useMemoryRelocationStore((state) => state.design);
  const relocationOriginal = useMemoryRelocationStore((state) => state.original);
  const relocationCandidate = useMemoryRelocationStore((state) => state.candidate);
  const relocationValidation = useMemoryRelocationStore((state) => state.validation);
  const relocationActive = relocationStatus !== "idle";
  const bySurface = useMemo(() => {
    const map = new Map<MemorySurfaceId, RoomMemory[]>();
    memories.slice(0, maxVisible).forEach((memory) => {
      if (relocationActive && memory.id === relocationMemoryId) return;
      const current = map.get(memory.placement.surface_id) || [];
      current.push(memory);
      map.set(memory.placement.surface_id, current);
    });
    return map;
  }, [maxVisible, memories, relocationActive, relocationMemoryId]);

  const place = (surfaceId: MemorySurfaceId, event: ThreeEvent<PointerEvent>) => {
    if (!placement?.active || !event.uv) return;
    event.stopPropagation();
    placement.placeOnSurface(surfaceId, event.uv.x, event.uv.y);
  };

  const ghost = placement ? {
    id: "draft",
    kind: draftAppearance?.kind || "note",
    card_style: draftAppearance?.card_style || "cream",
    emotion: draftAppearance?.emotion || null,
    design: null,
    placement: { ...placement.value, version: 1 },
  } satisfies Pick<RoomMemory, "id" | "kind" | "card_style" | "emotion" | "design" | "placement"> : null;
  const relocationGhost = (
    relocationMemoryId
    && relocationKind
    && relocationCardStyle
    && relocationOriginal
    && relocationCandidate
  )
    ? {
        id: relocationMemoryId,
        kind: relocationKind,
        card_style: relocationCardStyle,
        emotion: relocationEmotion,
        design: relocationDesign,
        placement: {
          ...relocationCandidate.placement,
          version: relocationOriginal.version,
        },
      } satisfies Pick<
        RoomMemory,
        "id" | "kind" | "card_style" | "emotion" | "design" | "placement"
      >
    : null;

  return (
    <group name="prometheus-memory-room-field">
      {surfaces.map((surface) => (
        <group key={surface.id} position={surface.position} rotation={surface.rotation} name={`memory-surface-${surface.id}`}>
          <mesh
            name={`memory-hit-area-${surface.id}`}
            renderOrder={2}
            onPointerDown={(event) => place(surface.id, event)}
            onPointerMove={(event) => { if (event.buttons === 1) place(surface.id, event); }}
          >
            <planeGeometry args={surface.size} />
            <meshBasicMaterial
              color="#f7dc95"
              transparent
              opacity={placement?.active ? (placement.value.surface_id === surface.id ? 0.14 : 0.035) : 0}
              depthWrite={false}
              colorWrite={Boolean(placement?.active)}
            />
          </mesh>
          {(bySurface.get(surface.id) || []).map((memory) => (
            <MemoryCardMesh key={memory.id} memory={memory} surface={surface} selected={selectedMemoryId === memory.id} onSelect={onSelectMemory} />
          ))}
          {ghost && placement?.active && ghost.placement.surface_id === surface.id
            ? <MemoryCardMesh memory={ghost} surface={surface} ghost />
            : null}
          {relocationGhost && relocationGhost.placement.surface_id === surface.id
            ? (
                <MemoryCardMesh
                  memory={relocationGhost}
                  surface={surface}
                  ghost
                  valid={relocationValidation?.valid ?? false}
                />
              )
            : null}
        </group>
      ))}
    </group>
  );
}
