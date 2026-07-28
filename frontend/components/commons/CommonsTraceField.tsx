"use client";

import { useMemo, type ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { InteriorAsset } from "@/components/game/interior/InteriorAsset";
import type { CommonsTrace, CommonsTraceAnchor, CommonsTracePlacement } from "@/types/commons";

const FURNITURE = "/models/kenney-furniture-kit";
const NATURE = "/models/kenney-nature-kit";

function accepts(anchor: CommonsTraceAnchor, trace: CommonsTrace) {
  if (anchor.accepts) return anchor.accepts.includes(trace.kind);
  return anchor.id === "today-wall" ? trace.kind === "guestbook" : anchor.id.startsWith("installation-") && trace.kind === "installation";
}

function capacity(anchor: CommonsTraceAnchor) {
  return Math.max(1, Math.floor(anchor.capacity ?? (anchor.id === "today-wall" ? 12 : 1)));
}

function localPosition(anchor: CommonsTraceAnchor, slotIndex: number): [number, number, number] {
  if ((anchor.layout ?? (anchor.id === "today-wall" ? "grid" : "single")) === "single") return [0, 0, 0];
  const spacing = anchor.spacing ?? 0.72;
  if (anchor.layout === "row") return [(slotIndex - (capacity(anchor) - 1) / 2) * spacing, 0, 0];
  const columns = Math.max(1, anchor.columns ?? 4);
  const rows = Math.ceil(capacity(anchor) / columns);
  return [((slotIndex % columns) - (columns - 1) / 2) * spacing, ((rows - 1) / 2 - Math.floor(slotIndex / columns)) * spacing, 0.07];
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

/** Assigns server anchor keys first, then deterministically fills compatible free slots. */
export function assignCommonsTracesToAnchors(traces: readonly CommonsTrace[], anchors: readonly CommonsTraceAnchor[]): CommonsTracePlacement[] {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const used = new Map<string, number>();
  const placements = new Map<string, CommonsTracePlacement>();
  const ordered = [...traces].sort((a, b) => a.id.localeCompare(b.id));
  const place = (trace: CommonsTrace, anchor: CommonsTraceAnchor) => {
    const slotIndex = used.get(anchor.id) ?? 0;
    if (!accepts(anchor, trace) || slotIndex >= capacity(anchor)) return false;
    placements.set(trace.id, { trace, anchor, slotIndex, localPosition: localPosition(anchor, slotIndex) });
    used.set(anchor.id, slotIndex + 1);
    return true;
  };

  ordered.forEach((trace) => {
    const exact = byId.get(trace.anchor_key);
    if (exact) place(trace, exact);
  });
  ordered.forEach((trace) => {
    if (placements.has(trace.id)) return;
    const candidates = anchors.filter((anchor) => accepts(anchor, trace) && (used.get(anchor.id) ?? 0) < capacity(anchor));
    if (!candidates.length) return;
    const start = hash(trace.id) % candidates.length;
    place(trace, candidates[start]);
  });
  return ordered.flatMap((trace) => placements.get(trace.id) ?? []);
}

function DefaultMarker({ trace }: { trace: CommonsTrace }) {
  if (trace.kind === "guestbook") {
    return (
      <group rotation={[0, 0, ((hash(trace.id) % 9) - 4) * 0.012]}>
        <mesh castShadow><boxGeometry args={[0.54, 0.38, 0.035]} /><meshStandardMaterial color={["#dfb56e", "#87a58e", "#c98370", "#7d99aa"][hash(trace.id) % 4]} roughness={0.88} /></mesh>
        <mesh position={[0, 0.14, 0.035]}><sphereGeometry args={[0.035, 10, 8]} /><meshStandardMaterial color="#e7d29b" /></mesh>
      </group>
    );
  }
  if (trace.object_kind === "flower") {
    return (
      <InteriorAsset
        url={`${NATURE}/flower_yellowA.glb`}
        position={[0, 0, 0]}
        rotation={[0, (hash(trace.id) % 8) * 0.2, 0]}
        scale={1.35}
      />
    );
  }
  if (trace.object_kind === "lantern") {
    return (
      <group>
        <InteriorAsset url={`${FURNITURE}/lampRoundTable.glb`} position={[0, 0, 0]} scale={0.82} />
        <pointLight position={[0, 0.45, 0]} color="#ffd58a" intensity={0.55} distance={1.4} decay={2} />
      </group>
    );
  }
  if (trace.object_kind === "book") {
    return (
      <InteriorAsset
        url={`${FURNITURE}/books.glb`}
        position={[0, 0, 0]}
        rotation={[0, (hash(trace.id) % 8) * 0.12, 0]}
        scale={0.88}
      />
    );
  }
  return (
    <InteriorAsset
      url={`${NATURE}/rock_smallFlatA.glb`}
      position={[0, 0, 0]}
      rotation={[0, (hash(trace.id) % 8) * 0.2, 0]}
      scale={1.1}
    />
  );
}

type CommonsTraceFieldProps = {
  traces: readonly CommonsTrace[];
  anchors: readonly CommonsTraceAnchor[];
  onTraceSelect?: (trace: CommonsTrace) => void;
  renderTrace?: (placement: CommonsTracePlacement) => ReactNode;
};

export function CommonsTraceField({ traces, anchors, onTraceSelect, renderTrace }: CommonsTraceFieldProps) {
  const placements = useMemo(() => assignCommonsTracesToAnchors(traces, anchors), [traces, anchors]);
  return (
    <group name="commons-trace-field">
      {placements.map((placement) => (
        <group
          key={placement.trace.id}
          name={`commons-trace-${placement.trace.id}`}
          position={[...placement.anchor.position]}
          rotation={placement.anchor.rotation ? [...placement.anchor.rotation] : undefined}
          scale={placement.anchor.scale ?? 1}
        >
          <group
            position={placement.localPosition}
            userData={{ commonsTraceId: placement.trace.id, commonsTraceKind: placement.trace.kind }}
            onClick={onTraceSelect ? (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onTraceSelect(placement.trace); } : undefined}
          >
            {renderTrace ? renderTrace(placement) : <DefaultMarker trace={placement.trace} />}
          </group>
        </group>
      ))}
    </group>
  );
}
