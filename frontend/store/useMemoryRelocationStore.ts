"use client";

import { create } from "zustand";
import type {
  GuestbookDesign,
  MemoryCardStyle,
  MemoryEmotion,
  MemoryKind,
  MemoryPlacement,
  RoomMemory,
} from "@/types/memoryRoom";
import type {
  MemoryRelocationCandidate,
  MemoryRelocationEvaluation,
  MemoryRelocationValidation,
} from "@/lib/memoryRelocation";

export type MemoryRelocationStatus = "idle" | "carrying" | "submitting" | "error";

export type MemoryRelocationState = {
  status: MemoryRelocationStatus;
  memoryId: string | null;
  kind: MemoryKind | null;
  cardStyle: MemoryCardStyle | null;
  emotion: MemoryEmotion | null;
  original: MemoryPlacement | null;
  candidate: MemoryRelocationCandidate | null;
  validation: MemoryRelocationValidation | null;
  requestId: string | null;
  /** Immutable visual snapshot captured when carrying begins. */
  design: GuestbookDesign | null;
  error: string | null;
  begin: (
    memory: Pick<RoomMemory, "id" | "kind" | "card_style" | "emotion" | "design" | "placement">,
    requestId?: string,
  ) => string | null;
  update: (evaluation: MemoryRelocationEvaluation, requestId?: string) => boolean;
  setSubmitting: (requestId?: string) => boolean;
  fail: (message: string, requestId?: string) => boolean;
  complete: (requestId?: string) => boolean;
  cancel: () => boolean;
};

type MemoryRelocationData = Omit<
  MemoryRelocationState,
  "begin" | "update" | "setSubmitting" | "fail" | "complete" | "cancel"
>;

let requestSequence = 0;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  requestSequence += 1;
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    const stamp = Date.now() + requestSequence;
    for (let index = 0; index < 6; index += 1) {
      bytes[index] ^= Math.floor(stamp / (2 ** (index * 8))) & 0xff;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptyRelocationData(): MemoryRelocationData {
  return {
    status: "idle",
    memoryId: null,
    kind: null,
    cardStyle: null,
    emotion: null,
    original: null,
    candidate: null,
    validation: null,
    requestId: null,
    design: null,
    error: null,
  };
}

function cloneDesign(design: GuestbookDesign | null | undefined): GuestbookDesign | null {
  if (!design) return null;
  return {
    ...design,
    layers: design.layers.map((layer) => ({ ...layer })),
  };
}

function cloneCandidate(candidate: MemoryRelocationCandidate): MemoryRelocationCandidate {
  return {
    ...candidate,
    placement: { ...candidate.placement },
    position: [...candidate.position],
    localCenter: [...candidate.localCenter],
    localCorners: candidate.localCorners.map((corner) => [...corner]),
    worldCorners: candidate.worldCorners.map((corner) => [...corner]),
  };
}

function cloneValidation(validation: MemoryRelocationValidation): MemoryRelocationValidation {
  return validation.valid
    ? { valid: true, reason: null, blockerId: null }
    : { valid: false, reason: validation.reason, blockerId: validation.blockerId };
}

function matchesRequest(state: MemoryRelocationState, requestId?: string) {
  return !requestId || state.requestId === requestId;
}

export const useMemoryRelocationStore = create<MemoryRelocationState>((set, get) => ({
  ...emptyRelocationData(),

  begin: (memory, suppliedRequestId) => {
    if (get().status === "submitting") return null;
    const supplied = suppliedRequestId?.trim();
    if (supplied && !UUID_PATTERN.test(supplied)) return null;
    const requestId = supplied || createRequestId();
    set({
      status: "carrying",
      memoryId: memory.id,
      kind: memory.kind,
      cardStyle: memory.card_style,
      emotion: memory.emotion,
      original: { ...memory.placement },
      candidate: null,
      validation: null,
      requestId,
      design: cloneDesign(memory.design),
      error: null,
    });
    return requestId;
  },

  update: (evaluation, requestId) => {
    const current = get();
    if (
      !matchesRequest(current, requestId)
      || !["carrying", "error"].includes(current.status)
      || evaluation.candidate.surfaceId !== evaluation.candidate.placement.surface_id
    ) return false;
    set({
      status: "carrying",
      candidate: cloneCandidate(evaluation.candidate),
      validation: cloneValidation(evaluation.validation),
      error: null,
    });
    return true;
  },

  setSubmitting: (requestId) => {
    const current = get();
    if (
      !matchesRequest(current, requestId)
      || !["carrying", "error"].includes(current.status)
      || !current.candidate
      || !current.validation?.valid
    ) return false;
    set({ status: "submitting", error: null });
    return true;
  },

  fail: (message, requestId) => {
    const current = get();
    if (
      current.status === "idle"
      || !matchesRequest(current, requestId)
    ) return false;
    set({
      status: "error",
      error: message.trim() || "추억의 위치를 옮기지 못했어요. 다시 시도해주세요.",
    });
    return true;
  },

  complete: (requestId) => {
    const current = get();
    if (
      current.status === "idle"
      || !matchesRequest(current, requestId)
    ) return false;
    set(emptyRelocationData());
    return true;
  },

  cancel: () => {
    const current = get();
    if (current.status === "idle" || current.status === "submitting") return false;
    set(emptyRelocationData());
    return true;
  },
}));

/** Test/teardown escape hatch; gameplay should use cancel or complete. */
export function resetMemoryRelocationStore() {
  useMemoryRelocationStore.setState(emptyRelocationData());
}
