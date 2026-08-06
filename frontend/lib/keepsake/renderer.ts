import type { KeepsakeLetter } from "@/types/counseling";

export const KEEPSAKE_CANVAS_WIDTH = 1500;
export const KEEPSAKE_CANVAS_HEIGHT = 1000;
export const KEEPSAKE_ASPECT = KEEPSAKE_CANVAS_WIDTH / KEEPSAKE_CANVAS_HEIGHT;

const BODY_FONT = 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';
const SIGNATURE_FONT = '"Pume Hand Script", "Apple SD Gothic Neo", "Noto Sans KR", cursive';

type TextAlign = "left" | "center" | "right";

type TemplateLayout = {
  asset: string;
  fallback: string;
  titleColor: string;
  bodyColor: string;
  metaColor: string;
  shadowColor?: string;
  title: { x: number; y: number; maxWidth: number; align: TextAlign };
  body: {
    x: number;
    y: number;
    maxWidth: number;
    align: TextAlign;
    maxSize: number;
    minSize: number;
    lineHeight: number;
  };
};

const TEMPLATE_LAYOUTS: Record<string, TemplateLayout> = {
  cream_rest_v1: {
    asset: "/images/keepsake/cream-paper.png",
    fallback: "#f4ead1",
    titleColor: "#403a34",
    bodyColor: "#292724",
    metaColor: "#49423a",
    title: { x: 70, y: 92, maxWidth: 980, align: "left" },
    body: { x: 150, y: 286, maxWidth: 1160, align: "left", maxSize: 52, minSize: 38, lineHeight: 1.7 },
  },
  purple_growth_v1: {
    asset: "/images/keepsake/purple-rose.png",
    fallback: "#9d75a9",
    titleColor: "#fff0ad",
    bodyColor: "#fff1b6",
    metaColor: "#ffe69b",
    shadowColor: "rgba(66, 35, 77, 0.3)",
    title: { x: 70, y: 92, maxWidth: 950, align: "left" },
    body: { x: 330, y: 278, maxWidth: 820, align: "left", maxSize: 51, minSize: 37, lineHeight: 1.7 },
  },
  starry_wish_v1: {
    asset: "/images/keepsake/starry-night.png",
    fallback: "#06174f",
    titleColor: "#f7f6e9",
    bodyColor: "#f8f7ea",
    metaColor: "#c6e5ff",
    shadowColor: "rgba(0, 9, 45, 0.75)",
    title: { x: 72, y: 92, maxWidth: 940, align: "left" },
    body: { x: 750, y: 274, maxWidth: 980, align: "center", maxSize: 52, minSize: 38, lineHeight: 1.68 },
  },
  black_effort_v1: {
    asset: "/images/keepsake/black-checker.png",
    fallback: "#171717",
    titleColor: "#f2f2ed",
    bodyColor: "#f5f5ef",
    metaColor: "#deded7",
    shadowColor: "rgba(0, 0, 0, 0.72)",
    title: { x: 72, y: 92, maxWidth: 980, align: "left" },
    body: { x: 150, y: 280, maxWidth: 1120, align: "left", maxSize: 50, minSize: 36, lineHeight: 1.72 },
  },
  red_release_v1: {
    asset: "/images/keepsake/red-floral.png",
    fallback: "#d7482f",
    titleColor: "#ffe69b",
    bodyColor: "#fff2d4",
    metaColor: "#ffe095",
    shadowColor: "rgba(91, 19, 12, 0.28)",
    title: { x: 72, y: 92, maxWidth: 980, align: "left" },
    body: { x: 750, y: 282, maxWidth: 930, align: "center", maxSize: 51, minSize: 37, lineHeight: 1.7 },
  },
};

const DEFAULT_LAYOUT = TEMPLATE_LAYOUTS.purple_growth_v1;
const loadedImages = new Map<string, HTMLImageElement>();
const pendingImages = new Map<string, Promise<HTMLImageElement>>();

function getLayout(templateId: string) {
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
    image.decoding = "async";
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

function fitTextSize(
  context: CanvasRenderingContext2D,
  text: string,
  maximum: number,
  minimum: number,
  maxWidth: number,
  fontWeight = 800,
) {
  let size = maximum;
  while (size > minimum) {
    context.font = `${fontWeight} ${size}px ${BODY_FONT}`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

export async function ensureKeepsakeAssetsReady(letter: KeepsakeLetter) {
  const layout = getLayout(letter.template_id);
  const tasks: Promise<unknown>[] = [loadImage(layout.asset)];
  if (typeof document !== "undefined" && document.fonts) {
    tasks.push(document.fonts.load(`700 48px ${BODY_FONT}`));
    tasks.push(document.fonts.load(`52px "Pume Hand Script"`));
  }
  await Promise.allSettled(tasks);
}

export function renderKeepsakeLetter(
  context: CanvasRenderingContext2D,
  letter: KeepsakeLetter,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const scaleX = width / KEEPSAKE_CANVAS_WIDTH;
  const scaleY = height / KEEPSAKE_CANVAS_HEIGHT;
  const layout = getLayout(letter.template_id);

  context.save();
  context.scale(scaleX, scaleY);
  context.fillStyle = layout.fallback;
  context.fillRect(0, 0, KEEPSAKE_CANVAS_WIDTH, KEEPSAKE_CANVAS_HEIGHT);
  const background = loadedImages.get(layout.asset);
  if (background) {
    context.drawImage(background, 0, 0, KEEPSAKE_CANVAS_WIDTH, KEEPSAKE_CANVAS_HEIGHT);
  }

  context.textBaseline = "alphabetic";
  context.shadowColor = layout.shadowColor ?? "transparent";
  context.shadowBlur = layout.shadowColor ? 5 : 0;
  context.shadowOffsetY = layout.shadowColor ? 2 : 0;

  const titleSize = fitTextSize(context, letter.recipient_label, 43, 28, layout.title.maxWidth, 800);
  context.font = `800 ${titleSize}px ${BODY_FONT}`;
  context.fillStyle = layout.titleColor;
  context.textAlign = layout.title.align;
  context.fillText(letter.recipient_label, layout.title.x, layout.title.y);

  const lines = letter.phrase_text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 5);
  const longest = lines.reduce((current, line) => line.length > current.length ? line : current, "");
  const bodySize = fitTextSize(
    context,
    longest,
    layout.body.maxSize,
    layout.body.minSize,
    layout.body.maxWidth,
    800,
  );
  const lineHeight = bodySize * layout.body.lineHeight;
  context.font = `800 ${bodySize}px ${BODY_FONT}`;
  context.fillStyle = layout.bodyColor;
  context.textAlign = layout.body.align;
  lines.forEach((line, index) => {
    context.fillText(line, layout.body.x, layout.body.y + index * lineHeight);
  });

  const hashtagText = letter.hashtags.slice(0, 3).map((tag) => `#${tag.replace(/^#+/, "")}`).join("  ");
  const hashtagSize = fitTextSize(context, hashtagText, 28, 20, 900, 700);
  context.font = `700 ${hashtagSize}px ${BODY_FONT}`;
  context.fillStyle = layout.metaColor;
  context.textAlign = "left";
  context.fillText(hashtagText, 68, 928);

  context.font = `52px ${SIGNATURE_FONT}`;
  context.fillStyle = layout.metaColor;
  context.textAlign = "right";
  context.fillText(letter.sender_label, 1432, 928);

  context.restore();
}

export async function createKeepsakeCanvas(letter: KeepsakeLetter) {
  if (typeof document === "undefined") return null;
  await ensureKeepsakeAssetsReady(letter);
  const canvas = document.createElement("canvas");
  canvas.width = KEEPSAKE_CANVAS_WIDTH;
  canvas.height = KEEPSAKE_CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return null;
  renderKeepsakeLetter(context, letter);
  return canvas;
}
