import { afterEach, describe, expect, it, vi } from "vitest";
import { assignCommonsTracesToAnchors } from "@/components/commons/CommonsTraceField";
import { commonsApi } from "@/lib/api/commonsClient";
import { COMMONS_VISITOR_TOKEN_KEY, readOrCreateCommonsVisitorToken } from "@/lib/storage/commonsOwnership";
import type { CommonsTrace, CommonsTraceAnchor } from "@/types/commons";

function trace(id: string, kind: CommonsTrace["kind"], anchorKey: string): CommonsTrace {
  return {
    id,
    day_key: "2026-07-20",
    kind,
    anchor_key: anchorKey,
    object_kind: kind === "installation" ? "flower" : null,
    message: "오늘의 마음",
    alias: "고요한 판다",
    created_bucket: "오후",
    reaction_count: 0,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("commons API contract", () => {
  it("sends visitor identity and lets the server assign an installation anchor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ trace: trace("trace-1", "installation", "installation-01"), ownership_token: "owner-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await commonsApi.createInstallation("작은 응원", "flower", "visitor-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/commons/installations", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Visitor-Token": "visitor-1" }),
      body: JSON.stringify({ message: "작은 응원", object_kind: "flower" }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("anchor_key");
  });
});

describe("commons trace placement", () => {
  it("reserves exact server anchors and fills only compatible free slots", () => {
    const anchors: CommonsTraceAnchor[] = [
      { id: "today-wall", position: [0, 1, 0], capacity: 2 },
      { id: "installation-01", position: [1, 0, 0] },
      { id: "installation-02", position: [2, 0, 0] },
    ];
    const placements = assignCommonsTracesToAnchors([
      trace("b", "installation", "missing-slot"),
      trace("a", "installation", "installation-01"),
      trace("c", "guestbook", "today-wall"),
    ], anchors);

    expect(Object.fromEntries(placements.map(({ trace: item, anchor }) => [item.id, anchor.id]))).toEqual({
      a: "installation-01",
      b: "installation-02",
      c: "today-wall",
    });
  });
});

describe("commons visitor identity", () => {
  it("reuses one local visitor token", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const first = readOrCreateCommonsVisitorToken(storage);
    expect(readOrCreateCommonsVisitorToken(storage)).toBe(first);
    expect(values.get(COMMONS_VISITOR_TOKEN_KEY)).toBe(first);
  });

  it("replaces a corrupt visitor token that the API would reject", () => {
    const values = new Map<string, string>([[COMMONS_VISITOR_TOKEN_KEY, "short-token"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const token = readOrCreateCommonsVisitorToken(storage);
    expect(token).not.toBe("short-token");
    expect(token.length).toBeGreaterThanOrEqual(20);
  });
});
