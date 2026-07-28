import {
  INTERIOR_ENTRANCE_WIDTH,
  INTERIOR_FURNITURE_COLLIDERS,
  INTERIOR_SIZE,
  INTERIOR_WALL_THICKNESS,
} from "@/constants/interiorLayout";

export const GUESTBOOK_FLOOR_SURFACE_ID = "floor.interior" as const;
export const GUESTBOOK_LETTER_SIZE = [2.4, 1.5] as const;
export const GUESTBOOK_FORWARD_OFFSET = 0.9;
export const GUESTBOOK_COLLISION_CLEARANCE = 0.08;

const FULL_TURN_DEG = 360;
const FULL_TURN_RAD = Math.PI * 2;
const GEOMETRY_EPSILON = 1e-9;
const ENTRY_CLEARANCE_DEPTH = 1.8;

export type GuestbookWorldPoint = {
  x: number;
  z: number;
};

export type GuestbookFloorUv = {
  u: number;
  v: number;
};

export type GuestbookPlayerPose = GuestbookWorldPoint & {
  /**
   * PlayerController convention: 0 faces +z, +PI / 2 faces +x.
   */
  yaw: number;
};

export type GuestbookAxisAlignedBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type GuestbookPlacementCandidateOptions = {
  /**
   * Rotates the letter in place without changing the point 0.9 m ahead of the
   * player. This is intended for repeated R-key rotation.
   */
  rotationOffsetDeg?: number;
};

export type GuestbookPlacementCandidate = {
  surfaceId: typeof GUESTBOOK_FLOOR_SURFACE_ID;
  x: number;
  z: number;
  /** Normalized player heading used to find the point in front. */
  playerYaw: number;
  /** Normalized world heading of the letter after an optional R-key offset. */
  yaw: number;
  rotationOffsetDeg: number;
  u: number;
  v: number;
  /**
   * Rotation for a plane nested below rotation={[-PI / 2, 0, 0]}. At the
   * default offset, the top of the rendered design points away from the
   * player, so it reads upright from the player's side.
   */
  rotationDeg: number;
  width: number;
  depth: number;
  corners: readonly GuestbookWorldPoint[];
};

export type GuestbookPlacementInvalidReason =
  | "invalid-pose"
  | "wall-collision"
  | "entrance-clearance"
  | "furniture-collision";

export type GuestbookPlacementValidation =
  | {
      valid: true;
      reason: null;
      blockerId: null;
    }
  | {
      valid: false;
      reason: GuestbookPlacementInvalidReason;
      blockerId: string | null;
    };

export const GUESTBOOK_FLOOR_WORLD_BOUNDS: GuestbookAxisAlignedBounds = {
  minX: -INTERIOR_SIZE[0] / 2,
  maxX: INTERIOR_SIZE[0] / 2,
  minZ: -INTERIOR_SIZE[1] / 2,
  maxZ: INTERIOR_SIZE[1] / 2,
};

/**
 * The inner faces of the outer shell. A letter and its safety margin must fit
 * wholly inside these bounds.
 */
export const GUESTBOOK_FLOOR_INNER_BOUNDS: GuestbookAxisAlignedBounds = {
  minX: GUESTBOOK_FLOOR_WORLD_BOUNDS.minX + INTERIOR_WALL_THICKNESS / 2,
  maxX: GUESTBOOK_FLOOR_WORLD_BOUNDS.maxX - INTERIOR_WALL_THICKNESS / 2,
  minZ: GUESTBOOK_FLOOR_WORLD_BOUNDS.minZ + INTERIOR_WALL_THICKNESS / 2,
  maxZ: GUESTBOOK_FLOOR_WORLD_BOUNDS.maxZ - INTERIOR_WALL_THICKNESS / 2,
};

/**
 * Keeps the entrance threshold and spawn route readable and unobstructed.
 * The protected strip is inside the room; the exterior porch is already
 * excluded by the inner floor bounds.
 */
export const GUESTBOOK_ENTRY_FORBIDDEN_BOUNDS: GuestbookAxisAlignedBounds = {
  minX: -INTERIOR_ENTRANCE_WIDTH / 2,
  maxX: INTERIOR_ENTRANCE_WIDTH / 2,
  minZ: INTERIOR_SIZE[1] / 2 - ENTRY_CLEARANCE_DEPTH,
  maxZ: INTERIOR_SIZE[1] / 2,
};

function normalizeDegrees(value: number) {
  if (!Number.isFinite(value)) return value;
  return ((value + 180) % FULL_TURN_DEG + FULL_TURN_DEG) % FULL_TURN_DEG - 180;
}

function normalizeRadians(value: number) {
  if (!Number.isFinite(value)) return value;
  return ((value + Math.PI) % FULL_TURN_RAD + FULL_TURN_RAD) % FULL_TURN_RAD - Math.PI;
}

/**
 * Converts world x/z to floor-plane UVs. The v axis is intentionally inverted:
 * the floor plane is rendered below rotation={[-PI / 2, 0, 0]}.
 */
export function floorInteriorWorldToUv(point: GuestbookWorldPoint): GuestbookFloorUv {
  return {
    u: (point.x - GUESTBOOK_FLOOR_WORLD_BOUNDS.minX) / INTERIOR_SIZE[0],
    v: (GUESTBOOK_FLOOR_WORLD_BOUNDS.maxZ - point.z) / INTERIOR_SIZE[1],
  };
}

/** Exact inverse of floorInteriorWorldToUv; values are not implicitly clamped. */
export function floorInteriorUvToWorld(uv: GuestbookFloorUv): GuestbookWorldPoint {
  return {
    x: GUESTBOOK_FLOOR_WORLD_BOUNDS.minX + uv.u * INTERIOR_SIZE[0],
    z: GUESTBOOK_FLOOR_WORLD_BOUNDS.maxZ - uv.v * INTERIOR_SIZE[1],
  };
}

/**
 * Converts a world heading to the local Z rotation used by the horizontal
 * floor plane. The extra half-turn makes the design upright from behind it.
 */
export function playerYawToGuestbookRotationDeg(yaw: number) {
  return normalizeDegrees(yaw * 180 / Math.PI + 180);
}

/** Circular inverse of playerYawToGuestbookRotationDeg. */
export function guestbookRotationDegToPlayerYaw(rotationDeg: number) {
  return normalizeRadians((rotationDeg - 180) * Math.PI / 180);
}

function letterAxes(yaw: number) {
  return {
    width: { x: Math.cos(yaw), z: -Math.sin(yaw) },
    depth: { x: Math.sin(yaw), z: Math.cos(yaw) },
  };
}

function letterCorners(
  center: GuestbookWorldPoint,
  yaw: number,
  width: number,
  depth: number,
): readonly GuestbookWorldPoint[] {
  const axes = letterAxes(yaw);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return ([-1, 1] as const).flatMap((widthSign) =>
    ([-1, 1] as const).map((depthSign) => ({
      x: center.x
        + axes.width.x * halfWidth * widthSign
        + axes.depth.x * halfDepth * depthSign,
      z: center.z
        + axes.width.z * halfWidth * widthSign
        + axes.depth.z * halfDepth * depthSign,
    })),
  );
}

export function createGuestbookPlacementCandidate(
  pose: GuestbookPlayerPose,
  options: GuestbookPlacementCandidateOptions = {},
): GuestbookPlacementCandidate {
  const playerYaw = normalizeRadians(pose.yaw);
  const rotationOffsetDeg = normalizeDegrees(options.rotationOffsetDeg ?? 0);
  const yaw = normalizeRadians(playerYaw + rotationOffsetDeg * Math.PI / 180);
  const center = {
    x: pose.x + Math.sin(playerYaw) * GUESTBOOK_FORWARD_OFFSET,
    z: pose.z + Math.cos(playerYaw) * GUESTBOOK_FORWARD_OFFSET,
  };
  const [width, depth] = GUESTBOOK_LETTER_SIZE;
  const uv = floorInteriorWorldToUv(center);

  return {
    surfaceId: GUESTBOOK_FLOOR_SURFACE_ID,
    ...center,
    playerYaw,
    yaw,
    rotationOffsetDeg,
    ...uv,
    rotationDeg: playerYawToGuestbookRotationDeg(yaw),
    width,
    depth,
    corners: letterCorners(center, yaw, width, depth),
  };
}

function expandedBounds(bounds: GuestbookAxisAlignedBounds, amount: number): GuestbookAxisAlignedBounds {
  return {
    minX: bounds.minX - amount,
    maxX: bounds.maxX + amount,
    minZ: bounds.minZ - amount,
    maxZ: bounds.maxZ + amount,
  };
}

function candidateIntersectsBounds(
  candidate: GuestbookPlacementCandidate,
  bounds: GuestbookAxisAlignedBounds,
  clearance: number,
) {
  const expanded = expandedBounds(bounds, clearance);
  const axes = letterAxes(candidate.yaw);
  const halfWidth = candidate.width / 2;
  const halfDepth = candidate.depth / 2;
  const boundsCenter = {
    x: (expanded.minX + expanded.maxX) / 2,
    z: (expanded.minZ + expanded.maxZ) / 2,
  };
  const boundsHalf = {
    x: (expanded.maxX - expanded.minX) / 2,
    z: (expanded.maxZ - expanded.minZ) / 2,
  };
  const delta = {
    x: candidate.x - boundsCenter.x,
    z: candidate.z - boundsCenter.z,
  };
  const separatingAxes = [
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    axes.width,
    axes.depth,
  ];

  return !separatingAxes.some((axis) => {
    const centerDistance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    const letterRadius = halfWidth * Math.abs(axes.width.x * axis.x + axes.width.z * axis.z)
      + halfDepth * Math.abs(axes.depth.x * axis.x + axes.depth.z * axis.z);
    const boundsRadius = boundsHalf.x * Math.abs(axis.x) + boundsHalf.z * Math.abs(axis.z);
    return centerDistance > letterRadius + boundsRadius + GEOMETRY_EPSILON;
  });
}

function invalidCandidate(candidate: GuestbookPlacementCandidate) {
  return ![
    candidate.x,
    candidate.z,
    candidate.playerYaw,
    candidate.yaw,
    candidate.rotationOffsetDeg,
    candidate.u,
    candidate.v,
    candidate.rotationDeg,
    candidate.width,
    candidate.depth,
    ...candidate.corners.flatMap((corner) => [corner.x, corner.z]),
  ].every(Number.isFinite) || candidate.width <= 0 || candidate.depth <= 0;
}

function wallBlocker(candidate: GuestbookPlacementCandidate): string | null {
  const bounds = GUESTBOOK_FLOOR_INNER_BOUNDS;
  const clearance = GUESTBOOK_COLLISION_CLEARANCE;
  for (const corner of candidate.corners) {
    if (corner.x < bounds.minX + clearance - GEOMETRY_EPSILON) return "outer-west";
    if (corner.x > bounds.maxX - clearance + GEOMETRY_EPSILON) return "outer-east";
    if (corner.z < bounds.minZ + clearance - GEOMETRY_EPSILON) return "outer-north";
    if (corner.z > bounds.maxZ - clearance + GEOMETRY_EPSILON) return "outer-south-boundary";
  }
  return null;
}

export function validateGuestbookPlacement(
  candidate: GuestbookPlacementCandidate,
): GuestbookPlacementValidation {
  if (invalidCandidate(candidate)) {
    return { valid: false, reason: "invalid-pose", blockerId: null };
  }

  const wall = wallBlocker(candidate);
  if (wall) {
    return { valid: false, reason: "wall-collision", blockerId: wall };
  }

  if (candidateIntersectsBounds(
    candidate,
    GUESTBOOK_ENTRY_FORBIDDEN_BOUNDS,
    GUESTBOOK_COLLISION_CLEARANCE,
  )) {
    return { valid: false, reason: "entrance-clearance", blockerId: "interior-entry-clearance" };
  }

  for (const collider of INTERIOR_FURNITURE_COLLIDERS) {
    const [x, , z] = collider.position;
    const [halfX, , halfZ] = collider.halfExtents;
    if (candidateIntersectsBounds(candidate, {
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
    }, GUESTBOOK_COLLISION_CLEARANCE)) {
      return { valid: false, reason: "furniture-collision", blockerId: collider.id };
    }
  }

  return { valid: true, reason: null, blockerId: null };
}

export function evaluateGuestbookPlacement(
  pose: GuestbookPlayerPose,
  options: GuestbookPlacementCandidateOptions = {},
) {
  const candidate = createGuestbookPlacementCandidate(pose, options);
  return {
    candidate,
    validation: validateGuestbookPlacement(candidate),
  } as const;
}
