import { describe, expect, it } from "vitest";
import {
  MEMORY_RELOCATION_SURFACE_IDS,
  MEMORY_SURFACE_REGISTRY,
} from "@/constants/memorySurfaces";
import {
  INTERIOR_HALF_DEPTH,
  INTERIOR_HALF_WIDTH,
  INTERIOR_SIZE,
  INTERIOR_WALL_THICKNESS,
} from "@/constants/interiorLayout";
import {
  MEMORY_RELOCATION_WALL_ENTER_DISTANCE,
  MEMORY_RELOCATION_WALL_ENTER_FACING,
  MEMORY_RELOCATION_WALL_EXIT_DISTANCE,
  MEMORY_RELOCATION_WALL_EXIT_FACING,
  createMemoryRelocationCandidateForPlacement,
  evaluateMemoryRelocation,
  getMemoryRelocationBaseSize,
  memorySurfaceUvToWorld,
  memorySurfaceWorldToCoordinates,
  resolveMemoryRelocationSnap,
  validateMemoryRelocationCandidate,
} from "@/lib/memoryRelocation";
import { GUESTBOOK_LETTER_SIZE } from "@/lib/guestbook/guestbookPlacement";
import { ALL_MEMORY_SURFACE_IDS, type RoomMemory } from "@/types/memoryRoom";

const WALL_APPROACH_DISTANCE = 1.175;
const WALL_HYSTERESIS_DISTANCE = 2.1;
const NORTH_APPROACH_Z =
  MEMORY_SURFACE_REGISTRY["wall.interior.north"].position[2] + WALL_APPROACH_DISTANCE;
const NORTH_HYSTERESIS_Z =
  MEMORY_SURFACE_REGISTRY["wall.interior.north"].position[2] + WALL_HYSTERESIS_DISTANCE;
const WEST_APPROACH_X =
  MEMORY_SURFACE_REGISTRY["wall.interior.west"].position[0] + WALL_APPROACH_DISTANCE;
const EAST_APPROACH_X =
  MEMORY_SURFACE_REGISTRY["wall.interior.east"].position[0] - WALL_APPROACH_DISTANCE;

describe("memory surface registry", () => {
  it("preserves legacy board geometry while keeping the west board on the expanded wall", () => {
    expect(MEMORY_SURFACE_REGISTRY["wall.north"]).toMatchObject({
      position: [-7.5, 1.12, 7.23],
      size: [1.05, 1.25],
      relocationKind: null,
    });
    expect(MEMORY_SURFACE_REGISTRY["wall.west"]).toMatchObject({
      position: [
        -INTERIOR_HALF_WIDTH + INTERIOR_WALL_THICKNESS / 2 + 0.015,
        1.35,
        4.9,
      ],
      size: [3.5, 2.15],
      relocationKind: null,
    });
    expect(MEMORY_SURFACE_REGISTRY["floor.interior"].size).toBe(INTERIOR_SIZE);
    expect(MEMORY_SURFACE_REGISTRY["wall.interior.north"]).toMatchObject({
      position: [
        0,
        1.425,
        -INTERIOR_HALF_DEPTH + INTERIOR_WALL_THICKNESS / 2 + 0.015,
      ],
      size: [INTERIOR_SIZE[0] - 0.6, 2.85],
    });
    expect(MEMORY_SURFACE_REGISTRY["wall.interior.west"]).toMatchObject({
      position: [
        -INTERIOR_HALF_WIDTH + INTERIOR_WALL_THICKNESS / 2 + 0.015,
        1.425,
        0,
      ],
      size: [INTERIOR_SIZE[1] - 0.6, 2.85],
    });
    expect(MEMORY_SURFACE_REGISTRY["wall.interior.east"]).toMatchObject({
      position: [
        INTERIOR_HALF_WIDTH - INTERIOR_WALL_THICKNESS / 2 - 0.015,
        1.425,
        0,
      ],
      size: [INTERIOR_SIZE[1] - 0.6, 2.85],
    });
    expect(MEMORY_RELOCATION_SURFACE_IDS).toEqual([
      "floor.interior",
      "wall.interior.north",
      "wall.interior.west",
      "wall.interior.east",
    ]);
    expect(ALL_MEMORY_SURFACE_IDS).toEqual(expect.arrayContaining([
      "wall.north",
      "wall.west",
      "wall.interior.north",
      "wall.interior.west",
      "wall.interior.east",
    ]));
  });

  it("round-trips UVs through each relocation surface without hiding normal offset", () => {
    for (const surfaceId of MEMORY_RELOCATION_SURFACE_IDS) {
      const point = memorySurfaceUvToWorld(surfaceId, { u: 0.23, v: 0.78 }, 0.017);
      const restored = memorySurfaceWorldToCoordinates(surfaceId, point);
      expect(restored.u).toBeCloseTo(0.23, 10);
      expect(restored.v).toBeCloseTo(0.78, 10);
      expect(restored.normalDistance).toBeCloseTo(0.017, 10);
    }
  });

  it("projects floor and wall candidate corners through each surface axis exactly once", () => {
    for (const surfaceId of MEMORY_RELOCATION_SURFACE_IDS) {
      const candidate = createMemoryRelocationCandidateForPlacement(
        {
          surface_id: surfaceId,
          u: 0.31,
          v: 0.68,
          rotation_deg: 27,
          scale: 0.9,
          z_index: 3,
        },
        [0.8, 0.6],
      );

      candidate.worldCorners.forEach((worldCorner, index) => {
        const restored = memorySurfaceWorldToCoordinates(surfaceId, worldCorner);
        const [expectedU, expectedV] = candidate.localCorners[index];

        expect(restored.localU).toBeCloseTo(expectedU, 10);
        expect(restored.localV).toBeCloseTo(expectedV, 10);
        expect(restored.normalDistance).toBeCloseTo(0.01203, 10);
      });
    }
  });

  it("uses opposite tangent signs on west and east walls", () => {
    const westStart = memorySurfaceUvToWorld("wall.interior.west", { u: 0, v: 0.5 });
    const westEnd = memorySurfaceUvToWorld("wall.interior.west", { u: 1, v: 0.5 });
    const eastStart = memorySurfaceUvToWorld("wall.interior.east", { u: 0, v: 0.5 });
    const eastEnd = memorySurfaceUvToWorld("wall.interior.east", { u: 1, v: 0.5 });

    expect(westStart[2]).toBeGreaterThan(westEnd[2]);
    expect(eastStart[2]).toBeLessThan(eastEnd[2]);
  });
});

describe("carried memory snap selection", () => {
  it("uses a 2.4 by 1.5 player-facing floor candidate in open space", () => {
    expect(GUESTBOOK_LETTER_SIZE).toEqual([2.4, 1.5]);
    const result = evaluateMemoryRelocation({ x: 0, z: 0, yaw: 0 });

    expect(result.candidate).toMatchObject({
      surfaceId: "floor.interior",
      kind: "floor",
      width: 2.4,
      height: 1.5,
      placement: {
        surface_id: "floor.interior",
        rotation_deg: -180,
        scale: 1,
      },
    });
    expect(result.candidate.position[0]).toBeCloseTo(0);
    expect(result.candidate.position[2]).toBeCloseTo(0.9);
    expect(result.validation.valid).toBe(true);
  });

  it("snaps to a faced wall, but falls back to floor when facing away", () => {
    const towardNorth = resolveMemoryRelocationSnap({ x: 4.6, z: NORTH_APPROACH_Z, yaw: Math.PI });
    const awayFromNorth = resolveMemoryRelocationSnap({ x: 4.6, z: NORTH_APPROACH_Z, yaw: 0 });
    const towardEast = resolveMemoryRelocationSnap({ x: EAST_APPROACH_X, z: 1.3, yaw: Math.PI / 2 });

    expect(towardNorth.surfaceId).toBe("wall.interior.north");
    expect(towardNorth.kind).toBe("wall");
    expect(awayFromNorth.surfaceId).toBe("floor.interior");
    expect(towardEast.surfaceId).toBe("wall.interior.east");
  });

  it("retains an already selected wall across the exit hysteresis band", () => {
    const pose = { x: 4.6, z: NORTH_HYSTERESIS_Z, yaw: Math.PI };
    expect(resolveMemoryRelocationSnap(pose).surfaceId).toBe("floor.interior");
    expect(resolveMemoryRelocationSnap(pose, "wall.interior.north").surfaceId)
      .toBe("wall.interior.north");
  });

  it("enters walls from two meters and keeps them through the wider exit band", () => {
    expect(MEMORY_RELOCATION_WALL_ENTER_DISTANCE).toBe(2);
    expect(MEMORY_RELOCATION_WALL_EXIT_DISTANCE).toBe(2.25);
    expect(MEMORY_RELOCATION_WALL_ENTER_FACING).toBeCloseTo(Math.cos(70 * Math.PI / 180));
    expect(MEMORY_RELOCATION_WALL_EXIT_FACING).toBeCloseTo(Math.cos(75 * Math.PI / 180));

    const wallZ = MEMORY_SURFACE_REGISTRY["wall.interior.north"].position[2];
    expect(resolveMemoryRelocationSnap({ x: 4.6, z: wallZ + 1.99, yaw: Math.PI }).surfaceId)
      .toBe("wall.interior.north");
    expect(resolveMemoryRelocationSnap({ x: 4.6, z: wallZ + 2.01, yaw: Math.PI }).surfaceId)
      .toBe("floor.interior");
    expect(resolveMemoryRelocationSnap(
      { x: 4.6, z: wallZ + 2.24, yaw: Math.PI },
      "wall.interior.north",
    ).surfaceId).toBe("wall.interior.north");
    expect(resolveMemoryRelocationSnap(
      { x: 4.6, z: wallZ + 2.26, yaw: Math.PI },
      "wall.interior.north",
    ).surfaceId).toBe("floor.interior");
  });

  it("accepts a roughly seventy-degree approach without snapping to a distant wall", () => {
    const wallZ = MEMORY_SURFACE_REGISTRY["wall.interior.north"].position[2];
    const distance = 1.8;
    const poseAtAngle = (angleDeg: number) => {
      const angle = angleDeg * Math.PI / 180;
      return {
        x: 4.6 - distance * Math.tan(angle),
        z: wallZ + distance,
        yaw: Math.PI - angle,
      };
    };

    expect(resolveMemoryRelocationSnap(poseAtAngle(69)).surfaceId)
      .toBe("wall.interior.north");
    expect(resolveMemoryRelocationSnap(poseAtAngle(71)).surfaceId)
      .toBe("floor.interior");
  });

  it("applies voucher rotation offsets on the floor while keeping wall letters level", () => {
    const base = evaluateMemoryRelocation({ x: 0, z: 0, yaw: 0 });
    const rotated = evaluateMemoryRelocation(
      { x: 0, z: 0, yaw: 0 },
      { rotationOffsetDeg: 45 },
    );
    expect(rotated.candidate.position).toEqual(base.candidate.position);
    expect(rotated.candidate.placement.rotation_deg).toBe(-135);

    const wall = evaluateMemoryRelocation(
      { x: 4.6, z: NORTH_APPROACH_Z, yaw: Math.PI },
      { rotationOffsetDeg: 45 },
    );
    expect(wall.candidate.surfaceId).toBe("wall.interior.north");
    expect(wall.candidate.placement.rotation_deg).toBe(0);
  });

  it("clamps a wall ghost wholly inside the readable wall edge", () => {
    const result = evaluateMemoryRelocation({ x: 10.2, z: NORTH_APPROACH_Z, yaw: Math.PI });

    expect(result.candidate.surfaceId).toBe("wall.interior.north");
    expect(result.candidate.clamped).toBe(true);
    expect(result.validation.valid).toBe(true);
    expect(Math.max(...result.candidate.localCorners.map(([u]) => u)))
      .toBeLessThanOrEqual(MEMORY_SURFACE_REGISTRY["wall.interior.north"].size[0] / 2 - 0.08 + 1e-9);
  });
});

describe("relocation candidate validation", () => {
  it("rejects wall fixtures and accepts an open part of the same wall", () => {
    const blocked = evaluateMemoryRelocation({ x: 0, z: NORTH_APPROACH_Z, yaw: Math.PI });
    const open = evaluateMemoryRelocation({ x: 4.6, z: NORTH_APPROACH_Z, yaw: Math.PI });

    expect(blocked.validation).toEqual({
      valid: false,
      reason: "wall-fixture-collision",
      blockerId: "today-wall",
    });
    expect(open.validation).toEqual({ valid: true, reason: null, blockerId: null });
  });

  it("opens the west wall after moving shelves inward", () => {
    const openWestWall = evaluateMemoryRelocation({
      x: WEST_APPROACH_X,
      z: 4.5,
      yaw: -Math.PI / 2,
    });
    // The archive bookcase that used to sit here was removed along with its
    // wall-fixture exclusion zone, so this spot on the north wall is now open too.
    const formerArchiveSpot = evaluateMemoryRelocation({
      x: -6.7,
      z: NORTH_APPROACH_Z,
      yaw: Math.PI,
    });

    expect(openWestWall.candidate.surfaceId).toBe("wall.interior.west");
    expect(openWestWall.candidate.height).toBe(1.5);
    expect(openWestWall.validation).toEqual({ valid: true, reason: null, blockerId: null });
    expect(formerArchiveSpot.validation).toEqual({ valid: true, reason: null, blockerId: null });
  });

  it("rejects furniture and the protected entrance on the floor", () => {
    const table = evaluateMemoryRelocation({ x: -5.25, z: 4.35, yaw: 0 });
    const entrance = evaluateMemoryRelocation({ x: 0, z: 6.4, yaw: 0 });

    expect(table.validation).toEqual({
      valid: false,
      reason: "furniture-collision",
      blockerId: "guestbook-worktable",
    });
    expect(entrance.validation).toEqual({
      valid: false,
      reason: "entrance-clearance",
      blockerId: "interior-entry-clearance",
    });
  });

  it("validates arbitrary persisted candidates instead of silently clamping them", () => {
    const candidate = createMemoryRelocationCandidateForPlacement({
      surface_id: "wall.interior.north",
      u: 1,
      v: 0.5,
      rotation_deg: 0,
      scale: 1,
      z_index: 0,
    });
    expect(validateMemoryRelocationCandidate(candidate)).toEqual({
      valid: false,
      reason: "surface-bounds",
      blockerId: "wall.interior.north:u-max",
    });
  });

  it("rejects non-finite pose data before it can be submitted", () => {
    expect(evaluateMemoryRelocation({ x: Number.NaN, z: 0, yaw: 0 }).validation)
      .toEqual({ valid: false, reason: "invalid-candidate", blockerId: null });
  });

  it("uses designed-letter dimensions and legacy kind dimensions", () => {
    const base = {
      id: "memory",
      body: "",
      emotion: null,
      card_style: "cream",
      author_alias: "",
      reaction_count: 0,
      version: 1,
      created_at: "",
      updated_at: "",
      placement: {
        surface_id: "floor.interior",
        u: 0.5,
        v: 0.5,
        rotation_deg: 0,
        scale: 1,
        z_index: 1,
        version: 1,
      },
    } satisfies Omit<RoomMemory, "kind" | "design">;
    const designed = {
      ...base,
      kind: "story",
      design: {
        version: 1,
        template_id: "warm-paper-v1",
        layers: [{
          id: "text-1",
          type: "text",
          text: "안녕",
          x: 0.5,
          y: 0.5,
          width: 0.5,
          font_size: 0.1,
          font: "round",
          color: "ink",
          align: "center",
          rotation_deg: 0,
        }],
      },
    } satisfies RoomMemory;
    const legacy = { ...base, kind: "mood", design: null } satisfies RoomMemory;

    expect(getMemoryRelocationBaseSize(designed)).toEqual([2.4, 1.5]);
    expect(getMemoryRelocationBaseSize(legacy)).toEqual([0.3, 0.3]);
  });
});
