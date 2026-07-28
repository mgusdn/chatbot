import type {
  CommonsCreateResponse,
  CommonsObjectKind,
  CommonsReactionResponse,
  CommonsReportCategory,
  CommonsReportResponse,
  CommonsTodayResponse,
} from "@/types/commons";

export class CommonsApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CommonsApiError";
    this.status = status;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`.trim();
    try {
      const body = (await response.json()) as {
        detail?: unknown | { message?: unknown };
        message?: unknown;
      };
      const candidate = body.detail ?? body.message;
      if (typeof candidate === "string" && candidate.trim()) detail = candidate;
      if (
        candidate
        && typeof candidate === "object"
        && "message" in candidate
        && typeof candidate.message === "string"
        && candidate.message.trim()
      ) detail = candidate.message;
    } catch {
      // Keep the status text for non-JSON failures.
    }
    throw new CommonsApiError(detail || "요청을 완료하지 못했어요.", response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function tracePath(traceId: string) {
  return `/api/commons/traces/${encodeURIComponent(traceId)}`;
}

export const commonsApi = {
  today: (signal?: AbortSignal) => api<CommonsTodayResponse>("/api/commons/today", { signal }),

  createGuestbook: (message: string, visitorToken: string) =>
    api<CommonsCreateResponse>("/api/commons/guestbook", {
      method: "POST",
      headers: { "X-Visitor-Token": visitorToken },
      body: JSON.stringify({ message }),
    }),

  createInstallation: (message: string, objectKind: CommonsObjectKind, visitorToken: string) =>
    api<CommonsCreateResponse>("/api/commons/installations", {
      method: "POST",
      headers: { "X-Visitor-Token": visitorToken },
      body: JSON.stringify({ message, object_kind: objectKind }),
    }),

  react: (traceId: string, visitorToken: string) =>
    api<CommonsReactionResponse>(`${tracePath(traceId)}/reactions`, {
      method: "POST",
      headers: { "X-Visitor-Token": visitorToken },
      body: "{}",
    }),

  remove: (traceId: string, ownershipToken: string) =>
    api<void>(tracePath(traceId), {
      method: "DELETE",
      headers: { "X-Ownership-Token": ownershipToken },
    }),

  report: (traceId: string, category: CommonsReportCategory) =>
    api<CommonsReportResponse>(`${tracePath(traceId)}/reports`, {
      method: "POST",
      body: JSON.stringify({ category }),
    }),
};
