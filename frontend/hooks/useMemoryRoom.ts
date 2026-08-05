"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  MemoryRoomApiError,
  memoryRoomApi,
  type MemoryRelocationRequest,
} from "@/lib/api/memoryRoomClient";
import {
  MEMORY_REACTED_KEY,
  MEMORY_REPORTED_KEY,
  addMemoryIdToSet,
  readMemoryIdSet,
  readMemoryOwnership,
  readOrCreateMemoryVisitorToken,
  removeMemoryOwnership,
  writeMemoryOwnership,
  type MemoryOwnershipTokens,
} from "@/lib/storage/memoryRoomOwnership";
import type {
  CreateMemoryInput,
  MemoryPlacementInput,
  MemoryReportCategory,
  MemoryRoom,
  RoomMemory,
} from "@/types/memoryRoom";

export type MemoryRoomStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type MemoryRoomController = {
  room: MemoryRoom | null;
  memories: RoomMemory[];
  status: MemoryRoomStatus;
  error: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
  pendingIds: string[];
  reactedIds: string[];
  reportedIds: string[];
  load: (options?: { append?: boolean }) => Promise<void>;
  createMemory: (input: CreateMemoryInput) => Promise<RoomMemory>;
  moveMemory: (memoryId: string, placement: MemoryPlacementInput) => Promise<RoomMemory>;
  relocateMemory: (memoryId: string, request: MemoryRelocationRequest) => Promise<RoomMemory>;
  deleteMemory: (memoryId: string) => Promise<void>;
  react: (memoryId: string) => Promise<void>;
  report: (memoryId: string, category: MemoryReportCategory) => Promise<void>;
  ownsMemory: (memoryId: string) => boolean;
  clearError: () => void;
};

function storage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function friendlyMemoryRoomError(error: unknown, fallback = "추억방을 불러오지 못했어요.") {
  if (error instanceof MemoryRoomApiError) {
    if (error.status === 403) return "내가 남긴 추억만 옮기거나 지울 수 있어요.";
    if (error.status === 404) return "이미 사라졌거나 찾을 수 없는 추억이에요.";
    if (error.status === 409) return error.message || "다른 곳에서 먼저 변경된 추억이에요.";
    if (error.status === 429) return "잠시 쉬었다가 다시 시도해주세요.";
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function replaceMemory(memories: RoomMemory[], next: RoomMemory) {
  return memories.map((memory) => memory.id === next.id ? next : memory);
}

export function useMemoryRoom(roomSlug = "prometheus"): MemoryRoomController {
  const [room, setRoom] = useState<MemoryRoom | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [status, setStatus] = useState<MemoryRoomStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<MemoryOwnershipTokens>(() => readMemoryOwnership(storage()));
  const [reactedIds, setReactedIds] = useState<string[]>(() => readMemoryIdSet(storage(), MEMORY_REACTED_KEY));
  const [reportedIds, setReportedIds] = useState<string[]>(() => readMemoryIdSet(storage(), MEMORY_REPORTED_KEY));
  const visitorToken = useRef<string | null>(null);
  const requestGeneration = useRef(0);

  const getVisitorToken = useCallback(() => {
    if (!visitorToken.current) visitorToken.current = readOrCreateMemoryVisitorToken(storage());
    return visitorToken.current;
  }, []);

  const markPending = useCallback((memoryId: string, pending: boolean) => {
    setPendingIds((current) => pending
      ? Array.from(new Set([...current, memoryId]))
      : current.filter((id) => id !== memoryId));
  }, []);

  const load = useCallback(async (options: { append?: boolean } = {}) => {
    const append = Boolean(options.append && nextCursor);
    const generation = ++requestGeneration.current;
    if (append) setLoadingMore(true);
    else if (memories.length === 0) setStatus("loading");
    setError(null);
    try {
      const result = await memoryRoomApi.list(roomSlug, { cursor: append ? nextCursor : null, limit: 30 });
      if (generation !== requestGeneration.current) return;
      setRoom(result.room);
      setMemories((current) => append
        ? [...current, ...result.memories.filter((next) => !current.some((item) => item.id === next.id))]
        : result.memories);
      setNextCursor(result.next_cursor);
      const length = append ? memories.length + result.memories.length : result.memories.length;
      setStatus(length > 0 ? "ready" : "empty");
    } catch (caught) {
      if (generation !== requestGeneration.current) return;
      setError(friendlyMemoryRoomError(caught));
      if (!append && memories.length === 0) setStatus("error");
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  }, [memories.length, nextCursor, roomSlug]);

  const createMemory = useCallback(async (input: CreateMemoryInput) => {
    setError(null);
    const result = await memoryRoomApi.create(roomSlug, input, getVisitorToken()).catch((caught) => {
      const message = friendlyMemoryRoomError(caught, "추억을 남기지 못했어요.");
      setError(message);
      throw new Error(message);
    });
    setOwnership(writeMemoryOwnership(storage(), result.memory.id, result.ownership_token));
    setMemories((current) => [result.memory, ...current.filter((item) => item.id !== result.memory.id)]);
    setRoom((current) => current ? { ...current, revision: current.revision + 1 } : current);
    setStatus("ready");
    return result.memory;
  }, [getVisitorToken, roomSlug]);

  const moveMemory = useCallback(async (memoryId: string, placement: MemoryPlacementInput) => {
    const memory = memories.find((item) => item.id === memoryId);
    const ownershipToken = ownership[memoryId];
    if (!memory || !ownershipToken) throw new Error("내가 남긴 추억만 옮길 수 있어요.");
    markPending(memoryId, true);
    setError(null);
    try {
      const moved = await memoryRoomApi.move(
        roomSlug, memoryId, placement, memory.placement.version, ownershipToken, getVisitorToken(),
      );
      setMemories((current) => replaceMemory(current, moved));
      return moved;
    } catch (caught) {
      const message = friendlyMemoryRoomError(caught, "추억의 위치를 옮기지 못했어요.");
      setError(message);
      throw new Error(message);
    } finally {
      markPending(memoryId, false);
    }
  }, [getVisitorToken, markPending, memories, ownership, roomSlug]);

  const relocateMemory = useCallback(async (memoryId: string, request: MemoryRelocationRequest) => {
    const ownershipToken = ownership[memoryId];
    if (!ownershipToken) throw new Error("내가 남긴 추억만 옮길 수 있어요.");
    markPending(memoryId, true);
    setError(null);
    try {
      const moved = await memoryRoomApi.relocate(
        roomSlug,
        memoryId,
        request,
        ownershipToken,
        getVisitorToken(),
      );
      setMemories((current) => replaceMemory(current, moved));
      setRoom((current) => current ? { ...current, revision: current.revision + 1 } : current);
      return moved;
    } catch (caught) {
      setError(friendlyMemoryRoomError(caught, "추억의 위치를 옮기지 못했어요."));
      throw caught;
    } finally {
      markPending(memoryId, false);
    }
  }, [getVisitorToken, markPending, ownership, roomSlug]);

  const deleteMemory = useCallback(async (memoryId: string) => {
    markPending(memoryId, true);
    setError(null);
    try {
      await memoryRoomApi.remove(roomSlug, memoryId);
      setOwnership(removeMemoryOwnership(storage(), memoryId));
      setMemories((current) => {
        const next = current.filter((memory) => memory.id !== memoryId);
        if (next.length === 0) setStatus("empty");
        return next;
      });
    } catch (caught) {
      const message = friendlyMemoryRoomError(caught, "추억을 지우지 못했어요.");
      setError(message);
      throw new Error(message);
    } finally {
      markPending(memoryId, false);
    }
  }, [markPending, roomSlug]);

  const react = useCallback(async (memoryId: string) => {
    if (reactedIds.includes(memoryId) || pendingIds.includes(memoryId)) return;
    markPending(memoryId, true);
    try {
      const result = await memoryRoomApi.react(roomSlug, memoryId, getVisitorToken());
      setMemories((current) => current.map((memory) => memory.id === memoryId
        ? { ...memory, reaction_count: result.reaction_count }
        : memory));
      const next = addMemoryIdToSet(storage(), MEMORY_REACTED_KEY, memoryId);
      setReactedIds(next);
    } catch (caught) {
      const message = friendlyMemoryRoomError(caught, "공감을 전하지 못했어요.");
      setError(message);
      throw new Error(message);
    } finally {
      markPending(memoryId, false);
    }
  }, [getVisitorToken, markPending, pendingIds, reactedIds, roomSlug]);

  const report = useCallback(async (memoryId: string, category: MemoryReportCategory) => {
    if (reportedIds.includes(memoryId) || pendingIds.includes(memoryId)) return;
    markPending(memoryId, true);
    try {
      const result = await memoryRoomApi.report(roomSlug, memoryId, category, getVisitorToken());
      const next = addMemoryIdToSet(storage(), MEMORY_REPORTED_KEY, memoryId);
      setReportedIds(next);
      if (result.moderation_status === "hidden") {
        setMemories((current) => current.filter((memory) => memory.id !== memoryId));
      }
    } catch (caught) {
      const message = friendlyMemoryRoomError(caught, "신고를 접수하지 못했어요.");
      setError(message);
      throw new Error(message);
    } finally {
      markPending(memoryId, false);
    }
  }, [getVisitorToken, markPending, pendingIds, reportedIds, roomSlug]);

  return useMemo(() => ({
    room, memories, status, error, nextCursor, loadingMore, pendingIds, reactedIds, reportedIds,
    load, createMemory, moveMemory, relocateMemory, deleteMemory, react, report,
    ownsMemory: (memoryId: string) => Boolean(ownership[memoryId]),
    clearError: () => setError(null),
  }), [
    room, memories, status, error, nextCursor, loadingMore, pendingIds, reactedIds, reportedIds,
    load, createMemory, moveMemory, relocateMemory, deleteMemory, react, report, ownership,
  ]);
}
