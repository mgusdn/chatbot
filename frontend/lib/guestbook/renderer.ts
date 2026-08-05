import type {
  GuestbookDesign,
  GuestbookDesignLayerV1,
  GuestbookStickerId,
  GuestbookTextColor,
  GuestbookTextLayerV1,
} from "@/types/memoryRoom";
import { normalizeGuestbookDesign } from "./design";
import {
  getGuestbookTemplate,
  type GuestbookTemplateDefinition,
} from "./templates";

export const GUESTBOOK_CANVAS_WIDTH = 1024;
export const GUESTBOOK_CANVAS_HEIGHT = 640;
export const GUESTBOOK_CANVAS_ASPECT = GUESTBOOK_CANVAS_WIDTH / GUESTBOOK_CANVAS_HEIGHT;

const TEXT_COLORS: Record<GuestbookTextColor, string> = {
  ink: "#493a32",
  berry: "#a84f62",
  ocean: "#326f87",
  sun: "#c67b24",
};

const FONT_STACKS = {
  round: '"Arial Rounded MT Bold", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
  display: '"Bagel Fat One", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
} as const;

export const GUESTBOOK_SIGNATURE_FONT_FAMILY = "Pume Hand Script";
const SIGNATURE_FONT_STACK = `"${GUESTBOOK_SIGNATURE_FONT_FAMILY}", "Apple SD Gothic Neo", "Noto Sans KR", cursive`;
export const GUESTBOOK_PROMETHEUS_P_STICKER_SRC = "/images/guestbook/prometheus-p.png";

let prometheusPStickerImage: HTMLImageElement | null = null;
let prometheusPStickerReady: Promise<void> | null = null;

function ensurePrometheusPStickerReady() {
  if (prometheusPStickerReady) return prometheusPStickerReady;
  if (typeof Image === "undefined") return Promise.resolve();
  const image = new Image();
  image.decoding = "async";
  prometheusPStickerImage = image;
  prometheusPStickerReady = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = GUESTBOOK_PROMETHEUS_P_STICKER_SRC;
    if (image.complete) finish();
  });
  return prometheusPStickerReady;
}

function readyPrometheusPSticker() {
  void ensurePrometheusPStickerReady();
  return prometheusPStickerImage?.complete
    && prometheusPStickerImage.naturalWidth > 0
    && prometheusPStickerImage.naturalHeight > 0
    ? prometheusPStickerImage
    : null;
}

export async function ensureGuestbookSignatureFontReady() {
  const fontReady = (async () => {
    if (typeof document === "undefined" || !document.fonts?.load) return;
    try {
      await document.fonts.load(`32px "${GUESTBOOK_SIGNATURE_FONT_FAMILY}"`);
    } catch {
      // The bundled Korean fallback keeps the canvas readable if font loading is unavailable.
    }
  })();
  // This existing readiness gate is consumed by both the editor canvas and
  // Three.js texture. Waiting for the raster sticker here makes both redraw
  // once every renderer asset is available.
  await Promise.all([fontReady, ensurePrometheusPStickerReady()]);
}

export type RenderGuestbookDesignOptions = {
  width?: number;
  height?: number;
  clear?: boolean;
};

export type GuestbookLayerPixelRect = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotationDeg: number;
};

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function graphemes(text: string) {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

/** Wraps Korean and mixed text without splitting surrogate pairs or graphemes. */
export function wrapGuestbookText(
  context: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const token of graphemes(paragraph)) {
      const candidate = current + token;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current.trimEnd());
        current = token.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

function textMetrics(
  context: CanvasRenderingContext2D,
  layer: GuestbookTextLayerV1,
  width: number,
  height: number,
) {
  const fontSize = Math.max(1, layer.font_size * height);
  context.font = `800 ${fontSize}px ${FONT_STACKS[layer.font]}`;
  const boxWidth = Math.max(1, layer.width * width);
  const lines = wrapGuestbookText(context, layer.text, boxWidth);
  const lineHeight = fontSize * 1.18;
  return {
    fontSize,
    boxWidth,
    lines,
    lineHeight,
    boxHeight: Math.max(lineHeight, lines.length * lineHeight),
  };
}

export function getGuestbookLayerPixelRect(
  context: CanvasRenderingContext2D,
  layer: GuestbookDesignLayerV1,
  width = GUESTBOOK_CANVAS_WIDTH,
  height = GUESTBOOK_CANVAS_HEIGHT,
): GuestbookLayerPixelRect {
  if (layer.type === "sticker") {
    const size = Math.max(1, layer.width * width);
    return {
      centerX: layer.x * width,
      centerY: layer.y * height,
      width: size,
      height: size,
      rotationDeg: layer.rotation_deg,
    };
  }
  const metrics = textMetrics(context, layer, width, height);
  return {
    centerX: layer.x * width,
    centerY: layer.y * height,
    width: metrics.boxWidth,
    height: metrics.boxHeight,
    rotationDeg: layer.rotation_deg,
  };
}

export function hitTestGuestbookLayer(
  context: CanvasRenderingContext2D,
  design: GuestbookDesign,
  point: { x: number; y: number },
  width = GUESTBOOK_CANVAS_WIDTH,
  height = GUESTBOOK_CANVAS_HEIGHT,
) {
  for (let index = design.layers.length - 1; index >= 0; index -= 1) {
    const layer = design.layers[index];
    const bounds = getGuestbookLayerPixelRect(context, layer, width, height);
    const radians = -bounds.rotationDeg * Math.PI / 180;
    const dx = point.x - bounds.centerX;
    const dy = point.y - bounds.centerY;
    const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
    const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
    const padding = 10;
    if (
      Math.abs(localX) <= bounds.width / 2 + padding
      && Math.abs(localY) <= bounds.height / 2 + padding
    ) return layer.id;
  }
  return null;
}

function drawHeart(context: CanvasRenderingContext2D, size: number) {
  const s = size / 2;
  context.beginPath();
  context.moveTo(0, s * 0.76);
  context.bezierCurveTo(-s * 1.15, s * 0.08, -s * 0.95, -s * 0.8, -s * 0.38, -s * 0.72);
  context.bezierCurveTo(-s * 0.12, -s * 0.7, 0, -s * 0.48, 0, -s * 0.35);
  context.bezierCurveTo(0, -s * 0.48, s * 0.12, -s * 0.7, s * 0.38, -s * 0.72);
  context.bezierCurveTo(s * 0.95, -s * 0.8, s * 1.15, s * 0.08, 0, s * 0.76);
  context.closePath();
  context.fillStyle = "#e86f7f";
  context.fill();
  context.lineWidth = Math.max(2, size * 0.045);
  context.strokeStyle = "#a74357";
  context.stroke();
}

function drawStarPath(context: CanvasRenderingContext2D, outer: number, inner: number, points = 5) {
  context.beginPath();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + index * Math.PI / points;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function drawThumbsUp(context: CanvasRenderingContext2D, size: number) {
  context.font = `${Math.max(1, size * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("👍", 0, size * 0.035);
}

function drawPrometheusP(context: CanvasRenderingContext2D, size: number) {
  const image = readyPrometheusPSticker();
  if (image) {
    const aspect = image.naturalWidth / image.naturalHeight;
    const drawWidth = aspect >= 1 ? size : size * aspect;
    const drawHeight = aspect >= 1 ? size / aspect : size;
    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    return;
  }
  // A compact placeholder avoids a blank layer during the first frame. The
  // renderer readiness promise triggers a redraw with the raster immediately.
  context.font = `700 ${Math.max(1, size * 0.7)}px ${FONT_STACKS.round}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#6b5042";
  context.fillText("P", 0, size * 0.025);
}

export function drawSticker(context: CanvasRenderingContext2D, stickerId: GuestbookStickerId, size: number) {
  const s = size / 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  if (stickerId === "heart") {
    drawHeart(context, size);
    return;
  }
  if (stickerId === "sparkle") {
    drawStarPath(context, s * 0.9, s * 0.18, 4);
    context.fillStyle = "#f6c84f";
    context.fill();
    context.strokeStyle = "#bd8427";
    context.lineWidth = Math.max(2, size * 0.045);
    context.stroke();
    return;
  }
  if (stickerId === "star") {
    drawStarPath(context, s * 0.92, s * 0.43);
    context.fillStyle = "#f4c95d";
    context.fill();
    context.strokeStyle = "#c78a2c";
    context.lineWidth = Math.max(2, size * 0.04);
    context.stroke();
    return;
  }
  if (stickerId === "leaf") {
    context.beginPath();
    context.moveTo(-s * 0.76, s * 0.5);
    context.bezierCurveTo(-s * 0.65, -s * 0.72, s * 0.56, -s * 0.86, s * 0.72, -s * 0.62);
    context.bezierCurveTo(s * 0.82, s * 0.35, -s * 0.18, s * 0.83, -s * 0.76, s * 0.5);
    context.closePath();
    context.fillStyle = "#73a86a";
    context.fill();
    context.strokeStyle = "#3d7453";
    context.lineWidth = Math.max(2, size * 0.04);
    context.stroke();
    context.beginPath();
    context.moveTo(-s * 0.66, s * 0.45);
    context.lineTo(s * 0.58, -s * 0.52);
    context.stroke();
    return;
  }
  if (stickerId === "flower") {
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3;
      context.beginPath();
      context.ellipse(
        Math.cos(angle) * s * 0.48,
        Math.sin(angle) * s * 0.48,
        s * 0.34,
        s * 0.23,
        angle,
        0,
        Math.PI * 2,
      );
      context.fillStyle = index % 2 ? "#f5a6b6" : "#ef849b";
      context.fill();
    }
    context.beginPath();
    context.arc(0, 0, s * 0.25, 0, Math.PI * 2);
    context.fillStyle = "#f4c95d";
    context.fill();
    return;
  }
  if (stickerId === "smile") {
    context.beginPath();
    context.arc(0, 0, s * 0.82, 0, Math.PI * 2);
    context.fillStyle = "#f6cf65";
    context.fill();
    context.strokeStyle = "#a96d2c";
    context.lineWidth = Math.max(2, size * 0.04);
    context.stroke();
    context.fillStyle = "#5b4435";
    [-0.3, 0.3].forEach((x) => {
      context.beginPath();
      context.arc(s * x, -s * 0.18, s * 0.085, 0, Math.PI * 2);
      context.fill();
    });
    context.beginPath();
    context.arc(0, s * 0.05, s * 0.42, 0.12 * Math.PI, 0.88 * Math.PI);
    context.stroke();
    return;
  }
  if (stickerId === "speech") {
    roundedRect(context, -s * 0.86, -s * 0.62, s * 1.72, s * 1.15, s * 0.24);
    context.fillStyle = "#f7f0df";
    context.fill();
    context.strokeStyle = "#6d8292";
    context.lineWidth = Math.max(2, size * 0.04);
    context.stroke();
    context.beginPath();
    context.moveTo(-s * 0.42, s * 0.5);
    context.lineTo(-s * 0.58, s * 0.84);
    context.lineTo(-s * 0.12, s * 0.54);
    context.fillStyle = "#f7f0df";
    context.fill();
    context.stroke();
    return;
  }
  if (stickerId === "thumbs-up") {
    drawThumbsUp(context, size);
    return;
  }
  if (stickerId === "prometheus-p") {
    drawPrometheusP(context, size);
    return;
  }
  // paw
  context.fillStyle = "#9b735f";
  context.beginPath();
  context.ellipse(0, s * 0.3, s * 0.45, s * 0.36, 0, 0, Math.PI * 2);
  context.fill();
  [
    [-0.48, -0.22],
    [-0.17, -0.48],
    [0.17, -0.48],
    [0.48, -0.22],
  ].forEach(([x, y]) => {
    context.beginPath();
    context.ellipse(s * x, s * y, s * 0.18, s * 0.23, 0, 0, Math.PI * 2);
    context.fill();
  });
}

function drawRuledPattern(
  context: CanvasRenderingContext2D,
  template: GuestbookTemplateDefinition,
  width: number,
  height: number,
) {
  context.save();
  context.globalAlpha = 0.12;
  context.strokeStyle = template.patternColor;
  context.lineWidth = Math.max(1, width / 900);
  for (let y = height * 0.18; y < height * 0.9; y += height * 0.105) {
    context.beginPath();
    context.moveTo(width * 0.07, y);
    context.lineTo(width * 0.93, y);
    context.stroke();
  }
  context.restore();
}

function drawGridPattern(
  context: CanvasRenderingContext2D,
  template: GuestbookTemplateDefinition,
  width: number,
  height: number,
) {
  context.save();
  context.globalAlpha = 0.13;
  context.strokeStyle = template.patternColor;
  context.lineWidth = Math.max(1, width / 1100);
  const gap = height * 0.09;
  for (let x = width * 0.06; x < width * 0.95; x += gap) {
    context.beginPath();
    context.moveTo(x, height * 0.06);
    context.lineTo(x, height * 0.94);
    context.stroke();
  }
  for (let y = height * 0.08; y < height * 0.94; y += gap) {
    context.beginPath();
    context.moveTo(width * 0.04, y);
    context.lineTo(width * 0.96, y);
    context.stroke();
  }
  context.restore();
}

function drawPostcardPattern(
  context: CanvasRenderingContext2D,
  template: GuestbookTemplateDefinition,
  width: number,
  height: number,
) {
  context.save();
  context.globalAlpha = 0.18;
  context.strokeStyle = template.patternColor;
  context.lineWidth = Math.max(2, width / 350);
  context.setLineDash([width * 0.018, width * 0.012]);
  roundedRect(context, width * 0.035, height * 0.055, width * 0.93, height * 0.89, width * 0.018);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(width * 0.865, height * 0.17, height * 0.055, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(width * 0.79, height * 0.25);
  context.lineTo(width * 0.93, height * 0.25);
  context.moveTo(width * 0.81, height * 0.285);
  context.lineTo(width * 0.93, height * 0.285);
  context.stroke();
  context.restore();
}

function drawConfettiPattern(
  context: CanvasRenderingContext2D,
  template: GuestbookTemplateDefinition,
  width: number,
  height: number,
) {
  const dots = [
    [0.08, 0.13, 0.012], [0.13, 0.08, 0.008], [0.91, 0.13, 0.01],
    [0.86, 0.08, 0.007], [0.1, 0.86, 0.009], [0.16, 0.91, 0.006],
    [0.9, 0.86, 0.011], [0.84, 0.92, 0.007],
  ] as const;
  context.save();
  context.globalAlpha = 0.34;
  context.fillStyle = template.patternColor;
  dots.forEach(([x, y, radius]) => {
    context.beginPath();
    context.arc(x * width, y * height, radius * height, 0, Math.PI * 2);
    context.fill();
  });
  context.strokeStyle = template.patternColor;
  context.lineWidth = Math.max(2, width / 430);
  context.setLineDash([width * 0.009, width * 0.01]);
  roundedRect(context, width * 0.026, height * 0.042, width * 0.948, height * 0.916, width * 0.025);
  context.stroke();
  context.setLineDash([]);
  context.restore();
}

function drawPaper(
  context: CanvasRenderingContext2D,
  template: GuestbookTemplateDefinition,
  width: number,
  height: number,
) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, template.backgroundStart);
  gradient.addColorStop(0.55, template.backgroundMiddle);
  gradient.addColorStop(1, template.backgroundEnd);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (template.pattern === "ruled") drawRuledPattern(context, template, width, height);
  if (template.pattern === "grid") drawGridPattern(context, template, width, height);
  if (template.pattern === "postcard") drawPostcardPattern(context, template, width, height);
  if (template.pattern === "confetti") drawConfettiPattern(context, template, width, height);

  context.save();
  context.strokeStyle = template.borderColor;
  context.lineWidth = Math.max(2, width / 260);
  roundedRect(context, width * 0.018, height * 0.028, width * 0.964, height * 0.944, width * 0.025);
  context.stroke();
  if (template.pattern === "grid") {
    context.lineWidth = Math.max(1, width / 640);
    roundedRect(context, width * 0.029, height * 0.045, width * 0.942, height * 0.91, width * 0.019);
    context.stroke();
  }
  context.restore();
}

function drawTextLayer(
  context: CanvasRenderingContext2D,
  layer: GuestbookTextLayerV1,
  template: GuestbookTemplateDefinition,
  width: number,
  height: number,
) {
  const metrics = textMetrics(context, layer, width, height);
  if (!metrics.lines.length) return;
  context.save();
  context.translate(layer.x * width, layer.y * height);
  context.rotate(layer.rotation_deg * Math.PI / 180);
  context.font = `800 ${metrics.fontSize}px ${FONT_STACKS[layer.font]}`;
  context.textAlign = layer.align;
  context.textBaseline = "middle";
  context.fillStyle = TEXT_COLORS[layer.color];
  context.strokeStyle = template.textHaloColor;
  context.lineWidth = Math.max(2, metrics.fontSize * 0.075);
  const textX = layer.align === "left"
    ? -metrics.boxWidth / 2
    : layer.align === "right"
      ? metrics.boxWidth / 2
      : 0;
  const firstY = -(metrics.lines.length - 1) * metrics.lineHeight / 2;
  metrics.lines.forEach((line, index) => {
    const lineY = firstY + index * metrics.lineHeight;
    context.strokeText(line, textX, lineY, metrics.boxWidth);
    context.fillText(line, textX, lineY, metrics.boxWidth);
  });
  context.restore();
}

function drawSignature(
  context: CanvasRenderingContext2D,
  signature: string,
  width: number,
  height: number,
) {
  const fontSize = Math.max(48, height * 0.2);
  const displaySignature = `- ${signature} -`;
  context.save();
  context.translate(width * 0.935, height * 0.9);
  context.rotate(-2.5 * Math.PI / 180);
  context.font = `300 ${fontSize}px ${SIGNATURE_FONT_STACK}`;
  context.textAlign = "right";
  context.textBaseline = "alphabetic";
  context.fillStyle = TEXT_COLORS.ink;
  const maxWidth = width * 0.84;
  context.fillText(displaySignature, 0, 0, maxWidth);
  context.restore();
}

export function renderGuestbookDesign(
  context: CanvasRenderingContext2D,
  value: GuestbookDesign,
  options: RenderGuestbookDesignOptions = {},
) {
  const design = normalizeGuestbookDesign(value);
  const width = options.width ?? context.canvas.width ?? GUESTBOOK_CANVAS_WIDTH;
  const height = options.height ?? context.canvas.height ?? GUESTBOOK_CANVAS_HEIGHT;
  const template = getGuestbookTemplate(design.template_id);
  if (options.clear !== false) context.clearRect(0, 0, width, height);
  drawPaper(context, template, width, height);
  design.layers.forEach((layer) => {
    if (layer.type === "text") {
      drawTextLayer(context, layer, template, width, height);
      return;
    }
    context.save();
    context.translate(layer.x * width, layer.y * height);
    context.rotate(layer.rotation_deg * Math.PI / 180);
    drawSticker(context, layer.sticker_id, Math.max(1, layer.width * width));
    context.restore();
  });
  if (design.version === 2 && design.signature) {
    drawSignature(context, design.signature, width, height);
  }
}

export function createGuestbookDesignCanvas(
  design: GuestbookDesign,
  width = GUESTBOOK_CANVAS_WIDTH,
  height = GUESTBOOK_CANVAS_HEIGHT,
) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  renderGuestbookDesign(context, design, { width, height });
  return canvas;
}
