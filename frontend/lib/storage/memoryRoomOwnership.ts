export const MEMORY_OWNERSHIP_KEY = "pume-prometheus-memory-ownership-v2";
export const MEMORY_VISITOR_TOKEN_KEY = "pume-prometheus-memory-visitor-v2";
export const MEMORY_REACTED_KEY = "pume-prometheus-memory-reacted-v2";
export const MEMORY_REPORTED_KEY = "pume-prometheus-memory-reported-v2";

export type MemoryOwnershipTokens = Record<string, string>;

function safeParseObject(storage: Storage | undefined, key: string): Record<string, string> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => (
        typeof entry[0] === "string" && typeof entry[1] === "string"
      )),
    );
  } catch {
    return {};
  }
}

function createOpaqueToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  return `memory-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function readOrCreateMemoryVisitorToken(storage?: Storage) {
  if (!storage) return createOpaqueToken();
  try {
    const existing = storage.getItem(MEMORY_VISITOR_TOKEN_KEY);
    if (existing && existing.length >= 20) return existing;
    const token = createOpaqueToken();
    storage.setItem(MEMORY_VISITOR_TOKEN_KEY, token);
    return token;
  } catch {
    return createOpaqueToken();
  }
}

export function readMemoryOwnership(storage?: Storage): MemoryOwnershipTokens {
  return safeParseObject(storage, MEMORY_OWNERSHIP_KEY);
}

export function writeMemoryOwnership(storage: Storage | undefined, memoryId: string, token: string) {
  const next = { ...readMemoryOwnership(storage), [memoryId]: token };
  try { storage?.setItem(MEMORY_OWNERSHIP_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  return next;
}

export function removeMemoryOwnership(storage: Storage | undefined, memoryId: string) {
  const next = readMemoryOwnership(storage);
  delete next[memoryId];
  try { storage?.setItem(MEMORY_OWNERSHIP_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  return next;
}

export function readMemoryIdSet(storage: Storage | undefined, key: string): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function addMemoryIdToSet(storage: Storage | undefined, key: string, memoryId: string) {
  const next = Array.from(new Set([...readMemoryIdSet(storage, key), memoryId])).slice(-500);
  try { storage?.setItem(key, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  return next;
}
