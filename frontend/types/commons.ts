export const COMMONS_MESSAGE_MAX_LENGTH = 60;

export const COMMONS_OBJECT_KINDS = ["flower", "lantern", "book", "stone"] as const;
export type CommonsObjectKind = (typeof COMMONS_OBJECT_KINDS)[number];

export const COMMONS_GUESTBOOK_ANCHOR_KEY = "today-wall";
export const COMMONS_INSTALLATION_ANCHOR_KEYS = Array.from(
  { length: 16 },
  (_, index) => `installation-${String(index + 1).padStart(2, "0")}`,
) as readonly string[];

export type CommonsTraceKind = "guestbook" | "installation";

export type CommonsTrace = {
  id: string;
  day_key: string;
  kind: CommonsTraceKind;
  message: string | null;
  object_kind: CommonsObjectKind | null;
  anchor_key: string;
  alias: string;
  created_bucket: string;
  reaction_count: number;
};

export type CommonsCounts = {
  total: number;
  guestbook: number;
  installation: number;
};

export type CommonsTodayResponse = {
  day_key: string;
  traces: CommonsTrace[];
  counts?: Partial<CommonsCounts>;
};

export type CommonsCreateResponse = {
  trace: CommonsTrace;
  ownership_token: string;
};

export type CommonsReactionResponse = {
  trace_id: string;
  reaction_count: number;
};

export const COMMONS_REPORT_CATEGORIES = ["personal_information", "crisis", "harassment", "spam"] as const;
export type CommonsReportCategory = (typeof COMMONS_REPORT_CATEGORIES)[number];

export type CommonsReportResponse = {
  trace_id: string;
  reported: true;
};

export type CreateGuestbookInput = {
  message: string;
};

export type CreateInstallationInput = {
  message: string;
  object_kind: CommonsObjectKind;
};

export type CommonsComposerSubmission =
  | { kind: "guestbook"; message: string }
  | { kind: "installation"; message: string; object_kind: CommonsObjectKind };

export type CommonsTraceAnchor = {
  id: string;
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number;
  accepts?: readonly CommonsTraceKind[];
  capacity?: number;
  layout?: "single" | "row" | "grid";
  columns?: number;
  spacing?: number;
};

export type CommonsTracePlacement = {
  trace: CommonsTrace;
  anchor: CommonsTraceAnchor;
  slotIndex: number;
  localPosition: [number, number, number];
};

export function isCommonsObjectKind(value: unknown): value is CommonsObjectKind {
  return typeof value === "string" && COMMONS_OBJECT_KINDS.includes(value as CommonsObjectKind);
}

export function countCommonsMessage(message: string) {
  return Array.from(message).length;
}

export function limitCommonsMessage(message: string) {
  return Array.from(message).slice(0, COMMONS_MESSAGE_MAX_LENGTH).join("");
}

export function trimCommonsMessage(message: string) {
  return limitCommonsMessage(message.trim());
}
