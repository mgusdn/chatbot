import type { KeepsakeLetter } from "@/types/counseling";

// Each template is a finished artwork. The background, the body phrase, the
// "From. 프바오" signature AND the "To." / "p.s" labels are all printed on the
// PNG in the exhibition's own typefaces. The only things drawn at runtime are
// the two variable values: the nickname and the three hashtags. They are laid
// down immediately after the baked label, on the label's own baseline.
//
// Every coordinate is a ratio of the artwork it belongs to, measured by scanning
// the PNG for the ink of the baked label (its right edge gives the join point,
// its rightmost glyph gives the baseline), so the canvas can be any size.
// Canvases are sized for the 2x3in photo printer at 300dpi.

const PORTRAIT = { width: 600, height: 900 } as const;
const LANDSCAPE = { width: 900, height: 600 } as const;

// Only the variable text is drawn, so these stacks cover the nickname and the
// hashtags. Swapping in 온트 8비트체 / 티티달팽이체 is a one-line change each.
const PIXEL_FONT = 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';
const HAND_FONT = '"Pume Hand Script", "Apple SD Gothic Neo", "Noto Sans KR", cursive';
const HAND_FONT_FAMILY = "Pume Hand Script";

type TextBox = {
  /** left edge of the variable text — just past the baked label, ratio of width */
  x: number;
  /** baseline of the baked label, ratio of height */
  baseline: number;
  /** font size, ratio of height */
  size: number;
  /** widest the first line may run, ratio of width */
  maxWidth: number;
  /** left edge of wrapped lines — the artwork's own text margin, ratio of width */
  continueX?: number;
  /** widest a wrapped line may run, ratio of width */
  continueMaxWidth?: number;
  /** distance between wrapped lines, ratio of height */
  lineGap?: number;
  /** how many lines the reference artwork uses */
  lines?: number;
};

type TemplateLayout = {
  width: number;
  height: number;
  asset: string;
  fallback: string;
  color: string;
  font: string;
  fontFamily?: string;
  weight: number;
  to: TextBox;
  ps: TextBox;
};

const TEMPLATE_LAYOUTS: Record<string, TemplateLayout> = {
  // 피처폰 "메시지 작성". Artwork 353x528; baked "To." ends x=87 baseline y=176,
  // baked "p.s" ends x=86 baseline y=390, text margin x=61.
  featurephone_v1: {
    ...PORTRAIT,
    asset: "/images/keepsake/featurephone-v2.png",
    fallback: "#f2eef2",
    color: "#CB6CE6",
    font: PIXEL_FONT,
    weight: 700,
    to: { x: 0.2635, baseline: 0.3333, size: 0.0316, maxWidth: 0.6431 },
    ps: {
      x: 0.2606,
      baseline: 0.7386,
      size: 0.0316,
      maxWidth: 0.6459,
      continueX: 0.1728,
      continueMaxWidth: 0.7337,
      lineGap: 0.0436,
      lines: 2,
    },
  },
  // 버디버디 메신저. Artwork 353x528; baked "To." ends x=106 baseline y=188,
  // baked "p.s" ends x=106 baseline y=397, text margin x=80.
  buddybuddy_v1: {
    ...PORTRAIT,
    asset: "/images/keepsake/buddybuddy-v3.png",
    fallback: "#eef4e8",
    color: "#149005",
    font: PIXEL_FONT,
    weight: 700,
    to: { x: 0.3176, baseline: 0.3561, size: 0.0319, maxWidth: 0.5949 },
    ps: {
      x: 0.3176,
      baseline: 0.7519,
      size: 0.0319,
      maxWidth: 0.5949,
      continueX: 0.2266,
      continueMaxWidth: 0.6856,
      lineGap: 0.0436,
      lines: 2,
    },
  },
  // 분홍 낙서 편지지. Artwork 528x353 (already landscape); baked "To." ends
  // x=113 baseline y=101, baked "p.s" ends x=106 baseline y=260, margin x=84.
  pink_doodle_v1: {
    ...LANDSCAPE,
    asset: "/images/keepsake/pink-doodle-v2.png",
    fallback: "#fdeaf0",
    color: "#FE3636",
    font: HAND_FONT,
    fontFamily: HAND_FONT_FAMILY,
    weight: 400,
    to: { x: 0.2310, baseline: 0.2861, size: 0.0703, maxWidth: 0.6591 },
    ps: {
      x: 0.2150,
      baseline: 0.7365,
      size: 0.0586,
      maxWidth: 0.6752,
      continueX: 0.1591,
      continueMaxWidth: 0.7311,
      lineGap: 0.0906,
      lines: 1,
    },
  },
  // 노랑 낙서 편지지. Artwork 528x353 (already landscape); baked "To." ends
  // x=114 baseline y=99, baked "p.s" ends x=107 baseline y=256, margin x=85.
  yellow_doodle_v1: {
    ...LANDSCAPE,
    asset: "/images/keepsake/yellow-doodle-v2.png",
    fallback: "#fdf6d8",
    color: "#FE3636",
    font: HAND_FONT,
    fontFamily: HAND_FONT_FAMILY,
    weight: 400,
    to: { x: 0.2332, baseline: 0.2805, size: 0.0714, maxWidth: 0.6572 },
    ps: {
      x: 0.2199,
      baseline: 0.7252,
      size: 0.0714,
      maxWidth: 0.6705,
      continueX: 0.1610,
      continueMaxWidth: 0.7292,
      lineGap: 0.0878,
      lines: 1,
    },
  },
};

const DEFAULT_LAYOUT = TEMPLATE_LAYOUTS.featurephone_v1;
const loadedImages = new Map<string, HTMLImageElement>();
const pendingImages = new Map<string, Promise<HTMLImageElement>>();

export function getLayout(templateId: string) {
  return TEMPLATE_LAYOUTS[templateId] ?? DEFAULT_LAYOUT;
}

function loadImage(source: string) {
  const loaded = loadedImages.get(source);
  if (loaded) return Promise.resolve(loaded);
  const pending = pendingImages.get(source);
  if (pending) return pending;
  if (typeof Image === "undefined") return Promise.reject(new Error("Image API is unavailable"));

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      loadedImages.set(source, image);
      pendingImages.delete(source);
      resolve(image);
    };
    image.onerror = () => {
      pendingImages.delete(source);
      reject(new Error(`편지지 이미지를 불러오지 못했어요: ${source}`));
    };
    image.src = source;
  });
  pendingImages.set(source, promise);
  return promise;
}

/**
 * Greedy space wrap. The first line is short because it starts after the baked
 * label; wrapped lines fall back to the artwork's own text margin, so each line
 * gets its own width budget.
 */
function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  widthOfLine: (index: number) => number,
) {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > widthOfLine(lines.length)) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Shrink until the text fits the reference line count, so a long nickname or a
 * long hashtag set stays inside the artwork instead of spilling over a doodle.
 */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  widthOfLine: (index: number) => number,
  baseSize: number,
  targetLines: number,
  font: string,
  weight: number,
) {
  const minimum = baseSize * 0.68;
  let size = baseSize;
  let lines: string[] = [];
  while (size > minimum) {
    context.font = `${weight} ${size}px ${font}`;
    lines = wrapText(context, text, widthOfLine);
    if (lines.length <= targetLines) break;
    size -= 1;
  }
  if (!lines.length) {
    context.font = `${weight} ${size}px ${font}`;
    lines = wrapText(context, text, widthOfLine);
  }
  // One extra line is tolerable at the floor size; beyond that we would run into
  // the artwork below, so fold the tail back into the last kept line.
  const allowed = targetLines + 1;
  if (lines.length > allowed) {
    lines = [...lines.slice(0, allowed - 1), lines.slice(allowed - 1).join(" ")];
  }
  return { size, lines };
}

/** Variable part of the "To." line — the label itself is printed on the artwork. */
export function recipientText(letter: KeepsakeLetter) {
  const name = (letter.recipient_name || "").trim() || "너";
  return `${name}에게`;
}

/** Variable part of the "p.s" line — the label itself is printed on the artwork. */
export function hashtagText(letter: KeepsakeLetter) {
  return (letter.hashtags || [])
    .slice(0, 3)
    .map((tag) => String(tag).replace(/^#+/, "").trim())
    .filter(Boolean)
    .join(", ");
}

export async function ensureKeepsakeAssetsReady(letter: KeepsakeLetter) {
  const layout = getLayout(letter.template_id);
  const tasks: Promise<unknown>[] = [loadImage(layout.asset)];
  if (typeof document !== "undefined" && document.fonts) {
    if (layout.fontFamily) {
      tasks.push(document.fonts.load(`32px "${layout.fontFamily}"`));
    }
    tasks.push(document.fonts.ready);
  }
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

export function renderKeepsakeLetter(
  context: CanvasRenderingContext2D,
  letter: KeepsakeLetter,
) {
  const layout = getLayout(letter.template_id);
  const width = context.canvas.width;
  const height = context.canvas.height;

  context.save();
  context.fillStyle = layout.fallback;
  context.fillRect(0, 0, width, height);
  const background = loadedImages.get(layout.asset);
  if (background) {
    context.drawImage(background, 0, 0, width, height);
  }

  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = layout.color;

  const draw = (text: string, box: TextBox) => {
    if (!text) return;
    const firstWidth = box.maxWidth * width;
    const restWidth = (box.continueMaxWidth ?? box.maxWidth) * width;
    const fitted = fitText(
      context,
      text,
      (index) => (index === 0 ? firstWidth : restWidth),
      box.size * height,
      box.lines ?? 1,
      layout.font,
      layout.weight,
    );
    context.font = `${layout.weight} ${fitted.size}px ${layout.font}`;
    const gap = (box.lineGap ?? box.size * 1.35) * height;
    const restX = (box.continueX ?? box.x) * width;
    fitted.lines.forEach((line, index) => {
      context.fillText(
        line,
        index === 0 ? box.x * width : restX,
        box.baseline * height + index * gap,
      );
    });
  };

  draw(recipientText(letter), layout.to);
  draw(hashtagText(letter), layout.ps);

  context.restore();
}

export async function createKeepsakeCanvas(letter: KeepsakeLetter) {
  if (typeof document === "undefined") return null;
  await ensureKeepsakeAssetsReady(letter);
  const layout = getLayout(letter.template_id);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  renderKeepsakeLetter(context, letter);
  return canvas;
}
