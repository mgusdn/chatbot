import { describe, expect, it } from "vitest";
import {
  createDefaultGuestbookDesign,
  createGuestbookStickerLayer,
  normalizeGuestbookDesign,
} from "@/lib/guestbook";
import { GUESTBOOK_STICKER_IDS, type GuestbookStickerId } from "@/types/memoryRoom";

const NEW_STICKER_IDS = ["thumbs-up", "prometheus-p"] as const satisfies readonly GuestbookStickerId[];

describe("guestbook sticker contract", () => {
  it.each(NEW_STICKER_IDS)("round-trips the bundled %s sticker", (stickerId) => {
    expect(GUESTBOOK_STICKER_IDS).toContain(stickerId);

    const draft = createDefaultGuestbookDesign();
    const normalized = normalizeGuestbookDesign({
      ...draft,
      layers: [
        draft.layers[0],
        createGuestbookStickerLayer(stickerId),
      ],
    });

    expect(normalized.layers[1]).toMatchObject({
      type: "sticker",
      sticker_id: stickerId,
    });
  });
});
