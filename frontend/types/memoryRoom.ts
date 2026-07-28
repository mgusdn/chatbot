export const MEMORY_KINDS = ["note", "mood", "story"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_EMOTIONS = ["calm", "joy", "tender", "sad", "hope", "tired"] as const;
export type MemoryEmotion = (typeof MEMORY_EMOTIONS)[number];

export const MEMORY_CARD_STYLES = ["cream", "sage", "sky", "rose", "lilac"] as const;
export type MemoryCardStyle = (typeof MEMORY_CARD_STYLES)[number];

export const GUESTBOOK_DESIGN_V1_VERSION = 1 as const;
export const GUESTBOOK_DESIGN_V2_VERSION = 2 as const;
/** Version used for newly-created guestbook letters. */
export const GUESTBOOK_DESIGN_VERSION = GUESTBOOK_DESIGN_V2_VERSION;

export const GUESTBOOK_TEMPLATE_IDS_V1 = ["warm-paper-v1"] as const;
export const GUESTBOOK_TEMPLATE_IDS_V2 = [
  "warm-paper-v1",
  "sage-grid-v1",
  "sky-postcard-v1",
  "rose-confetti-v1",
] as const;
export const GUESTBOOK_TEMPLATE_IDS = GUESTBOOK_TEMPLATE_IDS_V2;
export type GuestbookTemplateIdV1 = (typeof GUESTBOOK_TEMPLATE_IDS_V1)[number];
export type GuestbookTemplateIdV2 = (typeof GUESTBOOK_TEMPLATE_IDS_V2)[number];
export type GuestbookTemplateId = GuestbookTemplateIdV1 | GuestbookTemplateIdV2;

export const GUESTBOOK_TEXT_FONTS = ["round", "display"] as const;
export type GuestbookTextFont = (typeof GUESTBOOK_TEXT_FONTS)[number];

export const GUESTBOOK_TEXT_COLORS = ["ink", "berry", "ocean", "sun"] as const;
export type GuestbookTextColor = (typeof GUESTBOOK_TEXT_COLORS)[number];

export const GUESTBOOK_TEXT_ALIGNS = ["left", "center", "right"] as const;
export type GuestbookTextAlign = (typeof GUESTBOOK_TEXT_ALIGNS)[number];

export const GUESTBOOK_STICKER_IDS = [
  "heart",
  "sparkle",
  "leaf",
  "flower",
  "star",
  "smile",
  "speech",
  "paw",
  "thumbs-up",
  "prometheus-p",
] as const;
export type GuestbookStickerId = (typeof GUESTBOOK_STICKER_IDS)[number];

export type GuestbookTextLayerV1 = {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  font_size: number;
  font: GuestbookTextFont;
  color: GuestbookTextColor;
  align: GuestbookTextAlign;
  rotation_deg: number;
};

export type GuestbookStickerLayerV1 = {
  id: string;
  type: "sticker";
  sticker_id: GuestbookStickerId;
  x: number;
  y: number;
  width: number;
  rotation_deg: number;
};

export type GuestbookDesignLayerV1 = GuestbookTextLayerV1 | GuestbookStickerLayerV1;

export type GuestbookDesignV1 = {
  version: typeof GUESTBOOK_DESIGN_V1_VERSION;
  template_id: GuestbookTemplateIdV1;
  layers: GuestbookDesignLayerV1[];
};

export type GuestbookDesignV2 = {
  version: typeof GUESTBOOK_DESIGN_V2_VERSION;
  template_id: GuestbookTemplateIdV2;
  layers: GuestbookDesignLayerV1[];
  signature: string | null;
};

export type GuestbookDesign = GuestbookDesignV1 | GuestbookDesignV2;

/**
 * Surfaces used by the original point-and-click composer. Keep this list
 * stable so existing composer controls and persisted memories do not move
 * when walk-up relocation surfaces are added.
 */
export const LEGACY_MEMORY_SURFACE_IDS = [
  "wall.north",
  "wall.west",
  "floor.center",
  "floor.interior",
  "desk.main",
] as const;

/** Full-height walls that can be targeted while carrying a memory. */
export const MEMORY_RELOCATION_WALL_SURFACE_IDS = [
  "wall.interior.north",
  "wall.interior.west",
  "wall.interior.east",
] as const;

export const ALL_MEMORY_SURFACE_IDS = [
  ...LEGACY_MEMORY_SURFACE_IDS,
  ...MEMORY_RELOCATION_WALL_SURFACE_IDS,
] as const;

/** @deprecated Prefer a purpose-specific surface list or ALL_MEMORY_SURFACE_IDS. */
export const MEMORY_SURFACE_IDS = LEGACY_MEMORY_SURFACE_IDS;

export type LegacyMemorySurfaceId = (typeof LEGACY_MEMORY_SURFACE_IDS)[number];
export type MemoryRelocationWallSurfaceId = (typeof MEMORY_RELOCATION_WALL_SURFACE_IDS)[number];
export type MemoryRelocationSurfaceId = "floor.interior" | MemoryRelocationWallSurfaceId;
export type MemorySurfaceId = (typeof ALL_MEMORY_SURFACE_IDS)[number];

export const MEMORY_REPORT_CATEGORIES = [
  "personal_information",
  "crisis",
  "harassment",
  "spam",
  "copyright",
  "other",
] as const;
export type MemoryReportCategory = (typeof MEMORY_REPORT_CATEGORIES)[number];

export const MEMORY_BODY_LIMITS: Record<MemoryKind, number> = {
  note: 120,
  mood: 80,
  story: 500,
};

export type MemoryPlacementInput = {
  surface_id: MemorySurfaceId;
  u: number;
  v: number;
  rotation_deg: number;
  scale: number;
  z_index: number;
};

export type MemoryPlacement = MemoryPlacementInput & {
  version: number;
};

export type RoomMemory = {
  id: string;
  kind: MemoryKind;
  body: string;
  design?: GuestbookDesign | null;
  emotion: MemoryEmotion | null;
  card_style: MemoryCardStyle;
  author_alias: string;
  reaction_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  placement: MemoryPlacement;
};

export type MemoryRoom = {
  slug: string;
  title: string;
  scene_version: number;
  theme_id: string;
  revision: number;
  memory_count?: number;
};

export type MemoryListResponse = {
  room: MemoryRoom;
  memories: RoomMemory[];
  next_cursor: string | null;
};

export type CreateMemoryInput = {
  kind: MemoryKind;
  body?: string;
  design?: GuestbookDesign | null;
  client_request_id?: string;
  ownership_token?: string;
  emotion?: MemoryEmotion | null;
  card_style: MemoryCardStyle;
  author_alias?: string | null;
  placement: MemoryPlacementInput;
};

export type MemoryCreateResponse = {
  memory: RoomMemory;
  ownership_token: string;
};

export type MemoryReactionResponse = {
  memory_id: string;
  reaction_count: number;
  reacted: boolean;
};

export type MemoryReportResponse = {
  memory_id: string;
  reported: true;
  report_count: number;
  moderation_status: "visible" | "hidden";
};

export const DEFAULT_MEMORY_PLACEMENT: MemoryPlacementInput = {
  surface_id: "wall.north",
  u: 0.5,
  v: 0.5,
  rotation_deg: 0,
  scale: 1,
  z_index: 0,
};

export function clampMemoryPlacement(placement: MemoryPlacementInput): MemoryPlacementInput {
  return {
    ...placement,
    u: Math.max(0, Math.min(1, placement.u)),
    v: Math.max(0, Math.min(1, placement.v)),
    rotation_deg: Math.max(-180, Math.min(180, placement.rotation_deg)),
    scale: Math.max(0.75, Math.min(1.35, placement.scale)),
    z_index: Math.max(0, Math.min(1000, Math.round(placement.z_index))),
  };
}

export function countMemoryBody(body: string) {
  return Array.from(body).length;
}
