"use client";

import { create } from "zustand";
import {
  GuestbookDesignError,
  createDefaultGuestbookDesign,
  normalizeGuestbookDesign,
  normalizeGuestbookRotation,
  prepareGuestbookDesign,
  tryNormalizeGuestbookDesign,
} from "@/lib/guestbook";
import type { MemoryRelocationInvalidReason } from "@/lib/memoryRelocation";
import type {
  GuestbookDesign,
  MemoryRelocationSurfaceId,
} from "@/types/memoryRoom";

export const GUESTBOOK_VOUCHER_STORAGE_KEY = "pume.guestbook-voucher.v1";
export const GUESTBOOK_VOUCHER_STORAGE_VERSION = 1 as const;

export type GuestbookVoucherStatus = "empty" | "editing" | "armed" | "submitting" | "error";

export type GuestbookVoucherSubmission = {
  design: GuestbookDesign;
  client_request_id: string;
  ownership_token: string;
  rotation_offset_deg: number;
};

export type GuestbookVoucherPlacementPreview = {
  surface_id: MemoryRelocationSurfaceId;
  kind: "floor" | "wall";
  valid: boolean;
  invalid_reason: MemoryRelocationInvalidReason | null;
};

type StoredGuestbookVoucherV1 = {
  version: typeof GUESTBOOK_VOUCHER_STORAGE_VERSION;
  status: Exclude<GuestbookVoucherStatus, "empty">;
  design: GuestbookDesign;
  client_request_id: string;
  ownership_token: string;
  rotation_offset_deg: number;
  error: string | null;
  updated_at: string;
};

export type GuestbookVoucherState = {
  hydrated: boolean;
  status: GuestbookVoucherStatus;
  design: GuestbookDesign | null;
  client_request_id: string | null;
  ownership_token: string | null;
  rotation_offset_deg: number;
  placement_preview: GuestbookVoucherPlacementPreview | null;
  error: string | null;
  hydrate: (storage?: Storage) => void;
  beginEditing: () => void;
  updateDesign: (design: GuestbookDesign) => boolean;
  arm: (design?: GuestbookDesign) => boolean;
  setSubmitting: () => boolean;
  fail: (message: string) => void;
  complete: () => void;
  discard: () => void;
  rotate: (deltaDeg: number) => void;
  setPlacementPreview: (preview: GuestbookVoucherPlacementPreview | null) => void;
};

const EMPTY_STATE = {
  hydrated: false,
  status: "empty" as const,
  design: null,
  client_request_id: null,
  ownership_token: null,
  rotation_offset_deg: 0,
  placement_preview: null,
  error: null,
};

let persistenceStorage: Storage | undefined;

function browserStorage() {
  if (persistenceStorage) return persistenceStorage;
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function opaqueBytes(size: number) {
  const bytes = new Uint8Array(size);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < size; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  const encoded = typeof btoa === "function"
    ? btoa(binary)
    : Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeClientRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${base64Url(opaqueBytes(18))}`;
}

function makeOwnershipToken() {
  return base64Url(opaqueBytes(32));
}

function clearStoredVoucher() {
  try {
    browserStorage()?.removeItem(GUESTBOOK_VOUCHER_STORAGE_KEY);
  } catch {
    // Storage can be disabled or full; the in-memory voucher remains usable.
  }
}

function persistedSnapshot(state: GuestbookVoucherState): StoredGuestbookVoucherV1 | null {
  if (
    state.status === "empty"
    || !state.design
    || !state.client_request_id
    || !state.ownership_token
  ) return null;
  return {
    version: GUESTBOOK_VOUCHER_STORAGE_VERSION,
    status: state.status,
    design: state.design,
    client_request_id: state.client_request_id,
    ownership_token: state.ownership_token,
    rotation_offset_deg: state.rotation_offset_deg,
    error: state.error,
    updated_at: new Date().toISOString(),
  };
}

function persist(state: GuestbookVoucherState) {
  const snapshot = persistedSnapshot(state);
  if (!snapshot) {
    clearStoredVoucher();
    return;
  }
  try {
    browserStorage()?.setItem(GUESTBOOK_VOUCHER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Keep the active voucher in memory when persistence is unavailable.
  }
}

function validOpaqueValue(value: unknown, minimumLength: number) {
  return typeof value === "string"
    && value.length >= minimumLength
    && value.length <= 160
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function isStrictStoredVoucher(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    "client_request_id",
    "design",
    "error",
    "ownership_token",
    "rotation_offset_deg",
    "status",
    "updated_at",
    "version",
  ].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function readGuestbookVoucherSnapshot(storage?: Storage) {
  try {
    const raw = (storage || browserStorage())?.getItem(GUESTBOOK_VOUCHER_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (
      !isStrictStoredVoucher(value)
      || value.version !== GUESTBOOK_VOUCHER_STORAGE_VERSION
      || !["editing", "armed", "submitting", "error"].includes(String(value.status))
      || !validOpaqueValue(value.client_request_id, 16)
      || !validOpaqueValue(value.ownership_token, 32)
      || typeof value.rotation_offset_deg !== "number"
      || !Number.isFinite(value.rotation_offset_deg)
      || (value.error !== null && (typeof value.error !== "string" || value.error.length > 500))
      || typeof value.updated_at !== "string"
      || !Number.isFinite(Date.parse(value.updated_at))
    ) return null;
    const design = tryNormalizeGuestbookDesign(value.design);
    if (!design) return null;
    const restoredStatus = value.status === "submitting"
      ? "armed"
      : value.status as Exclude<GuestbookVoucherStatus, "empty" | "submitting">;
    const clientRequestId = value.client_request_id as string;
    const ownershipToken = value.ownership_token as string;
    return {
      version: GUESTBOOK_VOUCHER_STORAGE_VERSION,
      status: restoredStatus,
      design,
      client_request_id: clientRequestId,
      ownership_token: ownershipToken,
      rotation_offset_deg: normalizeGuestbookRotation(value.rotation_offset_deg),
      error: value.status === "submitting"
        ? "이전 배치를 다시 확인해주세요. Q를 누르면 안전하게 재시도할 수 있어요."
        : (value.error || null),
      updated_at: typeof value.updated_at === "string" ? value.updated_at : new Date(0).toISOString(),
    } satisfies StoredGuestbookVoucherV1;
  } catch {
    return null;
  }
}

export function getGuestbookVoucherSubmission(
  state: Pick<
    GuestbookVoucherState,
    "status" | "design" | "client_request_id" | "ownership_token" | "rotation_offset_deg"
  >,
): GuestbookVoucherSubmission | null {
  if (
    !["armed", "submitting", "error"].includes(state.status)
    || !state.design
    || !state.client_request_id
    || !state.ownership_token
  ) return null;
  try {
    return {
      design: prepareGuestbookDesign(state.design),
      client_request_id: state.client_request_id,
      ownership_token: state.ownership_token,
      rotation_offset_deg: normalizeGuestbookRotation(state.rotation_offset_deg),
    };
  } catch {
    return null;
  }
}

export const useGuestbookVoucherStore = create<GuestbookVoucherState>((set, get) => {
  const commit = (next: Partial<GuestbookVoucherState>) => {
    set(next);
    persist(get());
  };

  return {
    ...EMPTY_STATE,

    hydrate: (storage) => {
      if (storage) persistenceStorage = storage;
      const snapshot = readGuestbookVoucherSnapshot(storage);
      if (!snapshot) {
        set({ ...EMPTY_STATE, hydrated: true });
        if ((storage || browserStorage())?.getItem(GUESTBOOK_VOUCHER_STORAGE_KEY)) clearStoredVoucher();
        return;
      }
      set({
        hydrated: true,
        status: snapshot.status,
        design: snapshot.design,
        client_request_id: snapshot.client_request_id,
        ownership_token: snapshot.ownership_token,
        rotation_offset_deg: snapshot.rotation_offset_deg,
        placement_preview: null,
        error: snapshot.error,
      });
      persist(get());
    },

    beginEditing: () => {
      const current = get();
      if (current.status === "submitting") return;
      commit({
        status: "editing",
        design: current.design || createDefaultGuestbookDesign(),
        client_request_id: current.client_request_id || makeClientRequestId(),
        ownership_token: current.ownership_token || makeOwnershipToken(),
        placement_preview: null,
        error: null,
      });
    },

    updateDesign: (design) => {
      try {
        commit({ design: normalizeGuestbookDesign(design), error: null });
        return true;
      } catch (error) {
        commit({ error: error instanceof Error ? error.message : "디자인을 저장하지 못했어요." });
        return false;
      }
    },

    arm: (value) => {
      try {
        const design = prepareGuestbookDesign(value || get().design);
        const current = get();
        commit({
          status: "armed",
          design,
          client_request_id: current.client_request_id || makeClientRequestId(),
          ownership_token: current.ownership_token || makeOwnershipToken(),
          placement_preview: null,
          error: null,
        });
        return true;
      } catch (error) {
        commit({
          status: "editing",
          error: error instanceof GuestbookDesignError ? error.message : "방명록 문구를 확인해주세요.",
        });
        return false;
      }
    },

    setSubmitting: () => {
      if (!getGuestbookVoucherSubmission(get()) || get().status === "submitting") return false;
      commit({ status: "submitting", error: null });
      return true;
    },

    fail: (message) => {
      if (get().status === "empty") return;
      commit({
        status: "error",
        error: message.trim() || "방명록을 놓지 못했어요. 다시 시도해주세요.",
      });
    },

    complete: () => {
      set({ ...EMPTY_STATE, hydrated: true });
      clearStoredVoucher();
    },

    discard: () => {
      set({ ...EMPTY_STATE, hydrated: true });
      clearStoredVoucher();
    },

    rotate: (deltaDeg) => {
      if (get().status === "empty" || !Number.isFinite(deltaDeg)) return;
      commit({
        rotation_offset_deg: normalizeGuestbookRotation(get().rotation_offset_deg + deltaDeg),
      });
    },

    setPlacementPreview: (preview) => {
      const current = get().placement_preview;
      if (
        current?.surface_id === preview?.surface_id
        && current?.kind === preview?.kind
        && current?.valid === preview?.valid
        && current?.invalid_reason === preview?.invalid_reason
      ) return;
      // Placement previews are frame-derived and must never be persisted with
      // the voucher. A restored voucher recomputes them from the live player.
      set({ placement_preview: preview });
    },
  };
});
