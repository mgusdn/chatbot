export const COMMONS_OWNERSHIP_KEY = "pume-village-commons-ownership-v1";
export const COMMONS_VISITOR_TOKEN_KEY = "pume-village-commons-visitor-v1";

export type CommonsOwnershipTokens = Record<string, string>;

type CommonsOwnershipPayload = {
  schemaVersion: 1;
  tokens: CommonsOwnershipTokens;
};

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

function sanitizeTokens(value: unknown): CommonsOwnershipTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([traceId, token]) => traceId.length > 0 && traceId.length <= 128 && typeof token === "string" && token.length > 0 && token.length <= 512,
    ),
  );
}

export function readCommonsOwnership(storage: ReadStorage | undefined): CommonsOwnershipTokens {
  if (!storage) return {};
  try {
    const raw = storage.getItem(COMMONS_OWNERSHIP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<CommonsOwnershipPayload>;
    if (parsed.schemaVersion !== 1) return {};
    return sanitizeTokens(parsed.tokens);
  } catch {
    return {};
  }
}

function persist(storage: WriteStorage | undefined, tokens: CommonsOwnershipTokens) {
  if (!storage) return tokens;
  const payload: CommonsOwnershipPayload = { schemaVersion: 1, tokens };
  try {
    storage.setItem(COMMONS_OWNERSHIP_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in private browsing or quota-limited contexts.
  }
  return tokens;
}

export function writeCommonsOwnershipToken(storage: WriteStorage | undefined, traceId: string, token: string) {
  if (!traceId || !token) return readCommonsOwnership(storage);
  return persist(storage, { ...readCommonsOwnership(storage), [traceId]: token });
}

export function removeCommonsOwnershipToken(storage: WriteStorage | undefined, traceId: string) {
  const tokens = readCommonsOwnership(storage);
  delete tokens[traceId];
  return persist(storage, tokens);
}

function makeVisitorToken() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Fall back to locally generated entropy below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function readOrCreateCommonsVisitorToken(storage: WriteStorage | undefined) {
  if (storage) {
    try {
      const existing = storage.getItem(COMMONS_VISITOR_TOKEN_KEY);
      if (existing && existing.length >= 20 && existing.length <= 128) return existing;
    } catch {
      // Continue with an in-memory token.
    }
  }

  const token = makeVisitorToken();
  try {
    storage?.setItem(COMMONS_VISITOR_TOKEN_KEY, token);
  } catch {
    // The token remains usable for this page even when persistence is blocked.
  }
  return token;
}
