import { describe, expect, it } from "vitest";
import {
  COMMONS_INTERACTION_ANCHORS,
  COMMONS_TRACE_ANCHORS,
  INTERIOR_ENTRANCE_WIDTH,
  INTERIOR_ENTRY_PORCH,
  INTERIOR_EXIT_GUARD,
  INTERIOR_FURNITURE_COLLIDERS,
  INTERIOR_HALF_DEPTH,
  INTERIOR_HALF_WIDTH,
  INTERIOR_MAIN_PATH_HALF_WIDTH,
  INTERIOR_PLAN_SCALE,
  INTERIOR_SIZE,
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

describe("open-plan mind research commons layout", () => {
  it("contains every planned open zone exactly once", () => {
    const ids = INTERIOR_ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([...REQUIRED_INTERIOR_ZONE_IDS]));
  });

  it("uses only outer shell walls and has no internal room dividers", () => {
    expect(INTERIOR_WALLS).toHaveLength(5);
    INTERIOR_WALLS.forEach((wall) => expect(wall.id).toMatch(/^outer-/));
    expect(INTERIOR_SIZE).toEqual([19.8, 16.5]);
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

    expect(guestbook?.center).toEqual([-5.35 * INTERIOR_PLAN_SCALE, 4.9 * INTERIOR_PLAN_SCALE]);
    expect(guestbook?.size).toEqual([6.8 * INTERIOR_PLAN_SCALE, 4.8 * INTERIOR_PLAN_SCALE]);
    expect(pbao?.center).toEqual([0, -5.2 * INTERIOR_PLAN_SCALE]);
    expect(pbao?.size).toEqual([8.8 * INTERIOR_PLAN_SCALE, 4.1 * INTERIOR_PLAN_SCALE]);
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

  it("keeps the 3.4 m center boulevard clear through the Pbao interaction point", () => {
    expect(INTERIOR_MAIN_PATH_HALF_WIDTH * 2).toBeGreaterThanOrEqual(3.2);
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

  it("moves wall-mounted collider and interaction geometry only along wall normals", () => {
    expect(COMMONS_INTERACTION_ANCHORS.installation).toEqual([
      8.15 + INTERIOR_WALL_NORMAL_SHIFT.east,
      0,
      3.15,
    ]);
    expect(COMMONS_INTERACTION_ANCHORS.guestbook).toEqual([-5.25, 0, 5.25]);

    const westShelf = INTERIOR_FURNITURE_COLLIDERS.find((item) => item.id === "guestbook-low-shelf");
    const northArchive = INTERIOR_FURNITURE_COLLIDERS.find((item) => item.id === "archive-bookcase");
    expect(westShelf?.position).toEqual([
      -8.45 + INTERIOR_WALL_NORMAL_SHIFT.west,
      0.62,
      4.65,
    ]);
    expect(northArchive?.position).toEqual([
      -6.7,
      1.05,
      -7.02 + INTERIOR_WALL_NORMAL_SHIFT.north,
    ]);
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
