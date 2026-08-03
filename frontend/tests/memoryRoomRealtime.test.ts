import { describe, expect, it } from "vitest";
import { shouldRefreshMemoryRoom } from "@/hooks/useMemoryRoomRealtime";

describe("memory room realtime revision gate", () => {
  it("refreshes only for a newer safe revision", () => {
    expect(shouldRefreshMemoryRoom(10, 11)).toBe(true);
    expect(shouldRefreshMemoryRoom(10, "12")).toBe(true);
    expect(shouldRefreshMemoryRoom(10, 10)).toBe(false);
    expect(shouldRefreshMemoryRoom(10, 9)).toBe(false);
    expect(shouldRefreshMemoryRoom(10, "invalid")).toBe(false);
  });

  it("accepts the first valid signal before a room snapshot is loaded", () => {
    expect(shouldRefreshMemoryRoom(null, 0)).toBe(true);
    expect(shouldRefreshMemoryRoom(null, -1)).toBe(false);
  });
});
