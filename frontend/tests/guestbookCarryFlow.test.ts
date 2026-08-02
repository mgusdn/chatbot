import { describe, expect, it } from "vitest";
import { COMMONS_INTERACTION_ANCHORS } from "@/constants/interiorLayout";
import {
  GUESTBOOK_STATION_PROTECTION_RADIUS,
  hasClearedGuestbookStation,
} from "@/components/game/WorldScene";

describe("guestbook station carry protection", () => {
  const anchor = COMMONS_INTERACTION_ANCHORS.guestbook;

  it("keeps the preview neutral at the station and unlocks after leaving its protection radius", () => {
    expect(hasClearedGuestbookStation({ x: anchor[0], z: anchor[2] })).toBe(false);
    expect(hasClearedGuestbookStation({
      x: anchor[0] + GUESTBOOK_STATION_PROTECTION_RADIUS,
      z: anchor[2],
    })).toBe(false);
    expect(hasClearedGuestbookStation({
      x: anchor[0] + GUESTBOOK_STATION_PROTECTION_RADIUS + 0.01,
      z: anchor[2],
    })).toBe(true);
  });
});
