import { describe, expect, it } from "vitest";
import { INTERIOR_SIZE } from "@/constants/interiorLayout";
import {
  GUESTBOOK_COLLISION_CLEARANCE,
  GUESTBOOK_FLOOR_INNER_BOUNDS,
  GUESTBOOK_FLOOR_SURFACE_ID,
  GUESTBOOK_FLOOR_WORLD_BOUNDS,
  GUESTBOOK_FORWARD_OFFSET,
  GUESTBOOK_LETTER_SIZE,
  createGuestbookPlacementCandidate,
  evaluateGuestbookPlacement,
  floorInteriorUvToWorld,
  floorInteriorWorldToUv,
  guestbookRotationDegToPlayerYaw,
  playerYawToGuestbookRotationDeg,
  validateGuestbookPlacement,
} from "@/lib/guestbook/guestbookPlacement";

function expectPointClose(
  actual: { x: number; z: number },
  expected: { x: number; z: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.z).toBeCloseTo(expected.z, 10);
}

function circularDistance(left: number, right: number) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

describe("floor.interior coordinate mapping", () => {
  it("maps the room center and corners with the floor plane's inverted v axis", () => {
    expect(floorInteriorWorldToUv({ x: 0, z: 0 })).toEqual({ u: 0.5, v: 0.5 });
    expect(floorInteriorWorldToUv({
      x: GUESTBOOK_FLOOR_WORLD_BOUNDS.minX,
      z: GUESTBOOK_FLOOR_WORLD_BOUNDS.maxZ,
    })).toEqual({ u: 0, v: 0 });
    expect(floorInteriorWorldToUv({
      x: GUESTBOOK_FLOOR_WORLD_BOUNDS.maxX,
      z: GUESTBOOK_FLOOR_WORLD_BOUNDS.minZ,
    })).toEqual({ u: 1, v: 1 });
  });

  it("round-trips arbitrary world and normalized positions without hidden clamping", () => {
    for (const point of [
      { x: -7.2, z: 4.3 },
      { x: 3.125, z: -6.25 },
      { x: 10, z: -8 },
    ]) {
      expectPointClose(floorInteriorUvToWorld(floorInteriorWorldToUv(point)), point);
    }
    expect(floorInteriorWorldToUv({ x: 10, z: -8 })).toEqual({
      u: (10 - GUESTBOOK_FLOOR_WORLD_BOUNDS.minX) / INTERIOR_SIZE[0],
      v: (GUESTBOOK_FLOOR_WORLD_BOUNDS.maxZ + 8) / INTERIOR_SIZE[1],
    });
  });
});

describe("guestbook floor rotation convention", () => {
  it("keeps the design upright from the player's side at cardinal headings", () => {
    expect(playerYawToGuestbookRotationDeg(0)).toBe(-180);
    expect(playerYawToGuestbookRotationDeg(Math.PI / 2)).toBe(-90);
    expect(playerYawToGuestbookRotationDeg(-Math.PI / 2)).toBe(90);
    expect(playerYawToGuestbookRotationDeg(Math.PI)).toBe(0);
  });

  it("round-trips equivalent angles across multiple full turns", () => {
    for (const yaw of [
      -Math.PI * 4.5,
      -Math.PI,
      -0.37,
      0,
      Math.PI / 2,
      Math.PI,
      Math.PI * 5.25,
    ]) {
      const restored = guestbookRotationDegToPlayerYaw(playerYawToGuestbookRotationDeg(yaw));
      expect(circularDistance(restored, yaw)).toBeLessThan(1e-10);
    }
  });
});

describe("guestbook placement candidate", () => {
  it("places a 2.4:1.5 letter 0.9 m in front of the player", () => {
    const candidate = createGuestbookPlacementCandidate({ x: 1, z: 2, yaw: 0 });

    expect(candidate).toMatchObject({
      surfaceId: GUESTBOOK_FLOOR_SURFACE_ID,
      x: 1,
      z: 2 + GUESTBOOK_FORWARD_OFFSET,
      playerYaw: 0,
      yaw: 0,
      rotationOffsetDeg: 0,
      rotationDeg: -180,
      width: GUESTBOOK_LETTER_SIZE[0],
      depth: GUESTBOOK_LETTER_SIZE[1],
    });
    expect(candidate.u).toBeCloseTo(
      (1 - GUESTBOOK_FLOOR_WORLD_BOUNDS.minX) / INTERIOR_SIZE[0],
    );
    expect(candidate.v).toBeCloseTo(
      (GUESTBOOK_FLOOR_WORLD_BOUNDS.maxZ - 2.9) / INTERIOR_SIZE[1],
    );
    expect(Math.min(...candidate.corners.map((corner) => corner.x))).toBeCloseTo(-0.2);
    expect(Math.max(...candidate.corners.map((corner) => corner.x))).toBeCloseTo(2.2);
    expect(Math.min(...candidate.corners.map((corner) => corner.z))).toBeCloseTo(2.15);
    expect(Math.max(...candidate.corners.map((corner) => corner.z))).toBeCloseTo(3.65);
  });

  it("uses the PlayerController yaw convention for diagonal and side-facing poses", () => {
    const east = createGuestbookPlacementCandidate({ x: 1, z: 2, yaw: Math.PI / 2 });
    expect(east.x).toBeCloseTo(1.9);
    expect(east.z).toBeCloseTo(2);
    expect(east.rotationDeg).toBe(-90);

    const diagonal = createGuestbookPlacementCandidate({ x: -1, z: -1, yaw: Math.PI / 4 });
    expect(diagonal.x).toBeCloseTo(-1 + GUESTBOOK_FORWARD_OFFSET / Math.sqrt(2));
    expect(diagonal.z).toBeCloseTo(-1 + GUESTBOOK_FORWARD_OFFSET / Math.sqrt(2));
  });

  it("rotates in place for R-key offsets without changing the candidate center", () => {
    const pose = { x: 1, z: 2, yaw: 0 };
    const base = createGuestbookPlacementCandidate(pose);
    const rotated = createGuestbookPlacementCandidate(pose, { rotationOffsetDeg: 90 });

    expectPointClose(rotated, base);
    expect(rotated.yaw).toBeCloseTo(Math.PI / 2);
    expect(rotated.rotationOffsetDeg).toBe(90);
    expect(rotated.rotationDeg).toBe(-90);
    expect(Math.max(...rotated.corners.map((corner) => corner.x)) - rotated.x)
      .toBeCloseTo(GUESTBOOK_LETTER_SIZE[1] / 2);
    expect(Math.max(...rotated.corners.map((corner) => corner.z)) - rotated.z)
      .toBeCloseTo(GUESTBOOK_LETTER_SIZE[0] / 2);
  });
});

describe("guestbook placement validation", () => {
  it("accepts open floor and returns an explicit success shape", () => {
    expect(evaluateGuestbookPlacement({ x: 0, z: 0, yaw: 0 }).validation).toEqual({
      valid: true,
      reason: null,
      blockerId: null,
    });
    expect(evaluateGuestbookPlacement({ x: 1.5, z: 1, yaw: Math.PI / 4 }).validation.valid).toBe(true);
  });

  it("rejects non-finite player poses before geometry checks", () => {
    const candidate = createGuestbookPlacementCandidate({ x: Number.NaN, z: 0, yaw: 0 });
    expect(validateGuestbookPlacement(candidate)).toEqual({
      valid: false,
      reason: "invalid-pose",
      blockerId: null,
    });
    expect(evaluateGuestbookPlacement({ x: 0, z: 0, yaw: Number.POSITIVE_INFINITY }).validation)
      .toEqual({ valid: false, reason: "invalid-pose", blockerId: null });
  });

  it("requires the complete rotated letter and clearance to remain inside the outer shell", () => {
    const eastWall = evaluateGuestbookPlacement({
      x: GUESTBOOK_FLOOR_INNER_BOUNDS.maxX
        - GUESTBOOK_FORWARD_OFFSET
        - GUESTBOOK_LETTER_SIZE[1] / 2
        + 0.01,
      z: 0,
      yaw: Math.PI / 2,
    });
    expect(eastWall.validation).toEqual({
      valid: false,
      reason: "wall-collision",
      blockerId: "outer-east",
    });

    const northWall = evaluateGuestbookPlacement({
      x: 0,
      z: GUESTBOOK_FLOOR_INNER_BOUNDS.minZ
        + GUESTBOOK_FORWARD_OFFSET
        + GUESTBOOK_LETTER_SIZE[1] / 2
        - 0.01,
      yaw: Math.PI,
    });
    expect(northWall.validation).toEqual({
      valid: false,
      reason: "wall-collision",
      blockerId: "outer-north",
    });
  });

  it("accepts exact inner clearance but rejects a millimeter beyond it", () => {
    const legalCenterX = GUESTBOOK_FLOOR_INNER_BOUNDS.maxX
      - GUESTBOOK_COLLISION_CLEARANCE
      - GUESTBOOK_LETTER_SIZE[0] / 2;
    const legal = evaluateGuestbookPlacement({ x: legalCenterX, z: -4.7, yaw: 0 });
    const outside = evaluateGuestbookPlacement({ x: legalCenterX + 0.001, z: -4.7, yaw: 0 });

    expect(legal.validation.valid).toBe(true);
    expect(outside.validation).toEqual({
      valid: false,
      reason: "wall-collision",
      blockerId: "outer-east",
    });
  });

  it("protects the entrance and spawn route even when the letter fits inside the walls", () => {
    const result = evaluateGuestbookPlacement({ x: 0, z: 4.8, yaw: 0 });
    expect(result.candidate.corners.every((corner) =>
      corner.z < GUESTBOOK_FLOOR_INNER_BOUNDS.maxZ)).toBe(true);
    expect(result.validation).toEqual({
      valid: false,
      reason: "entrance-clearance",
      blockerId: "interior-entry-clearance",
    });
  });

  it("reports the specific furniture collider under the candidate", () => {
    expect(evaluateGuestbookPlacement({ x: -5.25, z: 4.35, yaw: 0 }).validation).toEqual({
      valid: false,
      reason: "furniture-collision",
      blockerId: "guestbook-worktable",
    });
    expect(evaluateGuestbookPlacement({ x: 0, z: -6, yaw: 0 }).validation).toEqual({
      valid: false,
      reason: "furniture-collision",
      blockerId: "pbao-desk",
    });
  });

  it("uses a rotated OBB instead of an axis-aligned approximation", () => {
    const pose = { x: -2.5, z: -1.05, yaw: 0 };
    const axisAligned = evaluateGuestbookPlacement(pose);
    const diagonal = evaluateGuestbookPlacement(pose, { rotationOffsetDeg: 45 });

    expect(axisAligned.validation.valid).toBe(true);
    expect(diagonal.validation).toEqual({
      valid: false,
      reason: "furniture-collision",
      blockerId: "library-worktable",
    });
  });
});
