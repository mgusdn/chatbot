export type PlanarPoint = readonly [x: number, z: number];

/**
 * The foam line is the authoritative edge of the playable island.
 *
 * Keep this polygon convex: the static floor collider uses a cheap triangle fan,
 * while the very same points drive the wet-sand silhouette, foam, coast camera,
 * and boundary guards. That prevents visuals and physics drifting apart.
 */
export const PLAYABLE_COASTLINE = [
  [0, -15],
  [6.6, -14.3],
  [11.9, -11.1],
  [14.6, -5.1],
  [14.7, 2.2],
  [12.2, 8.8],
  [7.1, 13.2],
  [0.7, 15],
  [-6.2, 13.9],
  [-11.6, 10],
  [-14.5, 3.7],
  [-14.4, -3.7],
  [-11.7, -10.1],
  [-6.2, -14.1],
] as const satisfies readonly PlanarPoint[];

export const COAST_LAYER_CONFIG = {
  grass: { scale: 0.86, y: -0.018, color: "#91aa72" },
  drySand: { scale: 0.945, y: -0.023, color: "#d9c790" },
  wetSand: { scale: 1, y: -0.028, color: "#bca77c" },
  shallowWater: { scale: 1.075, y: -0.055, color: "#83bbc0" },
  deepOcean: { radius: 72, y: -0.24, color: "#5f99aa" },
  foam: { innerScale: 0.996, outerScale: 1.012, y: -0.011 },
} as const;

export const COAST_PHYSICS_CONFIG = {
  floorY: -0.016,
  guardDepth: 0.34,
  guardHeight: 2.2,
  guardOverlap: 0.05,
  softZone: 1.05,
} as const;

export const COAST_CAMERA_CONFIG = {
  revealDistance: 3.4,
  cameraShift: 1.1,
  targetShift: 0.72,
} as const;

/** Runtime budgets for the exterior slice. GameCanvas may consume these later. */
export const EXTERIOR_PERFORMANCE_BUDGETS = {
  mobile: {
    targetFps: 30,
    maxDpr: 1,
    shadowMapSize: 1024,
    maxVisibleTriangles: 150_000,
    maxDrawCalls: 100,
  },
  desktop: {
    targetFps: 60,
    maxDpr: 1.5,
    shadowMapSize: 1024,
    maxVisibleTriangles: 250_000,
    maxDrawCalls: 150,
  },
} as const;

export function scaleOutline(
  outline: readonly PlanarPoint[],
  scale: number,
): PlanarPoint[] {
  return outline.map(([x, z]) => [x * scale, z * scale]);
}

export function polygonSignedArea(outline: readonly PlanarPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const [x1, z1] = outline[index];
    const [x2, z2] = outline[(index + 1) % outline.length];
    twiceArea += x1 * z2 - x2 * z1;
  }
  return twiceArea / 2;
}

export function isPointInsideOutline(
  [x, z]: PlanarPoint,
  outline: readonly PlanarPoint[] = PLAYABLE_COASTLINE,
): boolean {
  let inside = false;
  for (let current = 0, previous = outline.length - 1; current < outline.length; previous = current, current += 1) {
    const [currentX, currentZ] = outline[current];
    const [previousX, previousZ] = outline[previous];
    const crossesRay = (currentZ > z) !== (previousZ > z)
      && x < ((previousX - currentX) * (z - currentZ)) / (previousZ - currentZ) + currentX;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

export type CoastBoundarySegment = {
  start: PlanarPoint;
  end: PlanarPoint;
  center: readonly [x: number, y: number, z: number];
  halfExtents: readonly [x: number, y: number, z: number];
  rotationY: number;
  outwardNormal: PlanarPoint;
};

export function createCoastBoundarySegments(
  outline: readonly PlanarPoint[] = PLAYABLE_COASTLINE,
): CoastBoundarySegment[] {
  const counterClockwise = polygonSignedArea(outline) > 0;
  const { guardDepth, guardHeight, guardOverlap } = COAST_PHYSICS_CONFIG;

  return outline.map((start, index) => {
    const end = outline[(index + 1) % outline.length];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    const outwardNormal: PlanarPoint = counterClockwise
      ? [dz / length, -dx / length]
      : [-dz / length, dx / length];
    const middleX = (start[0] + end[0]) / 2;
    const middleZ = (start[1] + end[1]) / 2;

    return {
      start,
      end,
      center: [
        middleX + outwardNormal[0] * guardDepth / 2,
        guardHeight / 2 - 0.08,
        middleZ + outwardNormal[1] * guardDepth / 2,
      ],
      halfExtents: [length / 2 + guardOverlap, guardHeight / 2, guardDepth / 2],
      rotationY: -Math.atan2(dz, dx),
      outwardNormal,
    };
  });
}

export const COAST_BOUNDARY_SEGMENTS = createCoastBoundarySegments();

export type CoastFloorMesh = {
  vertices: Float32Array;
  indices: Uint32Array;
};

export function createCoastFloorMesh(
  outline: readonly PlanarPoint[] = PLAYABLE_COASTLINE,
  y = COAST_PHYSICS_CONFIG.floorY,
): CoastFloorMesh {
  const vertices = new Float32Array((outline.length + 1) * 3);
  vertices.set([0, y, 0], 0);
  outline.forEach(([x, z], index) => {
    vertices.set([x, y, z], (index + 1) * 3);
  });

  const indices = new Uint32Array(outline.length * 3);
  for (let index = 0; index < outline.length; index += 1) {
    const current = index + 1;
    const next = ((index + 1) % outline.length) + 1;
    // Reversed from the XZ signed-area winding so the triangles face +Y.
    indices.set([0, next, current], index * 3);
  }
  return { vertices, indices };
}

export const COAST_FLOOR_MESH = createCoastFloorMesh();

export type CoastSample = {
  inside: boolean;
  signedDistance: number;
  nearestPoint: PlanarPoint;
  outwardNormal: PlanarPoint;
  segmentIndex: number;
};

export function sampleCoastline(
  point: PlanarPoint,
  outline: readonly PlanarPoint[] = PLAYABLE_COASTLINE,
): CoastSample {
  const counterClockwise = polygonSignedArea(outline) > 0;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  let nearestPoint: PlanarPoint = outline[0];
  let outwardNormal: PlanarPoint = [0, 1];
  let segmentIndex = 0;

  outline.forEach((start, index) => {
    const end = outline[(index + 1) % outline.length];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const lengthSquared = dx * dx + dz * dz;
    const projection = Math.max(0, Math.min(1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared,
    ));
    const projected: PlanarPoint = [start[0] + dx * projection, start[1] + dz * projection];
    const distanceSquared = (point[0] - projected[0]) ** 2 + (point[1] - projected[1]) ** 2;
    if (distanceSquared >= nearestDistanceSquared) return;

    const length = Math.sqrt(lengthSquared);
    nearestDistanceSquared = distanceSquared;
    nearestPoint = projected;
    outwardNormal = counterClockwise
      ? [dz / length, -dx / length]
      : [-dz / length, dx / length];
    segmentIndex = index;
  });

  const distance = Math.sqrt(nearestDistanceSquared);
  const inside = distance < 1e-6 || isPointInsideOutline(point, outline);
  return {
    inside,
    signedDistance: inside ? distance : -distance,
    nearestPoint,
    outwardNormal,
    segmentIndex,
  };
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
};

/**
 * Removes only the outward component of velocity as the avatar enters the foam.
 * Tangential movement remains responsive and the physical guard is still the
 * final safety net for very large frame steps.
 */
export function softenVelocityAtCoast(
  position: PlanarPoint,
  velocity: PlanarPoint,
): PlanarPoint {
  const sample = sampleCoastline(position);
  if (sample.signedDistance >= COAST_PHYSICS_CONFIG.softZone) return velocity;

  const outwardSpeed = velocity[0] * sample.outwardNormal[0] + velocity[1] * sample.outwardNormal[1];
  if (outwardSpeed <= 0) return velocity;

  const allowedOutwardFraction = smoothstep(
    0,
    COAST_PHYSICS_CONFIG.softZone,
    Math.max(0, sample.signedDistance),
  );
  const removedSpeed = outwardSpeed * (1 - allowedOutwardFraction);
  return [
    velocity[0] - sample.outwardNormal[0] * removedSpeed,
    velocity[1] - sample.outwardNormal[1] * removedSpeed,
  ];
}

export type CoastCameraReveal = {
  factor: number;
  cameraShift: PlanarPoint;
  targetShift: PlanarPoint;
};

/** A subtle coast-facing composition shift; movement stays on world axes. */
export function getCoastCameraReveal(position: PlanarPoint): CoastCameraReveal {
  const sample = sampleCoastline(position);
  const normalized = 1 - Math.max(0, Math.min(1,
    Math.max(0, sample.signedDistance) / COAST_CAMERA_CONFIG.revealDistance,
  ));
  const factor = smoothstep(0, 1, normalized);
  return {
    factor,
    cameraShift: [
      -sample.outwardNormal[0] * COAST_CAMERA_CONFIG.cameraShift * factor,
      -sample.outwardNormal[1] * COAST_CAMERA_CONFIG.cameraShift * factor,
    ],
    targetShift: [
      sample.outwardNormal[0] * COAST_CAMERA_CONFIG.targetShift * factor,
      sample.outwardNormal[1] * COAST_CAMERA_CONFIG.targetShift * factor,
    ],
  };
}
