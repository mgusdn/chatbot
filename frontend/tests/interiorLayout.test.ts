import { describe, expect, it } from "vitest";
import {
  COMMONS_INTERACTION_ANCHORS,
  COMMONS_TRACE_ANCHORS,
  INTERIOR_ENTRANCE_WIDTH,
  INTERIOR_ENTRY_PORCH,
  INTERIOR_EXIT_GUARD,
  INTERIOR_FURNITURE_COLLIDERS,
  INTERIOR_FURNITURE_LAYOUT,
  INTERIOR_HALF_DEPTH,
  INTERIOR_HALF_WIDTH,
  INTERIOR_MAIN_PATH_HALF_WIDTH,
  INTERIOR_MIN_PATH_WIDTH,
  INTERIOR_PLAN_SCALE,
  INTERIOR_SIZE,
  INTERIOR_WALL_APPROACH_DEPTH,
  INTERIOR_WALL_NORMAL_SHIFT,
  INTERIOR_WALLS,
  INTERIOR_ZONES,
  REQUIRED_INTERIOR_ZONE_IDS,
} from "@/constants/interiorLayout";
import { WORLD_CONFIG } from "@/constants/worldConfig";

const horizontalWallIntervalsAt = (z: number) => INTERIOR_WALLS
  .filter((wall) => wall.size[0] > wall.size[2] && Math.abs(wall.position[2] - z) < 0.01)
  .map((wall) => [wall.position[0] - wall.size[0] / 2, wall.position[0] + wall.size[0] / 2] as const)
  .sort((a, b) => a[0] - b[0]);

const openingAroundCenter = (z: number) => {
  const intervals = horizontalWallIntervalsAt(z);
  const left = intervals.filter((interval) => interval[1] <= 0).at(-1);
  const right = intervals.find((interval) => interval[0] >= 0);
  if (!left || !right) return 0;
  return right[0] - left[1];
};

const horizontalBounds = (collider: (typeof INTERIOR_FURNITURE_COLLIDERS)[number]) => ({
  minX: collider.position[0] - collider.halfExtents[0],
  maxX: collider.position[0] + collider.halfExtents[0],
  minZ: collider.position[2] - collider.halfExtents[2],
  maxZ: collider.position[2] + collider.halfExtents[2],
});

const colliderById = (id: string) => {
  const collider = INTERIOR_FURNITURE_COLLIDERS.find((item) => item.id === id);
  if (!collider) throw new Error(`Missing interior collider: ${id}`);
  return collider;
};

describe("open-plan mind research commons layout", () => {
  it("contains every planned open zone exactly once", () => {
    const ids = INTERIOR_ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([...REQUIRED_INTERIOR_ZONE_IDS]));
  });

  it("uses only outer shell walls and has no internal room dividers", () => {
    expect(INTERIOR_WALLS).toHaveLength(5);
    INTERIOR_WALLS.forEach((wall) => expect(wall.id).toMatch(/^outer-/));
    expect(INTERIOR_SIZE).toEqual([21.6, 18]);
    expect(INTERIOR_WALLS.find((wall) => wall.id === "outer-north")?.position[2])
      .toBe(-INTERIOR_HALF_DEPTH);
    expect(INTERIOR_WALLS.find((wall) => wall.id === "outer-west")?.position[0])
      .toBe(-INTERIOR_HALF_WIDTH);
    expect(INTERIOR_WALLS.find((wall) => wall.id === "outer-east")?.position[0])
      .toBe(INTERIOR_HALF_WIDTH);
  });

  it("keeps a 3.6 m or wider entrance", () => {
    expect(INTERIOR_ENTRANCE_WIDTH).toBeGreaterThanOrEqual(3.6);
    expect(openingAroundCenter(INTERIOR_HALF_DEPTH))
      .toBeGreaterThanOrEqual(INTERIOR_ENTRANCE_WIDTH - 0.001);
  });

  it("expands every visual floor zone with the room plan", () => {
    const guestbook = INTERIOR_ZONES.find((zone) => zone.id === "guestbook-commons");
    const pbao = INTERIOR_ZONES.find((zone) => zone.id === "pbao-research-bay");

    expect(guestbook?.center).toEqual([-6.42, 5.88]);
    expect(guestbook?.size).toEqual([8.16, 5.76]);
    expect(pbao?.center).toEqual([0, -6.24]);
    expect(pbao?.size).toEqual([10.56, 4.92]);
  });

  it("keeps spawn, exit, Pbao, and public interaction anchors in bounds", () => {
    const halfWidth = INTERIOR_SIZE[0] / 2;
    const halfDepth = INTERIOR_SIZE[1] / 2;
    const points = [
      WORLD_CONFIG.interiorSpawn,
      WORLD_CONFIG.interiorExit,
      WORLD_CONFIG.pbaoInteraction,
      COMMONS_INTERACTION_ANCHORS.guestbook,
      COMMONS_INTERACTION_ANCHORS.installation,
    ];
    for (const point of points) {
      expect(Math.abs(point[0])).toBeLessThan(halfWidth);
      expect(Math.abs(point[2])).toBeLessThanOrEqual(halfDepth);
    }
  });

  it("exports the backend trace keys and keeps all installation slots in the east grid", () => {
    const todayWall = COMMONS_TRACE_ANCHORS.find((anchor) => anchor.id === "today-wall");
    const installations = COMMONS_TRACE_ANCHORS.filter((anchor) => anchor.kind === "installation-slot");
    expect(todayWall?.position[2]).toBeLessThan(-7.2);
    expect(installations).toHaveLength(16);
    expect(installations.map((anchor) => anchor.id)).toEqual(
      Array.from({ length: 16 }, (_, index) => `installation-${String(index + 1).padStart(2, "0")}`),
    );
    installations.forEach((anchor) => {
      expect(anchor.position[0]).toBeGreaterThanOrEqual(3);
      expect(anchor.position[0]).toBeLessThanOrEqual(7.2);
      expect(anchor.position[2]).toBeGreaterThanOrEqual(0.8);
      expect(anchor.position[2]).toBeLessThanOrEqual(3.8);
    });
  });

  it("keeps the 4.08 m center boulevard clear through the Pbao interaction point", () => {
    expect(INTERIOR_MAIN_PATH_HALF_WIDTH * 2).toBeCloseTo(4.08);
    const routeStart = WORLD_CONFIG.interiorSpawn[2];
    const routeEnd = WORLD_CONFIG.pbaoInteraction[2];
    const blockers = INTERIOR_FURNITURE_COLLIDERS.filter((collider) => {
      const minX = collider.position[0] - collider.halfExtents[0];
      const maxX = collider.position[0] + collider.halfExtents[0];
      const minZ = collider.position[2] - collider.halfExtents[2];
      const maxZ = collider.position[2] + collider.halfExtents[2];
      const crossesBoulevard = minX < INTERIOR_MAIN_PATH_HALF_WIDTH && maxX > -INTERIOR_MAIN_PATH_HALF_WIDTH;
      const crossesRoute = maxZ >= routeEnd && minZ <= routeStart;
      return crossesBoulevard && crossesRoute;
    });
    expect(blockers).toEqual([]);
  });

  it("extends the entry floor and guards its outer edge", () => {
    const porchEdge = INTERIOR_ENTRY_PORCH.position[2] + INTERIOR_ENTRY_PORCH.halfExtents[2];
    expect(INTERIOR_ENTRY_PORCH.position[2] - INTERIOR_ENTRY_PORCH.halfExtents[2]).toBeLessThanOrEqual(INTERIOR_SIZE[1] / 2);
    expect(INTERIOR_EXIT_GUARD.position[2] - INTERIOR_EXIT_GUARD.halfExtents[2]).toBeLessThan(porchEdge);
    expect(INTERIOR_EXIT_GUARD.position[2] + INTERIOR_EXIT_GUARD.halfExtents[2]).toBeGreaterThan(porchEdge);
  });

  it("keeps interaction anchors on their furniture islands and intentional fixtures on the north wall", () => {
    expect(COMMONS_INTERACTION_ANCHORS.installation).toEqual([6.6, 0, 3.1]);
    expect(COMMONS_INTERACTION_ANCHORS.guestbook).toEqual([-5.6, 0, 6.5]);

    const westShelf = colliderById("guestbook-low-shelf");
    const northArchive = colliderById("archive-bookcase");
    expect(westShelf.position).toEqual([-8.15, 0.62, 5]);
    expect(northArchive.position).toEqual([
      -6.7,
      1.05,
      -7.02 + INTERIOR_WALL_NORMAL_SHIFT.north,
    ]);
  });

  it("derives every furniture collider from the same position used by the renderer", () => {
    const placements = Object.values(INTERIOR_FURNITURE_LAYOUT);
    expect(INTERIOR_FURNITURE_COLLIDERS.map((collider) => collider.id))
      .toEqual(placements.map((placement) => placement.id));

    placements.forEach((placement) => {
      const collider = colliderById(placement.id);
      expect(collider.position).toEqual([
        placement.position[0],
        placement.halfExtents[1],
        placement.position[2],
      ]);
      expect(collider.halfExtents).toEqual(placement.halfExtents);
    });
  });

  it("keeps a 2.25 m walking and letter-preview band clear along usable walls", () => {
    const westInnerEdge = -INTERIOR_HALF_WIDTH + INTERIOR_WALL_APPROACH_DEPTH;
    const eastInnerEdge = INTERIOR_HALF_WIDTH - INTERIOR_WALL_APPROACH_DEPTH;
    const northInnerEdge = -INTERIOR_HALF_DEPTH + INTERIOR_WALL_APPROACH_DEPTH;

    INTERIOR_FURNITURE_COLLIDERS.forEach((collider) => {
      const bounds = horizontalBounds(collider);
      expect(bounds.minX, `${collider.id} enters the west wall approach`).toBeGreaterThanOrEqual(westInnerEdge - 0.001);
      expect(bounds.maxX, `${collider.id} enters the east wall approach`).toBeLessThanOrEqual(eastInnerEdge + 0.001);
      if (collider.id !== "archive-bookcase") {
        expect(bounds.minZ, `${collider.id} enters the north wall approach`).toBeGreaterThanOrEqual(northInnerEdge - 0.001);
      }
    });
  });

  it("preserves at least 1.4 m routes between the main furniture islands", () => {
    const coworkTable = horizontalBounds(colliderById("cowork-table"));
    const coworkSofa = horizontalBounds(colliderById("cowork-sofa"));
    const libraryShelf = horizontalBounds(colliderById("library-bookcase-west"));
    const libraryTable = horizontalBounds(colliderById("library-worktable"));
    const recoveryTable = horizontalBounds(colliderById("recovery-project-table"));
    const recoveryBench = horizontalBounds(colliderById("recovery-bench"));

    expect(coworkTable.minX - INTERIOR_MAIN_PATH_HALF_WIDTH).toBeGreaterThanOrEqual(INTERIOR_MIN_PATH_WIDTH);
    expect(coworkSofa.minX - coworkTable.maxX).toBeGreaterThanOrEqual(INTERIOR_MIN_PATH_WIDTH);
    expect(libraryTable.minX - libraryShelf.maxX).toBeGreaterThanOrEqual(INTERIOR_MIN_PATH_WIDTH);
    expect(recoveryBench.minX - recoveryTable.maxX).toBeGreaterThanOrEqual(INTERIOR_MIN_PATH_WIDTH);
  });

  it("leaves collision-free standing pockets at public interactions", () => {
    const characterRadius = 0.35;
    const pockets = [
      { id: "guestbook", point: [-5.6, 6.5] as const, anchor: COMMONS_INTERACTION_ANCHORS.guestbook },
      { id: "installation", point: [6.6, 3.1] as const, anchor: COMMONS_INTERACTION_ANCHORS.installation },
      { id: "pbao", point: [0, -3.85] as const, anchor: WORLD_CONFIG.pbaoInteraction },
    ];

    pockets.forEach(({ id, point, anchor }) => {
      const distance = Math.hypot(point[0] - anchor[0], point[1] - anchor[2]);
      expect(distance, `${id} pocket is outside interaction range`).toBeLessThanOrEqual(WORLD_CONFIG.interactionRadius);
      const blocker = INTERIOR_FURNITURE_COLLIDERS.find((collider) => {
        const bounds = horizontalBounds(collider);
        return point[0] >= bounds.minX - characterRadius
          && point[0] <= bounds.maxX + characterRadius
          && point[1] >= bounds.minZ - characterRadius
          && point[1] <= bounds.maxZ + characterRadius;
      });
      expect(blocker?.id, `${id} pocket is blocked`).toBeUndefined();
    });
  });

  it("uses stable unique collider and trace identifiers", () => {
    const colliderIds = [
      ...INTERIOR_WALLS.map((wall) => wall.id),
      ...INTERIOR_FURNITURE_COLLIDERS.map((collider) => collider.id),
      INTERIOR_ENTRY_PORCH.id,
      INTERIOR_EXIT_GUARD.id,
    ];
    expect(new Set(colliderIds).size).toBe(colliderIds.length);
    const traceIds = COMMONS_TRACE_ANCHORS.map((anchor) => anchor.id);
    expect(new Set(traceIds).size).toBe(traceIds.length);
  });
});
