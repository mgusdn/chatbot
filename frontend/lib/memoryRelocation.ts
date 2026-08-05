import {
  MEMORY_RELOCATION_WALLS,
  MEMORY_SURFACE_REGISTRY,
  MEMORY_WALL_FIXTURES,
  getMemorySurface,
  type MemoryRelocationSurfaceId,
  type MemoryRelocationSurfaceKind,
  type MemorySurfaceDefinition,
  type MemoryVector3,
} from "@/constants/memorySurfaces";
import {
  INTERIOR_FURNITURE_COLLIDERS,
  INTERIOR_WALL_HEIGHT,
  INTERIOR_WALL_THICKNESS,
} from "@/constants/interiorLayout";
import {
  GUESTBOOK_COLLISION_CLEARANCE,
  GUESTBOOK_ENTRY_FORBIDDEN_BOUNDS,
  GUESTBOOK_FORWARD_OFFSET,
  GUESTBOOK_LETTER_SIZE,
  playerYawToGuestbookRotationDeg,
  type GuestbookAxisAlignedBounds,
} from "@/lib/guestbook/guestbookPlacement";
import type {
  MemoryKind,
  MemoryPlacementInput,
  MemorySurfaceId,
  RoomMemory,
} from "@/types/memoryRoom";

export const MEMORY_RELOCATION_WALL_ENTER_DISTANCE = 2;
export const MEMORY_RELOCATION_WALL_EXIT_DISTANCE = 2.25;
export const MEMORY_RELOCATION_WALL_ENTER_FACING = Math.cos(70 * Math.PI / 180);
export const MEMORY_RELOCATION_WALL_EXIT_FACING = Math.cos(75 * Math.PI / 180);
/**
 * At the widest accepted angle the wall-plane intersection is much farther
 * away than the perpendicular player-to-wall distance.
 */
export const MEMORY_RELOCATION_WALL_RAY_DISTANCE =
  MEMORY_RELOCATION_WALL_EXIT_DISTANCE / MEMORY_RELOCATION_WALL_EXIT_FACING;
export const MEMORY_RELOCATION_SURFACE_OFFSET = 0.012;
export const MEMORY_RELOCATION_EDGE_CLEARANCE = GUESTBOOK_COLLISION_CLEARANCE;
/** Keep full-size letters readable above low shelves while staying on the wall. */
export const MEMORY_RELOCATION_WALL_CENTER_Y =
  INTERIOR_WALL_HEIGHT - MEMORY_RELOCATION_EDGE_CLEARANCE - GUESTBOOK_LETTER_SIZE[1] / 2;
const MEMORY_RELOCATION_WALL_FIXTURE_CLEARANCE = 0.015;

const GEOMETRY_EPSILON = 1e-9;
const WALL_TIE_BREAK_DISTANCE = 0.06;

export const MEMORY_RELOCATION_KIND_SIZE: Record<MemoryKind, readonly [number, number]> = {
  note: [0.34, 0.25],
  mood: [0.3, 0.3],
  story: [0.44, 0.31],
};

export type MemoryRelocationPlayerPose = {
  x: number;
  z: number;
  /**
   * PlayerController convention: zero faces +Z and +PI / 2 faces +X.
   */
  yaw: number;
};

export type MemoryRelocationUv = {
  u: number;
  v: number;
};

export type MemorySurfaceCoordinates = MemoryRelocationUv & {
  localU: number;
  localV: number;
  normalDistance: number;
};

export type MemoryRelocationSnap = {
  surfaceId: MemoryRelocationSurfaceId;
  kind: MemoryRelocationSurfaceKind;
  point: MemoryVector3;
  distance: number;
};

export type MemoryRelocationCandidate = {
  surfaceId: MemoryRelocationSurfaceId;
  kind: MemoryRelocationSurfaceKind;
  placement: MemoryPlacementInput & { surface_id: MemoryRelocationSurfaceId };
  position: MemoryVector3;
  localCenter: readonly [number, number];
  localCorners: readonly (readonly [number, number])[];
  worldCorners: readonly MemoryVector3[];
  /** Base plane dimensions after applying placement.scale. */
  width: number;
  height: number;
  snapDistance: number;
  clamped: boolean;
};

export type MemoryRelocationInvalidReason =
  | "invalid-candidate"
  | "unsupported-surface"
  | "surface-too-small"
  | "surface-bounds"
  | "entrance-clearance"
  | "furniture-collision"
  | "wall-fixture-collision";

export type MemoryRelocationValidation =
  | { valid: true; reason: null; blockerId: null }
  | {
      valid: false;
      reason: MemoryRelocationInvalidReason;
      blockerId: string | null;
    };

export type MemoryRelocationEvaluation = {
  candidate: MemoryRelocationCandidate;
  validation: MemoryRelocationValidation;
};

export type EvaluateMemoryRelocationOptions = {
  baseSize?: readonly [number, number];
  scale?: number;
  zIndex?: number;
  previousSurfaceId?: MemoryRelocationSurfaceId | null;
  /** Applied only while the candidate is on the floor; wall letters stay level. */
  rotationOffsetDeg?: number;
  /** Guestbook letters may overlap furniture on the floor; entrance clearance still applies. */
  ignoreFurnitureCollision?: boolean;
};

type OrientedRect = {
  centerA: number;
  centerB: number;
  widthAxis: readonly [number, number];
  heightAxis: readonly [number, number];
  halfWidth: number;
  halfHeight: number;
};

function dot3(left: MemoryVector3, right: MemoryVector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function subtract3(left: MemoryVector3, right: MemoryVector3): MemoryVector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function addScaled3(
  origin: MemoryVector3,
  axis: MemoryVector3,
  amount: number,
): MemoryVector3 {
  return [
    origin[0] + axis[0] * amount,
    origin[1] + axis[1] * amount,
    origin[2] + axis[2] * amount,
  ];
}

function surfaceFromRuntimeId(surfaceId: string): MemorySurfaceDefinition | null {
  return (MEMORY_SURFACE_REGISTRY as Record<string, MemorySurfaceDefinition>)[surfaceId] || null;
}

export function memorySurfaceUvToWorld(
  surfaceId: MemorySurfaceId,
  uv: MemoryRelocationUv,
  normalOffset = 0,
): MemoryVector3 {
  const surface = getMemorySurface(surfaceId);
  const localU = (uv.u - 0.5) * surface.size[0];
  const localV = (uv.v - 0.5) * surface.size[1];
  let point = addScaled3(surface.position, surface.uAxis, localU);
  point = addScaled3(point, surface.vAxis, localV);
  return addScaled3(point, surface.normal, normalOffset);
}

export function memorySurfaceWorldToCoordinates(
  surfaceId: MemorySurfaceId,
  point: MemoryVector3,
): MemorySurfaceCoordinates {
  const surface = getMemorySurface(surfaceId);
  const delta = subtract3(point, surface.position);
  const localU = dot3(delta, surface.uAxis);
  const localV = dot3(delta, surface.vAxis);
  return {
    localU,
    localV,
    normalDistance: dot3(delta, surface.normal),
    u: localU / surface.size[0] + 0.5,
    v: localV / surface.size[1] + 0.5,
  };
}

export function getMemoryRelocationBaseSize(
  memory: Pick<RoomMemory, "kind" | "design">,
): readonly [number, number] {
  return memory.design ? GUESTBOOK_LETTER_SIZE : MEMORY_RELOCATION_KIND_SIZE[memory.kind];
}

function rotatedLocalCorners(
  centerU: number,
  centerV: number,
  width: number,
  height: number,
  rotationDeg: number,
) {
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return ([-1, 1] as const).flatMap((widthSign) =>
    ([-1, 1] as const).map((heightSign) => {
      const widthOffset = widthSign * halfWidth;
      const heightOffset = heightSign * halfHeight;
      return [
        centerU + cos * widthOffset - sin * heightOffset,
        centerV + sin * widthOffset + cos * heightOffset,
      ] as const;
    }),
  );
}

function localPointToWorld(
  surface: MemorySurfaceDefinition,
  localU: number,
  localV: number,
  normalOffset: number,
) {
  let point = addScaled3(surface.position, surface.uAxis, localU);
  point = addScaled3(point, surface.vAxis, localV);
  return addScaled3(point, surface.normal, normalOffset);
}

function projectedHalfExtents(width: number, height: number, rotationDeg: number) {
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    u: cos * width / 2 + sin * height / 2,
    v: sin * width / 2 + cos * height / 2,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampWallCenter(
  surface: MemorySurfaceDefinition,
  desiredU: number,
  desiredV: number,
  width: number,
  height: number,
  rotationDeg: number,
) {
  const extent = projectedHalfExtents(width, height, rotationDeg);
  const maxU = surface.size[0] / 2 - MEMORY_RELOCATION_EDGE_CLEARANCE - extent.u;
  const maxV = surface.size[1] / 2 - MEMORY_RELOCATION_EDGE_CLEARANCE - extent.v;
  if (maxU < 0 || maxV < 0) {
    return { localU: desiredU, localV: desiredV, clamped: false };
  }
  const localU = clamp(desiredU, -maxU, maxU);
  const localV = clamp(desiredV, -maxV, maxV);
  return {
    localU,
    localV,
    clamped: Math.abs(localU - desiredU) > GEOMETRY_EPSILON
      || Math.abs(localV - desiredV) > GEOMETRY_EPSILON,
  };
}

function isFinitePose(pose: MemoryRelocationPlayerPose) {
  return [pose.x, pose.z, pose.yaw].every(Number.isFinite);
}

type WallRayHit = {
  surfaceId: MemoryRelocationSurfaceId;
  point: MemoryVector3;
  distance: number;
};

function nearestWallHit(
  pose: MemoryRelocationPlayerPose,
  previousSurfaceId?: MemoryRelocationSurfaceId | null,
): WallRayHit | null {
  if (!isFinitePose(pose)) return null;
  const forward: MemoryVector3 = [Math.sin(pose.yaw), 0, Math.cos(pose.yaw)];
  const player: MemoryVector3 = [pose.x, MEMORY_RELOCATION_WALL_CENTER_Y, pose.z];
  let best: WallRayHit | null = null;

  for (const wall of MEMORY_RELOCATION_WALLS) {
    const delta = subtract3(player, wall.position);
    const planeDistance = dot3(delta, wall.normal);
    const towardWall = -dot3(forward, wall.normal);
    const wasSelected = previousSurfaceId === wall.id;
    const distanceLimit = wasSelected
      ? MEMORY_RELOCATION_WALL_EXIT_DISTANCE
      : MEMORY_RELOCATION_WALL_ENTER_DISTANCE;
    const facingLimit = wasSelected
      ? MEMORY_RELOCATION_WALL_EXIT_FACING
      : MEMORY_RELOCATION_WALL_ENTER_FACING;
    if (
      planeDistance < -GEOMETRY_EPSILON
      || planeDistance > distanceLimit + GEOMETRY_EPSILON
      || towardWall < facingLimit
    ) continue;

    const rayDistance = planeDistance / towardWall;
    if (
      rayDistance < -GEOMETRY_EPSILON
      || rayDistance > MEMORY_RELOCATION_WALL_RAY_DISTANCE
    ) continue;

    const point: MemoryVector3 = [
      player[0] + forward[0] * rayDistance,
      MEMORY_RELOCATION_WALL_CENTER_Y,
      player[2] + forward[2] * rayDistance,
    ];
    const local = memorySurfaceWorldToCoordinates(wall.id, point);
    if (Math.abs(local.localU) > wall.size[0] / 2 + 0.5) continue;

    const hit: WallRayHit = { surfaceId: wall.id, point, distance: rayDistance };
    if (!best || hit.distance < best.distance - WALL_TIE_BREAK_DISTANCE) {
      best = hit;
    } else if (
      Math.abs(hit.distance - best.distance) <= WALL_TIE_BREAK_DISTANCE
      && hit.surfaceId === previousSurfaceId
    ) {
      best = hit;
    }
  }

  return best;
}

export function resolveMemoryRelocationSnap(
  pose: MemoryRelocationPlayerPose,
  previousSurfaceId?: MemoryRelocationSurfaceId | null,
): MemoryRelocationSnap {
  const wall = nearestWallHit(pose, previousSurfaceId);
  if (wall) return { ...wall, kind: "wall" };

  const point: MemoryVector3 = [
    pose.x + Math.sin(pose.yaw) * GUESTBOOK_FORWARD_OFFSET,
    MEMORY_SURFACE_REGISTRY["floor.interior"].position[1],
    pose.z + Math.cos(pose.yaw) * GUESTBOOK_FORWARD_OFFSET,
  ];
  return {
    surfaceId: "floor.interior",
    kind: "floor",
    point,
    distance: GUESTBOOK_FORWARD_OFFSET,
  };
}

export function createMemoryRelocationCandidateForPlacement(
  placement: MemoryPlacementInput & { surface_id: MemoryRelocationSurfaceId },
  baseSize: readonly [number, number] = GUESTBOOK_LETTER_SIZE,
  options: { snapDistance?: number; clamped?: boolean } = {},
): MemoryRelocationCandidate {
  const surface = getMemorySurface(placement.surface_id);
  const kind = surface.relocationKind;
  const width = baseSize[0] * placement.scale;
  const height = baseSize[1] * placement.scale;
  const localU = (placement.u - 0.5) * surface.size[0];
  const localV = (placement.v - 0.5) * surface.size[1];
  const localCorners = rotatedLocalCorners(
    localU,
    localV,
    width,
    height,
    placement.rotation_deg,
  );
  const normalOffset = MEMORY_RELOCATION_SURFACE_OFFSET + placement.z_index * 0.00001;

  return {
    surfaceId: placement.surface_id,
    kind: kind || (placement.surface_id === "floor.interior" ? "floor" : "wall"),
    placement: { ...placement },
    position: memorySurfaceUvToWorld(placement.surface_id, placement, normalOffset),
    localCenter: [localU, localV],
    localCorners,
    worldCorners: localCorners.map(([u, v]) =>
      localPointToWorld(surface, u, v, normalOffset)),
    width,
    height,
    snapDistance: options.snapDistance ?? 0,
    clamped: options.clamped ?? false,
  };
}

function createCandidateFromSnap(
  pose: MemoryRelocationPlayerPose,
  snap: MemoryRelocationSnap,
  options: EvaluateMemoryRelocationOptions,
) {
  const surface = getMemorySurface(snap.surfaceId);
  const scale = options.scale ?? 1;
  const baseSize = options.baseSize ?? GUESTBOOK_LETTER_SIZE;
  const width = baseSize[0] * scale;
  const height = baseSize[1] * scale;
  const floorYaw = pose.yaw + (options.rotationOffsetDeg ?? 0) * Math.PI / 180;
  const rotationDeg = snap.kind === "wall"
    ? 0
    : playerYawToGuestbookRotationDeg(floorYaw);
  const desired = memorySurfaceWorldToCoordinates(snap.surfaceId, snap.point);
  const bounded = snap.kind === "wall"
    ? clampWallCenter(
        surface,
        desired.localU,
        desired.localV,
        width,
        height,
        rotationDeg,
      )
    : { localU: desired.localU, localV: desired.localV, clamped: false };
  const placement = {
    surface_id: snap.surfaceId,
    u: bounded.localU / surface.size[0] + 0.5,
    v: bounded.localV / surface.size[1] + 0.5,
    rotation_deg: rotationDeg,
    scale,
    z_index: options.zIndex ?? 0,
  } satisfies MemoryPlacementInput & { surface_id: MemoryRelocationSurfaceId };
  return createMemoryRelocationCandidateForPlacement(placement, baseSize, {
    snapDistance: snap.distance,
    clamped: bounded.clamped,
  });
}

function candidateHasFiniteGeometry(candidate: MemoryRelocationCandidate) {
  return [
    candidate.placement.u,
    candidate.placement.v,
    candidate.placement.rotation_deg,
    candidate.placement.scale,
    candidate.placement.z_index,
    ...candidate.position,
    ...candidate.localCenter,
    ...candidate.localCorners.flat(),
    ...candidate.worldCorners.flat(),
    candidate.width,
    candidate.height,
    candidate.snapDistance,
  ].every(Number.isFinite)
    && candidate.width > 0
    && candidate.height > 0
    && candidate.placement.scale >= 0.75
    && candidate.placement.scale <= 1.35
    && Number.isInteger(candidate.placement.z_index)
    && candidate.placement.z_index >= 0
    && candidate.placement.z_index <= 1000;
}

function localBoundsBlocker(
  candidate: MemoryRelocationCandidate,
  surface: MemorySurfaceDefinition,
) {
  const margin = candidate.kind === "floor"
    ? INTERIOR_WALL_THICKNESS / 2 + MEMORY_RELOCATION_EDGE_CLEARANCE
    : MEMORY_RELOCATION_EDGE_CLEARANCE;
  const extent = projectedHalfExtents(
    candidate.width,
    candidate.height,
    candidate.placement.rotation_deg,
  );
  const availableU = surface.size[0] / 2 - margin;
  const availableV = surface.size[1] / 2 - margin;
  if (extent.u > availableU + GEOMETRY_EPSILON || extent.v > availableV + GEOMETRY_EPSILON) {
    return { reason: "surface-too-small" as const, blockerId: surface.id };
  }
  for (const [u, v] of candidate.localCorners) {
    if (u < -availableU - GEOMETRY_EPSILON) {
      return { reason: "surface-bounds" as const, blockerId: `${surface.id}:u-min` };
    }
    if (u > availableU + GEOMETRY_EPSILON) {
      return { reason: "surface-bounds" as const, blockerId: `${surface.id}:u-max` };
    }
    if (v < -availableV - GEOMETRY_EPSILON) {
      return { reason: "surface-bounds" as const, blockerId: `${surface.id}:v-min` };
    }
    if (v > availableV + GEOMETRY_EPSILON) {
      return { reason: "surface-bounds" as const, blockerId: `${surface.id}:v-max` };
    }
  }
  return null;
}

function expandedBounds(bounds: GuestbookAxisAlignedBounds, amount: number) {
  return {
    minX: bounds.minX - amount,
    maxX: bounds.maxX + amount,
    minZ: bounds.minZ - amount,
    maxZ: bounds.maxZ + amount,
  };
}

function orientedRectIntersectsBounds(
  rect: OrientedRect,
  rawBounds: GuestbookAxisAlignedBounds,
  clearance: number,
) {
  const bounds = expandedBounds(rawBounds, clearance);
  const center = {
    a: (bounds.minX + bounds.maxX) / 2,
    b: (bounds.minZ + bounds.maxZ) / 2,
  };
  const half = {
    a: (bounds.maxX - bounds.minX) / 2,
    b: (bounds.maxZ - bounds.minZ) / 2,
  };
  const delta = {
    a: rect.centerA - center.a,
    b: rect.centerB - center.b,
  };
  const axes = [
    [1, 0],
    [0, 1],
    rect.widthAxis,
    rect.heightAxis,
  ] as const;

  return !axes.some(([axisA, axisB]) => {
    const centerDistance = Math.abs(delta.a * axisA + delta.b * axisB);
    const rectRadius = rect.halfWidth
        * Math.abs(rect.widthAxis[0] * axisA + rect.widthAxis[1] * axisB)
      + rect.halfHeight
        * Math.abs(rect.heightAxis[0] * axisA + rect.heightAxis[1] * axisB);
    const boundsRadius = half.a * Math.abs(axisA) + half.b * Math.abs(axisB);
    return centerDistance > rectRadius + boundsRadius + GEOMETRY_EPSILON;
  });
}

function candidateWorldRect(candidate: MemoryRelocationCandidate): OrientedRect {
  const surface = getMemorySurface(candidate.surfaceId);
  const radians = candidate.placement.rotation_deg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    centerA: candidate.position[0],
    centerB: candidate.position[2],
    widthAxis: [
      surface.uAxis[0] * cos + surface.vAxis[0] * sin,
      surface.uAxis[2] * cos + surface.vAxis[2] * sin,
    ],
    heightAxis: [
      -surface.uAxis[0] * sin + surface.vAxis[0] * cos,
      -surface.uAxis[2] * sin + surface.vAxis[2] * cos,
    ],
    halfWidth: candidate.width / 2,
    halfHeight: candidate.height / 2,
  };
}

function candidateLocalRect(candidate: MemoryRelocationCandidate): OrientedRect {
  const radians = candidate.placement.rotation_deg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    centerA: candidate.localCenter[0],
    centerB: candidate.localCenter[1],
    widthAxis: [cos, sin],
    heightAxis: [-sin, cos],
    halfWidth: candidate.width / 2,
    halfHeight: candidate.height / 2,
  };
}

function floorCollision(
  candidate: MemoryRelocationCandidate,
  options: { ignoreFurnitureCollision?: boolean } = {},
): MemoryRelocationValidation | null {
  const rect = candidateWorldRect(candidate);
  if (orientedRectIntersectsBounds(
    rect,
    GUESTBOOK_ENTRY_FORBIDDEN_BOUNDS,
    MEMORY_RELOCATION_EDGE_CLEARANCE,
  )) {
    return {
      valid: false,
      reason: "entrance-clearance",
      blockerId: "interior-entry-clearance",
    };
  }
  if (options.ignoreFurnitureCollision) return null;

  for (const collider of INTERIOR_FURNITURE_COLLIDERS) {
    const [x, , z] = collider.position;
    const [halfX, , halfZ] = collider.halfExtents;
    if (orientedRectIntersectsBounds(rect, {
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
    }, MEMORY_RELOCATION_EDGE_CLEARANCE)) {
      return {
        valid: false,
        reason: "furniture-collision",
        blockerId: collider.id,
      };
    }
  }
  return null;
}

function wallFixtureCollision(candidate: MemoryRelocationCandidate): MemoryRelocationValidation | null {
  const rect = candidateLocalRect(candidate);
  for (const fixture of MEMORY_WALL_FIXTURES) {
    if (fixture.surfaceId !== candidate.surfaceId) continue;
    if (orientedRectIntersectsBounds(rect, {
      minX: fixture.minU,
      maxX: fixture.maxU,
      minZ: fixture.minV,
      maxZ: fixture.maxV,
    }, MEMORY_RELOCATION_WALL_FIXTURE_CLEARANCE)) {
      return {
        valid: false,
        reason: "wall-fixture-collision",
        blockerId: fixture.id,
      };
    }
  }
  return null;
}

export function validateMemoryRelocationCandidate(
  candidate: MemoryRelocationCandidate,
  options: { ignoreFurnitureCollision?: boolean } = {},
): MemoryRelocationValidation {
  if (!candidateHasFiniteGeometry(candidate)) {
    return { valid: false, reason: "invalid-candidate", blockerId: null };
  }
  const surface = surfaceFromRuntimeId(candidate.surfaceId);
  if (!surface?.relocationKind || surface.relocationKind !== candidate.kind) {
    return {
      valid: false,
      reason: "unsupported-surface",
      blockerId: candidate.surfaceId,
    };
  }
  const bounds = localBoundsBlocker(candidate, surface);
  if (bounds) return { valid: false, ...bounds };
  const collision = candidate.kind === "floor"
    ? floorCollision(candidate, options)
    : wallFixtureCollision(candidate);
  return collision || { valid: true, reason: null, blockerId: null };
}

export function evaluateMemoryRelocation(
  pose: MemoryRelocationPlayerPose,
  options: EvaluateMemoryRelocationOptions = {},
): MemoryRelocationEvaluation {
  const snap = resolveMemoryRelocationSnap(pose, options.previousSurfaceId);
  const candidate = createCandidateFromSnap(pose, snap, options);
  return {
    candidate,
    validation: validateMemoryRelocationCandidate(candidate, {
      ignoreFurnitureCollision: options.ignoreFurnitureCollision,
    }),
  };
}
