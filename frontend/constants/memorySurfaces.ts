import type {
  MemoryRelocationSurfaceId,
  MemoryRelocationWallSurfaceId,
  MemorySurfaceId,
} from "@/types/memoryRoom";
import {
  INTERIOR_HALF_DEPTH,
  INTERIOR_HALF_WIDTH,
  INTERIOR_SIZE,
  INTERIOR_WALL_HEIGHT,
  INTERIOR_WALL_THICKNESS,
} from "@/constants/interiorLayout";

export type MemoryVector3 = readonly [number, number, number];
export type MemorySurfaceSize = readonly [number, number];
export type MemoryRelocationSurfaceKind = "floor" | "wall";
export type { MemoryRelocationSurfaceId } from "@/types/memoryRoom";

export type MemorySurfaceDefinition = {
  id: MemorySurfaceId;
  label: string;
  position: MemoryVector3;
  rotation: MemoryVector3;
  size: MemorySurfaceSize;
  /** Surface-local +U, +V and outward-from-plane axes in world space. */
  uAxis: MemoryVector3;
  vAxis: MemoryVector3;
  normal: MemoryVector3;
  relocationKind: MemoryRelocationSurfaceKind | null;
};

export type MemoryWallFixture = {
  id: string;
  surfaceId: MemoryRelocationWallSurfaceId;
  /** Axis-aligned bounds in the owning wall's local U/V coordinates. */
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
};

const HORIZONTAL_U: MemoryVector3 = [1, 0, 0];
const HORIZONTAL_V: MemoryVector3 = [0, 0, -1];
const HORIZONTAL_NORMAL: MemoryVector3 = [0, 1, 0];
const VERTICAL_V: MemoryVector3 = [0, 1, 0];
const RELOCATION_WALL_EDGE_MARGIN = 0.3;
const RELOCATION_WALL_PLANE_INSET = INTERIOR_WALL_THICKNESS / 2 + 0.015;

/**
 * Canonical geometry for every persisted memory surface.
 *
 * Legacy boards keep their original small display geometry. The west board
 * follows the outer wall only along its normal when the room expands, so
 * existing U/V positions stay attached instead of floating inside the room.
 */
export const MEMORY_SURFACE_REGISTRY = {
  "wall.north": {
    id: "wall.north",
    label: "추억 게시판",
    position: [-7.65, 1.12, 6.73],
    rotation: [0, 0, 0],
    size: [1.05, 1.25],
    uAxis: [1, 0, 0],
    vAxis: VERTICAL_V,
    normal: [0, 0, 1],
    relocationKind: null,
  },
  "wall.west": {
    id: "wall.west",
    label: "서쪽 벽",
    position: [
      -INTERIOR_HALF_WIDTH + RELOCATION_WALL_PLANE_INSET,
      1.35,
      4.9,
    ],
    rotation: [0, Math.PI / 2, 0],
    size: [3.5, 2.15],
    uAxis: [0, 0, -1],
    vAxis: VERTICAL_V,
    normal: [1, 0, 0],
    relocationKind: null,
  },
  "floor.center": {
    id: "floor.center",
    label: "추억방 바닥",
    position: [-5.35, 0.025, 4.9],
    rotation: [-Math.PI / 2, 0, 0],
    size: [5.7, 3.65],
    uAxis: HORIZONTAL_U,
    vAxis: HORIZONTAL_V,
    normal: HORIZONTAL_NORMAL,
    relocationKind: null,
  },
  "floor.interior": {
    id: "floor.interior",
    label: "상담실 전체 바닥",
    position: [0, 0.025, 0],
    rotation: [-Math.PI / 2, 0, 0],
    size: INTERIOR_SIZE,
    uAxis: HORIZONTAL_U,
    vAxis: HORIZONTAL_V,
    normal: HORIZONTAL_NORMAL,
    relocationKind: "floor",
  },
  "desk.main": {
    id: "desk.main",
    label: "기록 테이블",
    position: [-5.25, 0.845, 5.25],
    rotation: [-Math.PI / 2, 0, 0],
    size: [2.18, 0.94],
    uAxis: HORIZONTAL_U,
    vAxis: HORIZONTAL_V,
    normal: HORIZONTAL_NORMAL,
    relocationKind: null,
  },
  "wall.interior.north": {
    id: "wall.interior.north",
    label: "상담실 북쪽 벽",
    position: [
      0,
      INTERIOR_WALL_HEIGHT / 2,
      -INTERIOR_HALF_DEPTH + RELOCATION_WALL_PLANE_INSET,
    ],
    rotation: [0, 0, 0],
    size: [INTERIOR_SIZE[0] - RELOCATION_WALL_EDGE_MARGIN * 2, INTERIOR_WALL_HEIGHT],
    uAxis: [1, 0, 0],
    vAxis: VERTICAL_V,
    normal: [0, 0, 1],
    relocationKind: "wall",
  },
  "wall.interior.west": {
    id: "wall.interior.west",
    label: "상담실 서쪽 벽",
    position: [
      -INTERIOR_HALF_WIDTH + RELOCATION_WALL_PLANE_INSET,
      INTERIOR_WALL_HEIGHT / 2,
      0,
    ],
    rotation: [0, Math.PI / 2, 0],
    size: [INTERIOR_SIZE[1] - RELOCATION_WALL_EDGE_MARGIN * 2, INTERIOR_WALL_HEIGHT],
    uAxis: [0, 0, -1],
    vAxis: VERTICAL_V,
    normal: [1, 0, 0],
    relocationKind: "wall",
  },
  "wall.interior.east": {
    id: "wall.interior.east",
    label: "상담실 동쪽 벽",
    position: [
      INTERIOR_HALF_WIDTH - RELOCATION_WALL_PLANE_INSET,
      INTERIOR_WALL_HEIGHT / 2,
      0,
    ],
    rotation: [0, -Math.PI / 2, 0],
    size: [INTERIOR_SIZE[1] - RELOCATION_WALL_EDGE_MARGIN * 2, INTERIOR_WALL_HEIGHT],
    uAxis: [0, 0, 1],
    vAxis: VERTICAL_V,
    normal: [-1, 0, 0],
    relocationKind: "wall",
  },
} as const satisfies Record<MemorySurfaceId, MemorySurfaceDefinition>;

export const MEMORY_RELOCATION_SURFACE_IDS = [
  "floor.interior",
  "wall.interior.north",
  "wall.interior.west",
  "wall.interior.east",
] as const satisfies readonly MemoryRelocationSurfaceId[];

export const MEMORY_RELOCATION_WALLS = [
  MEMORY_SURFACE_REGISTRY["wall.interior.north"],
  MEMORY_SURFACE_REGISTRY["wall.interior.west"],
  MEMORY_SURFACE_REGISTRY["wall.interior.east"],
] as const;

/**
 * Wall-mounted or wall-adjacent scene fixtures that must remain readable.
 * Bounds use the wall registry's local U/V axes, so validation stays purely 2D.
 */
export const MEMORY_WALL_FIXTURES: readonly MemoryWallFixture[] = [
  {
    id: "today-wall",
    surfaceId: "wall.interior.north",
    minU: -2.75,
    maxU: 2.75,
    minV: -0.84,
    maxV: 1.09,
  },
  {
    id: "archive-bookcase",
    surfaceId: "wall.interior.north",
    minU: -8.05,
    maxU: -5.35,
    minV: -1.425,
    maxV: 0.675,
  },
  {
    id: "guestbook-low-shelf",
    surfaceId: "wall.interior.west",
    minU: -5.95,
    maxU: -3.35,
    minV: -1.425,
    maxV: -0.185,
  },
  {
    id: "library-bookcase-west",
    surfaceId: "wall.interior.west",
    minU: -1.45,
    maxU: 1.95,
    minV: -1.425,
    maxV: 0.875,
  },
  {
    id: "library-low-bookcase-west",
    surfaceId: "wall.interior.west",
    minU: 2.5,
    maxU: 5,
    minV: -1.425,
    maxV: -0.175,
  },
  {
    id: "cowork-sofa",
    surfaceId: "wall.interior.east",
    minU: 4.45,
    maxU: 6.75,
    minV: -1.425,
    maxV: -0.465,
  },
  {
    id: "installation-console",
    surfaceId: "wall.interior.east",
    minU: 2.73,
    maxU: 3.57,
    minV: -1.425,
    maxV: 0.675,
  },
  {
    id: "recovery-bench",
    surfaceId: "wall.interior.east",
    minU: -2.3,
    maxU: -0.2,
    minV: -1.425,
    maxV: -0.585,
  },
  {
    id: "recovery-potted-plant",
    surfaceId: "wall.interior.east",
    minU: -3.2,
    maxU: -1.9,
    minV: -1.425,
    maxV: 0.375,
  },
  {
    id: "plant-studio-potted-plant",
    surfaceId: "wall.interior.east",
    minU: -7.2,
    maxU: -6.15,
    minV: -1.425,
    maxV: 0.375,
  },
] as const;

export function getMemorySurface(surfaceId: MemorySurfaceId): MemorySurfaceDefinition {
  return MEMORY_SURFACE_REGISTRY[surfaceId];
}
