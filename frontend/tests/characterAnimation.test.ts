import { describe, expect, it } from "vitest";
import { resolveCharacterAnimationClip } from "@/components/game/characterAnimation";

describe("character animation contract", () => {
  it("resolves exact and case-insensitive authored clips", () => {
    expect(resolveCharacterAnimationClip(["Idle", "Walk"], "Walk", "Idle")).toEqual({
      clip: "Walk",
      requested: "Walk",
      usedIdleFallback: false,
      missingRequested: false,
    });
    expect(resolveCharacterAnimationClip(["IDLE", "walk"], "Walk", "Idle")).toMatchObject({
      clip: "walk",
      missingRequested: false,
    });
  });

  it("uses only the declared idle as a deterministic fallback", () => {
    expect(resolveCharacterAnimationClip(["Dance", "Idle", "Attack"], "Run", "Idle")).toEqual({
      clip: "Idle",
      requested: "Run",
      usedIdleFallback: true,
      missingRequested: true,
    });
  });

  it("never selects a random first clip when the contract is broken", () => {
    expect(resolveCharacterAnimationClip(["Dance", "Attack"], "Run", "Idle")).toEqual({
      clip: null,
      requested: "Run",
      usedIdleFallback: false,
      missingRequested: true,
    });
    expect(resolveCharacterAnimationClip(["Dance"], "Idle", "Idle").clip).toBeNull();
  });
});
