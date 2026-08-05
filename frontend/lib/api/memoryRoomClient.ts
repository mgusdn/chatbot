import type {
  CreateMemoryInput,
  MemoryCreateResponse,
  MemoryKind,
  MemoryListResponse,
  MemoryPlacementInput,
  MemoryReactionResponse,
  MemoryRelocationSurfaceId,
  MemoryReportCategory,
  MemoryReportResponse,
  MemoryRoom,
  RoomMemory,
} from "@/types/memoryRoom";

export class MemoryRoomApiError extends Error {
  status: number;
  currentVersion?: number;

  constructor(message: string, status: number, currentVersion?: number) {
    super(message);
    this.name = "MemoryRoomApiError";
    this.status = status;
    this.currentVersion = currentVersion;
  }
}

export type MemoryRelocationRequest = Omit<MemoryPlacementInput, "surface_id" | "z_index"> & {
  surface_id: MemoryRelocationSurfaceId;
  client_request_id: string;
  expected_version: number;
};

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
    let message = `${response.status} ${response.statusText}`.trim();
    let currentVersion: number | undefined;
    try {
      const body = await response.json() as {
        detail?: string | { message?: unknown; current_version?: unknown };
        message?: unknown;
      };
      const detail = body.detail ?? body.message;
      if (typeof detail === "string" && detail.trim()) message = detail;
      if (detail && typeof detail === "object") {
        if ("message" in detail && typeof detail.message === "string" && detail.message.trim()) {
          message = detail.message;
        }
        if ("current_version" in detail && typeof detail.current_version === "number") {
          currentVersion = detail.current_version;
        }
      }
    } catch {
      // A status-based message remains useful for non-JSON upstream failures.
    }
    throw new MemoryRoomApiError(message || "추억방 요청을 완료하지 못했어요.", response.status, currentVersion);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function roomPath(roomSlug: string) {
  return `/api/memory-rooms/${encodeURIComponent(roomSlug)}`;
}

function memoryPath(roomSlug: string, memoryId: string) {
  return `${roomPath(roomSlug)}/memories/${encodeURIComponent(memoryId)}`;
}

export const memoryRoomApi = {
  room: (roomSlug: string, signal?: AbortSignal) =>
    api<MemoryRoom>(roomPath(roomSlug), { signal }),

  list: (
    roomSlug: string,
    options: { limit?: number; cursor?: string | null; kind?: MemoryKind | null; signal?: AbortSignal } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.kind) query.set("kind", options.kind);
    const suffix = query.size ? `?${query.toString()}` : "";
    return api<MemoryListResponse>(`${roomPath(roomSlug)}/memories${suffix}`, { signal: options.signal });
  },

  get: (roomSlug: string, memoryId: string, signal?: AbortSignal) =>
    api<RoomMemory>(memoryPath(roomSlug, memoryId), { signal }),

  create: (roomSlug: string, input: CreateMemoryInput, visitorToken: string) =>
    api<MemoryCreateResponse>(`${roomPath(roomSlug)}/memories`, {
      method: "POST",
      headers: { "X-Visitor-Token": visitorToken },
      body: JSON.stringify(input),
    }),

  move: (
    roomSlug: string,
    memoryId: string,
    placement: MemoryPlacementInput,
    expectedVersion: number,
    ownershipToken: string,
    visitorToken: string,
  ) => api<RoomMemory>(`${memoryPath(roomSlug, memoryId)}/placement`, {
    method: "PATCH",
    headers: {
      "X-Ownership-Token": ownershipToken,
      "X-Visitor-Token": visitorToken,
    },
    body: JSON.stringify({ ...placement, expected_version: expectedVersion }),
  }),

  relocate: (
    roomSlug: string,
    memoryId: string,
    request: MemoryRelocationRequest,
    ownershipToken: string,
    visitorToken: string,
  ) => api<RoomMemory>(`${memoryPath(roomSlug, memoryId)}/relocations`, {
    method: "POST",
    headers: {
      "X-Ownership-Token": ownershipToken,
      "X-Visitor-Token": visitorToken,
    },
    body: JSON.stringify(request),
  }),

  // Deletion isn't gated by ownership — anyone can clear any guestbook entry.
  remove: (roomSlug: string, memoryId: string) =>
    api<void>(memoryPath(roomSlug, memoryId), { method: "DELETE" }),

  react: (roomSlug: string, memoryId: string, visitorToken: string) =>
    api<MemoryReactionResponse>(`${memoryPath(roomSlug, memoryId)}/reactions`, {
      method: "POST",
      headers: { "X-Visitor-Token": visitorToken },
      body: "{}",
    }),

  report: (
    roomSlug: string,
    memoryId: string,
    category: MemoryReportCategory,
    visitorToken: string,
  ) => api<MemoryReportResponse>(`${memoryPath(roomSlug, memoryId)}/reports`, {
    method: "POST",
    headers: { "X-Visitor-Token": visitorToken },
    body: JSON.stringify({ category }),
  }),
};
