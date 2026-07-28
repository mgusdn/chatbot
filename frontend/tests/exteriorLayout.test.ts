import { describe, expect, it } from "vitest";
import { COMMONS_PAVILION_CONFIG } from "@/components/game/CommonsPavilion";
import {
  COAST_BOUNDARY_SEGMENTS,
  COAST_FLOOR_MESH,
  COAST_LAYER_CONFIG,
  COAST_PHYSICS_CONFIG,
  EXTERIOR_PERFORMANCE_BUDGETS,
  PLAYABLE_COASTLINE,
  getCoastCameraReveal,
  isPointInsideOutline,
  polygonSignedArea,
  sampleCoastline,
  scaleOutline,
  softenVelocityAtCoast,
} from "@/components/game/exterior/exteriorLayout";
import { WORLD_CONFIG } from "@/constants/worldConfig";

describe("coastal exterior layout", () => {
  it("uses one stable, counter-clockwise convex coastline", () => {
    expect(PLAYABLE_COASTLINE.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PLAYABLE_COASTLINE.map(([x, z]) => `${x}:${z}`)).size).toBe(PLAYABLE_COASTLINE.length);
    expect(polygonSignedArea(PLAYABLE_COASTLINE)).toBeGreaterThan(0);

    const crossProducts = PLAYABLE_COASTLINE.map((point, index) => {
      const next = PLAYABLE_COASTLINE[(index + 1) % PLAYABLE_COASTLINE.length];
      const after = PLAYABLE_COASTLINE[(index + 2) % PLAYABLE_COASTLINE.length];
      return (next[0] - point[0]) * (after[1] - next[1])
        - (next[1] - point[1]) * (after[0] - next[0]);
    });
    crossProducts.forEach((cross) => expect(cross).toBeGreaterThan(0));
  });

  it("orders opaque terrain layers from grass to deep ocean", () => {
    expect(COAST_LAYER_CONFIG.grass.scale).toBeLessThan(COAST_LAYER_CONFIG.drySand.scale);
    expect(COAST_LAYER_CONFIG.drySand.scale).toBeLessThan(COAST_LAYER_CONFIG.wetSand.scale);
    expect(COAST_LAYER_CONFIG.wetSand.scale).toBeLessThan(COAST_LAYER_CONFIG.shallowWater.scale);
    expect(COAST_LAYER_CONFIG.foam.innerScale).toBeLessThanOrEqual(COAST_LAYER_CONFIG.wetSand.scale);
    expect(COAST_LAYER_CONFIG.foam.outerScale).toBeGreaterThan(COAST_LAYER_CONFIG.wetSand.scale);
  });

  it("keeps the spawn and full pavilion footprint on grass", () => {
    const grass = scaleOutline(PLAYABLE_COASTLINE, COAST_LAYER_CONFIG.grass.scale);
    expect(isPointInsideOutline([WORLD_CONFIG.exteriorSpawn[0], WORLD_CONFIG.exteriorSpawn[2]], grass)).toBe(true);
    const [centerX, , centerZ] = COMMONS_PAVILION_CONFIG.collider.position;
    const [halfX, , halfZ] = COMMONS_PAVILION_CONFIG.collider.halfExtents;
    const footprint = [
      [centerX - halfX, centerZ - halfZ],
      [centerX + halfX, centerZ - halfZ],
      [centerX - halfX, centerZ + halfZ],
      [centerX + halfX, centerZ + halfZ],
    ] as const;
    footprint.forEach((point) => expect(isPointInsideOutline(point, grass)).toBe(true));
  });

  it("triangulates the playable coastline without adding a second outline", () => {
    expect(COAST_FLOOR_MESH.vertices).toHaveLength((PLAYABLE_COASTLINE.length + 1) * 3);
    expect(COAST_FLOOR_MESH.indices).toHaveLength(PLAYABLE_COASTLINE.length * 3);
    PLAYABLE_COASTLINE.forEach(([x, z], index) => {
      expect(COAST_FLOOR_MESH.vertices[(index + 1) * 3]).toBeCloseTo(x);
      expect(COAST_FLOOR_MESH.vertices[(index + 1) * 3 + 1]).toBeCloseTo(COAST_PHYSICS_CONFIG.floorY);
      expect(COAST_FLOOR_MESH.vertices[(index + 1) * 3 + 2]).toBeCloseTo(z);
    });
  });

  it("places every physical guard immediately outside the visible foam line", () => {
    expect(COAST_BOUNDARY_SEGMENTS).toHaveLength(PLAYABLE_COASTLINE.length);
    COAST_BOUNDARY_SEGMENTS.forEach((segment, index) => {
      expect(segment.start).toEqual(PLAYABLE_COASTLINE[index]);
      expect(segment.end).toEqual(PLAYABLE_COASTLINE[(index + 1) % PLAYABLE_COASTLINE.length]);
      const midpoint = [
        (segment.start[0] + segment.end[0]) / 2,
        (segment.start[1] + segment.end[1]) / 2,
      ];
      const colliderInnerFace = [
        segment.center[0] - segment.outwardNormal[0] * COAST_PHYSICS_CONFIG.guardDepth / 2,
        segment.center[2] - segment.outwardNormal[1] * COAST_PHYSICS_CONFIG.guardDepth / 2,
      ];
      expect(colliderInnerFace[0]).toBeCloseTo(midpoint[0]);
      expect(colliderInnerFace[1]).toBeCloseTo(midpoint[1]);
    });
  });

  it("softens only outward motion near the coast", () => {
    const nearNorthCoast = [0, -14.8] as const;
    const sample = sampleCoastline(nearNorthCoast);
    expect(sample.inside).toBe(true);
    expect(sample.signedDistance).toBeLessThan(COAST_PHYSICS_CONFIG.softZone);

    const outward = softenVelocityAtCoast(nearNorthCoast, [0, -4]);
    const inward = softenVelocityAtCoast(nearNorthCoast, [0, 4]);
    const tangent = softenVelocityAtCoast(nearNorthCoast, [4, 0]);
    expect(Math.abs(outward[1])).toBeLessThan(4);
    expect(inward).toEqual([0, 4]);
    expect(tangent[0]).toBeCloseTo(4, 1);
  });

  it("reveals the distant water only as the player approaches a coast", () => {
    const centerReveal = getCoastCameraReveal([0, 0]);
    const coastReveal = getCoastCameraReveal([0, -14.8]);
    expect(centerReveal.factor).toBe(0);
    expect(coastReveal.factor).toBeGreaterThan(0.9);
    expect(coastReveal.targetShift[1]).toBeLessThan(0);
    expect(coastReveal.cameraShift[1]).toBeGreaterThan(0);
  });

  it("publishes conservative mobile and desktop render budgets", () => {
    expect(EXTERIOR_PERFORMANCE_BUDGETS.mobile.shadowMapSize).toBeLessThanOrEqual(1024);
    expect(EXTERIOR_PERFORMANCE_BUDGETS.mobile.maxDrawCalls).toBeLessThanOrEqual(100);
    expect(EXTERIOR_PERFORMANCE_BUDGETS.mobile.maxVisibleTriangles).toBeLessThanOrEqual(150_000);
    expect(EXTERIOR_PERFORMANCE_BUDGETS.desktop.maxDpr).toBeLessThanOrEqual(1.5);
  });
});
