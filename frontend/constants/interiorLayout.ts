export type InteriorZoneId =
  | "welcome-boulevard"
  | "central-forum"
  | "guestbook-commons"
  | "cowork-cafe"
  | "visitor-installation-gallery"
  | "shared-library"
  | "recovery-lab"
  | "research-archive"
  | "pbao-research-bay"
  | "plant-studio";

/** Backward-compatible alias while callers migrate from rooms to open zones. */
export type InteriorRoomId = InteriorZoneId;

export type InteriorZone = {
  id: InteriorZoneId;
  label: string;
  center: readonly [number, number];
  size: readonly [number, number];
  floorColor: string;
};

export type InteriorRoom = InteriorZone;

export type InteriorWall = {
  id: string;
  position: readonly [number, number, number];
  size: readonly [number, number, number];
  color: string;
  cutaway?: boolean;
};

export type InteriorCollider = {
  id: string;
  position: readonly [number, number, number];
  halfExtents: readonly [number, number, number];
};

export type InteriorFurniturePlacement = {
  id: string;
  position: [number, number, number];
  halfExtents: [number, number, number];
};

export type CommonsTraceAnchor = {
  id: string;
  kind: "guestbook-entry" | "installation-slot";
  position: readonly [number, number, number];
};

const ORIGINAL_INTERIOR_SIZE = [18, 15] as const;

export const INTERIOR_PLAN_SCALE = 1.2;
const scalePlan = (value: number) => Math.round(value * INTERIOR_PLAN_SCALE * 1000) / 1000;
export const INTERIOR_SIZE = [
  scalePlan(ORIGINAL_INTERIOR_SIZE[0]),
  scalePlan(ORIGINAL_INTERIOR_SIZE[1]),
] as const;
export const INTERIOR_HALF_WIDTH = INTERIOR_SIZE[0] / 2;
export const INTERIOR_HALF_DEPTH = INTERIOR_SIZE[1] / 2;
export const INTERIOR_WALL_HEIGHT = 2.85;
export const INTERIOR_CUTAWAY_HEIGHT = 0.78;
export const INTERIOR_WALL_THICKNESS = 0.22;
export const INTERIOR_ENTRANCE_WIDTH = 3.6;
export const INTERIOR_MAIN_PATH_HALF_WIDTH = 1.7 * INTERIOR_PLAN_SCALE;
export const INTERIOR_MIN_PATH_WIDTH = 1.4;
/** Clear walking/preview depth measured inward from each exterior shell centerline. */
export const INTERIOR_WALL_APPROACH_DEPTH = 2.25;
export const INTERIOR_WALL_NORMAL_SHIFT = {
  north: -(INTERIOR_SIZE[1] - ORIGINAL_INTERIOR_SIZE[1]) / 2,
  west: -(INTERIOR_SIZE[0] - ORIGINAL_INTERIOR_SIZE[0]) / 2,
  east: (INTERIOR_SIZE[0] - ORIGINAL_INTERIOR_SIZE[0]) / 2,
} as const;

/**
 * Floor finishes define zones without closing the commons into rooms. The
 * 4.08 m center boulevard remains visually and physically continuous.
 */
export const INTERIOR_ZONES: readonly InteriorZone[] = [
  { id: "welcome-boulevard", label: "마음 연구소 입구", center: [0, scalePlan(4.9)], size: [scalePlan(3.4), scalePlan(4.8)], floorColor: "#a57a5d" },
  { id: "central-forum", label: "오픈 포럼", center: [0, scalePlan(-0.35)], size: [scalePlan(3.4), scalePlan(5.5)], floorColor: "#98725a" },
  { id: "guestbook-commons", label: "프로메테우스 추억방", center: [scalePlan(-5.35), scalePlan(4.9)], size: [scalePlan(6.8), scalePlan(4.8)], floorColor: "#b18567" },
  { id: "cowork-cafe", label: "코워킹 카페", center: [scalePlan(5.35), scalePlan(5.7)], size: [scalePlan(6.8), scalePlan(3.2)], floorColor: "#ad8264" },
  { id: "visitor-installation-gallery", label: "오늘의 설치 갤러리", center: [scalePlan(5.35), scalePlan(2.25)], size: [scalePlan(6.8), scalePlan(3.5)], floorColor: "#9b8064" },
  { id: "shared-library", label: "공동 서재", center: [scalePlan(-5.35), scalePlan(-0.25)], size: [scalePlan(6.8), scalePlan(5.2)], floorColor: "#91705b" },
  { id: "recovery-lab", label: "회복 연구실", center: [scalePlan(5.35), scalePlan(-1.3)], size: [scalePlan(6.8), scalePlan(3.4)], floorColor: "#8e8060" },
  { id: "research-archive", label: "리서치 아카이브", center: [scalePlan(-6.7), scalePlan(-5.2)], size: [scalePlan(4.2), scalePlan(4.1)], floorColor: "#826755" },
  { id: "pbao-research-bay", label: "프바오 리서치 베이", center: [0, scalePlan(-5.2)], size: [scalePlan(8.8), scalePlan(4.1)], floorColor: "#866752" },
  { id: "plant-studio", label: "식물 스튜디오", center: [scalePlan(6.7), scalePlan(-5.2)], size: [scalePlan(4.2), scalePlan(4.1)], floorColor: "#788064" },
] as const;

/** Backward-compatible export used by the architecture renderer. */
export const INTERIOR_ROOMS = INTERIOR_ZONES;

const WALL_Y = INTERIOR_WALL_HEIGHT / 2;
const CUTAWAY_Y = INTERIOR_CUTAWAY_HEIGHT / 2;
const WALL_CORNER_OVERLAP = 0.2;
const SOUTH_SEGMENT_WIDTH = (INTERIOR_SIZE[0] - INTERIOR_ENTRANCE_WIDTH) / 2;
const SOUTH_SEGMENT_CENTER = INTERIOR_ENTRANCE_WIDTH / 2 + SOUTH_SEGMENT_WIDTH / 2;

/** Only the exterior shell remains; the commons has no internal wall or door. */
export const INTERIOR_WALLS: readonly InteriorWall[] = [
  { id: "outer-north", position: [0, WALL_Y, -INTERIOR_HALF_DEPTH], size: [INTERIOR_SIZE[0] + WALL_CORNER_OVERLAP, INTERIOR_WALL_HEIGHT, INTERIOR_WALL_THICKNESS], color: "#b8a08c" },
  { id: "outer-west", position: [-INTERIOR_HALF_WIDTH, WALL_Y, 0], size: [INTERIOR_WALL_THICKNESS, INTERIOR_WALL_HEIGHT, INTERIOR_SIZE[1] + WALL_CORNER_OVERLAP], color: "#aa927f" },
  { id: "outer-east", position: [INTERIOR_HALF_WIDTH, WALL_Y, 0], size: [INTERIOR_WALL_THICKNESS, INTERIOR_WALL_HEIGHT, INTERIOR_SIZE[1] + WALL_CORNER_OVERLAP], color: "#aa927f" },
  { id: "outer-south-left", position: [-SOUTH_SEGMENT_CENTER, CUTAWAY_Y, INTERIOR_HALF_DEPTH], size: [SOUTH_SEGMENT_WIDTH, INTERIOR_CUTAWAY_HEIGHT, INTERIOR_WALL_THICKNESS], color: "#b8a08c", cutaway: true },
  { id: "outer-south-right", position: [SOUTH_SEGMENT_CENTER, CUTAWAY_Y, INTERIOR_HALF_DEPTH], size: [SOUTH_SEGMENT_WIDTH, INTERIOR_CUTAWAY_HEIGHT, INTERIOR_WALL_THICKNESS], color: "#b8a08c", cutaway: true },
] as const;

/**
 * Large furniture is described once and consumed by both the renderer and the
 * physics/placement blockers. This keeps visual furniture and its collision
 * footprint from drifting apart during room-layout iterations.
 */
export const INTERIOR_FURNITURE_LAYOUT = {
  guestbookWorktable: {
    id: "guestbook-worktable",
    position: [-5.6, 0, 5.3],
    halfExtents: [1.25, 0.74, 0.62],
  },
  guestbookChairNorth: {
    id: "guestbook-chair-north",
    position: [-5.6, 0, 4.15],
    halfExtents: [0.72, 1, 0.76],
  },
  guestbookLowShelf: {
    id: "guestbook-low-shelf",
    position: [-8.15, 0, 5],
    halfExtents: [0.36, 0.62, 1.3],
  },
  guestbookNoticeBoard: {
    id: "guestbook-notice-board",
    position: [-7.5, 0, 7.15],
    halfExtents: [0.58, 0.8, 0.1],
  },
  plantLabIsland: {
    id: "plant-lab-island",
    position: [6.6, 0, -5.5],
    halfExtents: [1, 0.42, 0.72],
  },
  pbaoDesk: {
    id: "pbao-desk",
    position: [0, 0, -5.1],
    halfExtents: [1.65, 0.68, 0.5],
  },
  pbaoChairWest: {
    id: "pbao-chair-west",
    position: [-2.75, 0, -4],
    halfExtents: [0.4, 0.5, 0.4],
  },
} satisfies Record<string, InteriorFurniturePlacement>;

/**
 * No physical furniture marks this spot anymore (the console it was named
 * after was removed as a stray placement/movement blocker), but the
 * installation gallery interaction still anchors here.
 */
const INSTALLATION_ANCHOR_ORIGIN = [8.1, 0, 3.1] as const;

export const COMMONS_INTERACTION_ANCHORS = {
  // Sit at the chair (not the tabletop) to start writing — the chair is
  // already on the boulevard-facing side of the table, so no offset is needed.
  guestbook: [...INTERIOR_FURNITURE_LAYOUT.guestbookChairNorth.position],
  // Stand in the open gallery aisle instead of squeezing against the console.
  installation: [
    INSTALLATION_ANCHOR_ORIGIN[0] - 1.5,
    0,
    INSTALLATION_ANCHOR_ORIGIN[2],
  ],
} as const satisfies Record<string, readonly [number, number, number]>;

/** Stable slots that a later visitor-history layer can populate with live data. */
export const COMMONS_TRACE_ANCHORS: readonly CommonsTraceAnchor[] = [
  { id: "today-wall", kind: "guestbook-entry", position: [0, 1.62, -7.36 + INTERIOR_WALL_NORMAL_SHIFT.north] },
  ...([0.8, 1.8, 2.8, 3.8] as const).flatMap((z, row) =>
    ([3, 4.4, 5.8, 7.2] as const).map((x, column) => ({
      id: `installation-${String(row * 4 + column + 1).padStart(2, "0")}`,
      kind: "installation-slot" as const,
      position: [x, 0.05, z] as const,
    })),
  ),
] as const;

export const INTERIOR_FURNITURE_COLLIDERS: readonly InteriorCollider[] = Object.values(
  INTERIOR_FURNITURE_LAYOUT,
).map(({ id, position, halfExtents }) => ({
  id,
  position: [position[0], halfExtents[1], position[2]],
  halfExtents,
}));

/** The threshold floor extends beyond the shell before this invisible guard. */
const ENTRY_PORCH_HALF_DEPTH = 0.6;
const EXIT_GUARD_HALF_DEPTH = 0.15;
const EXIT_GUARD_OVERLAP = 0.13;

export const INTERIOR_ENTRY_PORCH: InteriorCollider = {
  id: "interior-entry-porch",
  position: [0, -0.16, INTERIOR_HALF_DEPTH + ENTRY_PORCH_HALF_DEPTH],
  halfExtents: [INTERIOR_ENTRANCE_WIDTH / 2, 0.16, ENTRY_PORCH_HALF_DEPTH],
};

export const INTERIOR_EXIT_GUARD: InteriorCollider = {
  id: "interior-exit-guard",
  position: [
    0,
    1.2,
    INTERIOR_ENTRY_PORCH.position[2]
      + INTERIOR_ENTRY_PORCH.halfExtents[2]
      + EXIT_GUARD_HALF_DEPTH
      - EXIT_GUARD_OVERLAP,
  ],
  halfExtents: [INTERIOR_ENTRANCE_WIDTH / 2, 1.2, EXIT_GUARD_HALF_DEPTH],
};

export const REQUIRED_INTERIOR_ZONE_IDS: readonly InteriorZoneId[] = [
  "welcome-boulevard",
  "central-forum",
  "guestbook-commons",
  "cowork-cafe",
  "visitor-installation-gallery",
  "shared-library",
  "recovery-lab",
  "research-archive",
  "pbao-research-bay",
  "plant-studio",
] as const;

export const REQUIRED_INTERIOR_ROOM_IDS = REQUIRED_INTERIOR_ZONE_IDS;
