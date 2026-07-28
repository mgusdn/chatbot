import { describe, expect, it } from "vitest";
import { INTERIOR_HALF_DEPTH } from "@/constants/interiorLayout";
import { WORLD_CONFIG } from "@/constants/worldConfig";

describe("world camera framing", () => {
  it("uses the elevated overview in both exterior and interior scenes", () => {
    expect(WORLD_CONFIG.cameraOffset).toEqual([0, 12.8, 10]);
    expect(WORLD_CONFIG.interiorCameraOffset).toEqual(WORLD_CONFIG.cameraOffset);
  });

  it("keeps the interior spawn and exit at stable offsets from the expanded south wall", () => {
    expect(WORLD_CONFIG.interiorSpawn).toEqual([0, 0.78, INTERIOR_HALF_DEPTH - 1.3]);
    expect(WORLD_CONFIG.interiorExit).toEqual([0, 0, INTERIOR_HALF_DEPTH - 0.4]);
  });
});
