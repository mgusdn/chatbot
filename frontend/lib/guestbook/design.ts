import {
  GUESTBOOK_DESIGN_V1_VERSION,
  GUESTBOOK_DESIGN_V2_VERSION,
  GUESTBOOK_DESIGN_VERSION,
  GUESTBOOK_STICKER_IDS,
  GUESTBOOK_TEMPLATE_IDS_V1,
  GUESTBOOK_TEMPLATE_IDS_V2,
  GUESTBOOK_TEXT_ALIGNS,
  GUESTBOOK_TEXT_COLORS,
  GUESTBOOK_TEXT_FONTS,
  type GuestbookDesign,
  type GuestbookDesignLayerV1,
  type GuestbookDesignV2,
  type GuestbookStickerId,
  type GuestbookStickerLayerV1,
  type GuestbookTextLayerV1,
} from "@/types/memoryRoom";

export const GUESTBOOK_MAX_LAYERS = 20;
export const GUESTBOOK_MAX_TEXT_LAYERS = 6;
export const GUESTBOOK_MAX_STICKER_LAYERS = 12;
export const GUESTBOOK_MAX_TOTAL_TEXT = 180;
export const GUESTBOOK_MAX_SIGNATURE_TEXT = 24;
export const GUESTBOOK_MAX_DESIGN_BYTES = 16 * 1024;
export const GUESTBOOK_LAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const GUESTBOOK_EDITOR_LIMITS = {
  textWidth: [0.12, 0.92],
  textFontSize: [0.045, 0.24],
  stickerWidth: [0.055, 0.38],
} as const;

const ROOT_KEYS_V1 = ["layers", "template_id", "version"] as const;
const ROOT_KEYS_V2 = ["layers", "signature", "template_id", "version"] as const;
const TEXT_KEYS = [
  "align",
  "color",
  "font",
  "font_size",
  "id",
  "rotation_deg",
  "text",
  "type",
  "width",
  "x",
  "y",
] as const;
const STICKER_KEYS = ["id", "rotation_deg", "sticker_id", "type", "width", "x", "y"] as const;
const INVISIBLE_TEXT = /[\u200B-\u200D\u2060\uFEFF]/g;

export class GuestbookDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestbookDesignError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new GuestbookDesignError(`${label} 값이 올바르지 않아요.`);
  }
  return value as T;
}

function boundedNumber(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new GuestbookDesignError(`${label} 값은 ${min}~${max} 사이여야 해요.`);
  }
  return value;
}

export function normalizeGuestbookText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE_TEXT, "");
}

export function countGuestbookText(text: string) {
  return Array.from(text).length;
}

export function normalizeGuestbookSignature(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new GuestbookDesignError("서명 형식이 올바르지 않아요.");
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE_TEXT, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  if (countGuestbookText(normalized) > GUESTBOOK_MAX_SIGNATURE_TEXT) {
    throw new GuestbookDesignError(`서명은 ${GUESTBOOK_MAX_SIGNATURE_TEXT}자까지 적을 수 있어요.`);
  }
  return normalized;
}

function normalizedTextLayer(value: Record<string, unknown>): GuestbookTextLayerV1 {
  if (!hasExactKeys(value, TEXT_KEYS)) throw new GuestbookDesignError("글씨 레이어에 알 수 없는 항목이 있어요.");
  if (typeof value.id !== "string" || !GUESTBOOK_LAYER_ID_PATTERN.test(value.id)) {
    throw new GuestbookDesignError("글씨 레이어 ID가 올바르지 않아요.");
  }
  if (typeof value.text !== "string") throw new GuestbookDesignError("글씨 레이어의 문구가 올바르지 않아요.");
  return {
    id: value.id,
    type: "text",
    text: normalizeGuestbookText(value.text),
    x: boundedNumber(value.x, 0, 1, "글씨 x"),
    y: boundedNumber(value.y, 0, 1, "글씨 y"),
    width: boundedNumber(value.width, 0, 1, "글씨 너비"),
    font_size: boundedNumber(value.font_size, 0, 1, "글씨 크기"),
    font: enumValue(value.font, GUESTBOOK_TEXT_FONTS, "글씨체"),
    color: enumValue(value.color, GUESTBOOK_TEXT_COLORS, "글씨 색"),
    align: enumValue(value.align, GUESTBOOK_TEXT_ALIGNS, "글씨 정렬"),
    rotation_deg: boundedNumber(value.rotation_deg, -180, 180, "글씨 회전"),
  };
}

function normalizedStickerLayer(value: Record<string, unknown>): GuestbookStickerLayerV1 {
  if (!hasExactKeys(value, STICKER_KEYS)) throw new GuestbookDesignError("스티커 레이어에 알 수 없는 항목이 있어요.");
  if (typeof value.id !== "string" || !GUESTBOOK_LAYER_ID_PATTERN.test(value.id)) {
    throw new GuestbookDesignError("스티커 레이어 ID가 올바르지 않아요.");
  }
  return {
    id: value.id,
    type: "sticker",
    sticker_id: enumValue(value.sticker_id, GUESTBOOK_STICKER_IDS, "스티커"),
    x: boundedNumber(value.x, 0, 1, "스티커 x"),
    y: boundedNumber(value.y, 0, 1, "스티커 y"),
    width: boundedNumber(value.width, 0, 1, "스티커 너비"),
    rotation_deg: boundedNumber(value.rotation_deg, -180, 180, "스티커 회전"),
  };
}

function normalizeLayers(value: unknown) {
  if (!Array.isArray(value)) throw new GuestbookDesignError("방명록 레이어 목록이 올바르지 않아요.");
  if (value.length > GUESTBOOK_MAX_LAYERS) {
    throw new GuestbookDesignError(`요소는 ${GUESTBOOK_MAX_LAYERS}개까지 놓을 수 있어요.`);
  }

  let textCount = 0;
  let stickerCount = 0;
  let totalText = 0;
  const ids = new Set<string>();
  const layers = value.map((layer): GuestbookDesignLayerV1 => {
    if (!isRecord(layer) || (layer.type !== "text" && layer.type !== "sticker")) {
      throw new GuestbookDesignError("알 수 없는 방명록 레이어가 있어요.");
    }
    const normalized = layer.type === "text"
      ? normalizedTextLayer(layer)
      : normalizedStickerLayer(layer);
    if (ids.has(normalized.id)) throw new GuestbookDesignError("레이어 ID는 서로 달라야 해요.");
    ids.add(normalized.id);
    if (normalized.type === "text") {
      textCount += 1;
      totalText += countGuestbookText(normalized.text);
    } else {
      stickerCount += 1;
    }
    return normalized;
  });

  if (textCount > GUESTBOOK_MAX_TEXT_LAYERS) {
    throw new GuestbookDesignError(`글씨는 ${GUESTBOOK_MAX_TEXT_LAYERS}개까지 놓을 수 있어요.`);
  }
  if (stickerCount > GUESTBOOK_MAX_STICKER_LAYERS) {
    throw new GuestbookDesignError(`스티커는 ${GUESTBOOK_MAX_STICKER_LAYERS}개까지 놓을 수 있어요.`);
  }
  if (totalText > GUESTBOOK_MAX_TOTAL_TEXT) {
    throw new GuestbookDesignError(`전체 문구는 ${GUESTBOOK_MAX_TOTAL_TEXT}자까지 적을 수 있어요.`);
  }
  return layers;
}

function enforceDesignBytes(design: GuestbookDesign) {
  const encodedBytes = typeof TextEncoder === "undefined"
    ? JSON.stringify(design).length
    : new TextEncoder().encode(JSON.stringify(design)).byteLength;
  if (encodedBytes > GUESTBOOK_MAX_DESIGN_BYTES) {
    throw new GuestbookDesignError("방명록 디자인의 저장 크기가 너무 커요.");
  }
  return design;
}

/** Strictly parses untrusted V1/V2 JSON while normalizing only public text. */
export function normalizeGuestbookDesign(value: unknown): GuestbookDesign {
  if (!isRecord(value)) {
    throw new GuestbookDesignError("방명록 디자인 형식이 올바르지 않아요.");
  }
  if (value.version === GUESTBOOK_DESIGN_V1_VERSION) {
    if (!hasExactKeys(value, ROOT_KEYS_V1)) {
      throw new GuestbookDesignError("방명록 V1 디자인 형식이 올바르지 않아요.");
    }
    return enforceDesignBytes({
      version: GUESTBOOK_DESIGN_V1_VERSION,
      template_id: enumValue(value.template_id, GUESTBOOK_TEMPLATE_IDS_V1, "편지지"),
      layers: normalizeLayers(value.layers),
    });
  }
  if (value.version === GUESTBOOK_DESIGN_V2_VERSION) {
    if (!hasExactKeys(value, ROOT_KEYS_V2)) {
      throw new GuestbookDesignError("방명록 V2 디자인 형식이 올바르지 않아요.");
    }
    const layers = normalizeLayers(value.layers);
    const signature = normalizeGuestbookSignature(value.signature);
    const publicTextLength = layers.reduce(
      (total, layer) => total + (layer.type === "text" ? countGuestbookText(layer.text) : 0),
      signature ? countGuestbookText(signature) : 0,
    );
    if (publicTextLength > GUESTBOOK_MAX_TOTAL_TEXT) {
      throw new GuestbookDesignError(
        `문구와 서명을 합쳐 ${GUESTBOOK_MAX_TOTAL_TEXT}자까지 적을 수 있어요.`,
      );
    }
    return enforceDesignBytes({
      version: GUESTBOOK_DESIGN_V2_VERSION,
      template_id: enumValue(value.template_id, GUESTBOOK_TEMPLATE_IDS_V2, "편지지"),
      layers,
      signature,
    });
  }
  throw new GuestbookDesignError("지원하지 않는 방명록 디자인 버전이에요.");
}

export function tryNormalizeGuestbookDesign(value: unknown) {
  try {
    return normalizeGuestbookDesign(value);
  } catch {
    return null;
  }
}

export function createGuestbookLayerId(prefix: "text" | "sticker" = "text") {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.slice(0, 64);
}

export function createGuestbookTextLayer(overrides: Partial<GuestbookTextLayerV1> = {}): GuestbookTextLayerV1 {
  return {
    id: createGuestbookLayerId("text"),
    type: "text",
    text: "",
    x: 0.5,
    y: 0.48,
    width: 0.68,
    font_size: 0.105,
    font: "round",
    color: "ink",
    align: "center",
    rotation_deg: 0,
    ...overrides,
  };
}

export function createGuestbookStickerLayer(
  stickerId: GuestbookStickerId,
  overrides: Partial<GuestbookStickerLayerV1> = {},
): GuestbookStickerLayerV1 {
  return {
    id: createGuestbookLayerId("sticker"),
    type: "sticker",
    sticker_id: stickerId,
    x: 0.72,
    y: 0.68,
    width: 0.14,
    rotation_deg: 0,
    ...overrides,
  };
}

export function createDefaultGuestbookDesign(): GuestbookDesignV2 {
  return {
    version: GUESTBOOK_DESIGN_VERSION,
    template_id: "warm-paper-v1",
    layers: [createGuestbookTextLayer()],
    signature: null,
  };
}

export function prepareGuestbookDesign(value: unknown): GuestbookDesign {
  const design = normalizeGuestbookDesign(value);
  const layers = design.layers.filter((layer) => layer.type !== "text" || layer.text.trim().length > 0);
  if (!layers.some((layer) => layer.type === "text")) {
    throw new GuestbookDesignError("한 개 이상의 문구를 적어주세요.");
  }
  return normalizeGuestbookDesign({ ...design, layers });
}

export function isGuestbookDesignArmable(value: unknown) {
  try {
    prepareGuestbookDesign(value);
    return true;
  } catch {
    return false;
  }
}

export function clampGuestbookPosition(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

export function normalizeGuestbookRotation(value: number) {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function replaceGuestbookLayer(
  design: GuestbookDesign,
  layerId: string,
  next: GuestbookDesignLayerV1,
): GuestbookDesign {
  return normalizeGuestbookDesign({
    ...design,
    layers: design.layers.map((layer) => layer.id === layerId ? next : layer),
  });
}

export function reorderGuestbookLayer(
  design: GuestbookDesign,
  layerId: string,
  edge: "front" | "back",
): GuestbookDesign {
  const selected = design.layers.find((layer) => layer.id === layerId);
  if (!selected) return design;
  const others = design.layers.filter((layer) => layer.id !== layerId);
  return normalizeGuestbookDesign({
    ...design,
    layers: edge === "front" ? [...others, selected] : [selected, ...others],
  });
}
