import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUESTBOOK_CANVAS_HEIGHT,
  GUESTBOOK_CANVAS_WIDTH,
  GUESTBOOK_MAX_SIGNATURE_TEXT,
  GUESTBOOK_MAX_TOTAL_TEXT,
  GUESTBOOK_PROMETHEUS_P_STICKER_SRC,
  GUESTBOOK_TEMPLATE_OPTIONS,
  GuestbookDesignError,
  createDefaultGuestbookDesign,
  createGuestbookStickerLayer,
  createGuestbookTextLayer,
  ensureGuestbookSignatureFontReady,
  hitTestGuestbookLayer,
  normalizeGuestbookDesign,
  prepareGuestbookDesign,
  renderGuestbookDesign,
  wrapGuestbookText,
} from "@/lib/guestbook";

function contextMock() {
  const gradient = { addColorStop: vi.fn() };
  const values: Record<string, unknown> = {
    canvas: { width: 1024, height: 640 },
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
    createLinearGradient: () => gradient,
  };
  return new Proxy(values, {
    get(target, property) {
      if (property in target) return target[property as string];
      const method = vi.fn();
      target[property as string] = method;
      return method;
    },
    set(target, property, value) {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class LoadedStickerImage {
  complete = true;
  naturalWidth = 160;
  naturalHeight = 120;
  decoding = "auto";
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  src = "";
}

beforeEach(() => {
  vi.stubGlobal("Image", LoadedStickerImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guestbook design v1", () => {
  it("normalizes public text but rejects extra fields and invalid enums", () => {
    const text = createGuestbookTextLayer({ text: "ＡＢ\r\n마음\u200b" });
    const design = normalizeGuestbookDesign({
      version: 1,
      template_id: "warm-paper-v1",
      layers: [text],
    });
    expect(design.layers[0]).toMatchObject({ text: "AB\n마음" });

    expect(() => normalizeGuestbookDesign({ ...design, arbitrary_html: "<b>x</b>" }))
      .toThrow(GuestbookDesignError);
    expect(() => normalizeGuestbookDesign({
      ...design,
      layers: [{ ...text, color: "url(javascript:bad)" }],
    })).toThrow("글씨 색");
  });

  it("enforces unique IDs, layer counts, text budget, and an armable phrase", () => {
    const text = createGuestbookTextLayer({ text: "안녕" });
    expect(() => normalizeGuestbookDesign({
      version: 1,
      template_id: "warm-paper-v1",
      layers: [text, { ...text }],
    })).toThrow("레이어 ID");

    expect(() => normalizeGuestbookDesign({
      version: 1,
      template_id: "warm-paper-v1",
      layers: [createGuestbookTextLayer({ text: "가".repeat(GUESTBOOK_MAX_TOTAL_TEXT + 1) })],
    })).toThrow(`${GUESTBOOK_MAX_TOTAL_TEXT}자`);

    const empty = createDefaultGuestbookDesign();
    expect(() => prepareGuestbookDesign(empty)).toThrow("문구");
    const prepared = prepareGuestbookDesign({
      ...empty,
      layers: [
        empty.layers[0],
        createGuestbookTextLayer({ text: " 오늘의 마음 " }),
        createGuestbookStickerLayer("heart"),
      ],
    });
    expect(prepared.layers).toHaveLength(2);
    expect(prepared.layers.some((layer) => layer.type === "text" && layer.text.includes("오늘"))).toBe(true);
  });
});

describe("guestbook design v2", () => {
  it("creates new drafts as V2 while preserving strict V1 parsing", () => {
    const draft = createDefaultGuestbookDesign();
    expect(draft).toMatchObject({
      version: 2,
      template_id: "warm-paper-v1",
      signature: null,
    });

    const legacy = normalizeGuestbookDesign({
      version: 1,
      template_id: "warm-paper-v1",
      layers: [createGuestbookTextLayer({ text: "예전 편지" })],
    });
    expect(legacy.version).toBe(1);
    expect(() => normalizeGuestbookDesign({ ...legacy, signature: null }))
      .toThrow("V1 디자인 형식");
    expect(() => normalizeGuestbookDesign({
      version: 2,
      template_id: "warm-paper-v1",
      layers: legacy.layers,
    })).toThrow("V2 디자인 형식");
  });

  it("supports four templates and normalizes a nullable 24-codepoint signature", () => {
    const draft = createDefaultGuestbookDesign();
    expect(GUESTBOOK_TEMPLATE_OPTIONS.map(({ id }) => id)).toEqual([
      "warm-paper-v1",
      "sage-grid-v1",
      "sky-postcard-v1",
      "rose-confetti-v1",
    ]);
    GUESTBOOK_TEMPLATE_OPTIONS.forEach(({ id }) => {
      expect(normalizeGuestbookDesign({ ...draft, template_id: id }).template_id).toBe(id);
    });

    const normalized = normalizeGuestbookDesign({
      ...draft,
      template_id: "sage-grid-v1",
      signature: "  Ａ\r\n마음\u200b  ",
    });
    expect(normalized).toMatchObject({ version: 2, signature: "A 마음" });
    expect(normalizeGuestbookDesign({ ...draft, signature: " \n " })).toMatchObject({ signature: null });
    expect(() => normalizeGuestbookDesign({
      ...draft,
      signature: "가".repeat(GUESTBOOK_MAX_SIGNATURE_TEXT + 1),
    })).toThrow(`${GUESTBOOK_MAX_SIGNATURE_TEXT}자`);
    expect(() => normalizeGuestbookDesign({
      ...draft,
      layers: [createGuestbookTextLayer({ text: "가".repeat(GUESTBOOK_MAX_TOTAL_TEXT) })],
      signature: "서명",
    })).toThrow(`문구와 서명을 합쳐 ${GUESTBOOK_MAX_TOTAL_TEXT}자`);
    expect(() => normalizeGuestbookDesign({ ...draft, template_id: "remote-image" }))
      .toThrow("편지지");
  });
});

describe("guestbook canvas renderer", () => {
  it("wraps Korean text by grapheme and uses the same design for hit testing", () => {
    const context = contextMock();
    expect(wrapGuestbookText(context, "가나다라마바사", 31)).toEqual(["가나다", "라마바", "사"]);
    const text = createGuestbookTextLayer({
      text: "가나다",
      x: 0.5,
      y: 0.5,
      width: 0.4,
      font_size: 0.1,
      rotation_deg: 32,
    });
    const design = normalizeGuestbookDesign({
      version: 1,
      template_id: "warm-paper-v1",
      layers: [text, createGuestbookStickerLayer("star", { x: 0.8, y: 0.2 })],
    });

    renderGuestbookDesign(context, design);
    expect(context.fillText).toHaveBeenCalled();
    expect(hitTestGuestbookLayer(context, design, { x: 512, y: 320 })).toBe(text.id);
    expect(hitTestGuestbookLayer(context, design, { x: 10, y: 10 })).toBeNull();
  });

  it("keeps a 1024x640 canvas and renders the V2 signature last at bottom-right", () => {
    expect([GUESTBOOK_CANVAS_WIDTH, GUESTBOOK_CANVAS_HEIGHT]).toEqual([1024, 640]);
    const context = contextMock();
    const design = normalizeGuestbookDesign({
      ...createDefaultGuestbookDesign(),
      template_id: "rose-confetti-v1",
      signature: "다정한 산책자",
      layers: [createGuestbookTextLayer({ text: "오늘도 안녕" }), createGuestbookStickerLayer("flower")],
    });
    renderGuestbookDesign(context, design);
    expect(design).toMatchObject({ version: 2, signature: "다정한 산책자" });
    expect(context.fillText).toHaveBeenLastCalledWith(
      "- 다정한 산책자 -",
      0,
      0,
      GUESTBOOK_CANVAS_WIDTH * 0.84,
    );
    expect(context.font).toContain(`300 ${GUESTBOOK_CANVAS_HEIGHT * 0.2}px`);
    expect(context.strokeText).not.toHaveBeenCalledWith(
      "- 다정한 산책자 -",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(context.translate).toHaveBeenLastCalledWith(
      GUESTBOOK_CANVAS_WIDTH * 0.935,
      GUESTBOOK_CANVAS_HEIGHT * 0.9,
    );
  });

  it("draws a natural thumbs-up and the Prometheus P raster asset", async () => {
    await ensureGuestbookSignatureFontReady();
    const context = contextMock();
    const design = normalizeGuestbookDesign({
      ...createDefaultGuestbookDesign(),
      layers: [
        createGuestbookTextLayer({ text: "응원할게요" }),
        createGuestbookStickerLayer("thumbs-up"),
        createGuestbookStickerLayer("prometheus-p"),
      ],
    });

    renderGuestbookDesign(context, design);

    expect(context.fillText).toHaveBeenCalledWith("👍", 0, expect.any(Number));
    expect(context.drawImage).toHaveBeenCalledOnce();
    const [image, x, y, width, height] = vi.mocked(context.drawImage).mock.calls[0];
    expect((image as HTMLImageElement).src).toBe(GUESTBOOK_PROMETHEUS_P_STICKER_SRC);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(x).toBeCloseTo(-Number(width) / 2);
    expect(y).toBeCloseTo(-Number(height) / 2);
  });
});
