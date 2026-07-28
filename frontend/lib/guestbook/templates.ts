import {
  GUESTBOOK_TEMPLATE_IDS_V2,
  type GuestbookTemplateId,
  type GuestbookTemplateIdV2,
} from "@/types/memoryRoom";

export type GuestbookPaperPattern = "ruled" | "grid" | "postcard" | "confetti";

export type GuestbookTemplateDefinition = {
  id: GuestbookTemplateIdV2;
  label: string;
  description: string;
  pattern: GuestbookPaperPattern;
  backgroundStart: string;
  backgroundMiddle: string;
  backgroundEnd: string;
  borderColor: string;
  patternColor: string;
  textHaloColor: string;
  edgeColor: string;
};

export const GUESTBOOK_TEMPLATE_REGISTRY: Record<GuestbookTemplateIdV2, GuestbookTemplateDefinition> = {
  "warm-paper-v1": {
    id: "warm-paper-v1",
    label: "따뜻한 편지",
    description: "크림 종이와 잔잔한 줄",
    pattern: "ruled",
    backgroundStart: "#fff9e9",
    backgroundMiddle: "#f7e9c9",
    backgroundEnd: "#efdbb5",
    borderColor: "rgba(111, 78, 53, 0.28)",
    patternColor: "#b88f68",
    textHaloColor: "rgba(255, 250, 233, 0.86)",
    edgeColor: "#d4bb91",
  },
  "sage-grid-v1": {
    id: "sage-grid-v1",
    label: "새잎 모눈",
    description: "옅은 세이지 모눈과 이중 테두리",
    pattern: "grid",
    backgroundStart: "#f2f6e9",
    backgroundMiddle: "#dde9d2",
    backgroundEnd: "#c9dcc1",
    borderColor: "rgba(62, 91, 67, 0.42)",
    patternColor: "#6f9475",
    textHaloColor: "rgba(244, 249, 238, 0.88)",
    edgeColor: "#a8bea1",
  },
  "sky-postcard-v1": {
    id: "sky-postcard-v1",
    label: "하늘 엽서",
    description: "맑은 하늘색과 우편 테두리",
    pattern: "postcard",
    backgroundStart: "#f0f9fc",
    backgroundMiddle: "#d9eef4",
    backgroundEnd: "#c4e2ec",
    borderColor: "rgba(45, 91, 117, 0.42)",
    patternColor: "#5c91aa",
    textHaloColor: "rgba(243, 251, 253, 0.9)",
    edgeColor: "#9fc5d3",
  },
  "rose-confetti-v1": {
    id: "rose-confetti-v1",
    label: "노을 꽃가루",
    description: "연분홍 종이와 작은 꽃가루",
    pattern: "confetti",
    backgroundStart: "#fff5f1",
    backgroundMiddle: "#f8dedb",
    backgroundEnd: "#efc7c7",
    borderColor: "rgba(128, 68, 78, 0.42)",
    patternColor: "#bd6f7b",
    textHaloColor: "rgba(255, 247, 243, 0.9)",
    edgeColor: "#d6a8aa",
  },
};

export const GUESTBOOK_TEMPLATE_OPTIONS = GUESTBOOK_TEMPLATE_IDS_V2.map(
  (id) => GUESTBOOK_TEMPLATE_REGISTRY[id],
);

export function getGuestbookTemplate(id: GuestbookTemplateId): GuestbookTemplateDefinition {
  return GUESTBOOK_TEMPLATE_REGISTRY[id];
}
