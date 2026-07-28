import { describe, expect, it } from "vitest";
import { resolveGameKey } from "@/lib/gameInput";

describe("resolveGameKey", () => {
  it("uses the physical E key while a Korean IME reports a different key value", () => {
    expect(resolveGameKey({ code: "KeyE", key: "Process" })).toBe("e");
    expect(resolveGameKey({ code: "KeyE", key: "ㄷ" })).toBe("e");
  });

  it("uses the physical placement keys while a Korean IME is active", () => {
    expect(resolveGameKey({ code: "KeyQ", key: "Process" })).toBe("q");
    expect(resolveGameKey({ code: "KeyQ", key: "ㅂ" })).toBe("q");
    expect(resolveGameKey({ code: "KeyR", key: "ㄱ" })).toBe("r");
  });

  it("normalizes movement and modifier keys by physical code", () => {
    expect(resolveGameKey({ code: "KeyW", key: "ㅈ" })).toBe("w");
    expect(resolveGameKey({ code: "ShiftRight", key: "Shift" })).toBe("shift");
  });
});
