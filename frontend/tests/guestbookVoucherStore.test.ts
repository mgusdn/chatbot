import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultGuestbookDesign,
  createGuestbookTextLayer,
  normalizeGuestbookDesign,
  replaceGuestbookLayer,
} from "@/lib/guestbook";
import {
  GUESTBOOK_VOUCHER_STORAGE_KEY,
  getGuestbookVoucherSubmission,
  useGuestbookVoucherStore,
} from "@/store/useGuestbookVoucherStore";

function designWithText(text: string) {
  const design = createDefaultGuestbookDesign();
  const layer = design.layers[0];
  if (layer.type !== "text") throw new Error("default text layer missing");
  return replaceGuestbookLayer(design, layer.id, { ...layer, text });
}

beforeEach(() => {
  window.localStorage.clear();
  useGuestbookVoucherStore.getState().discard();
});

describe("guestbook voucher store", () => {
  it("owns exactly one voucher through edit, arm, submit, error, and completion", () => {
    const store = useGuestbookVoucherStore.getState();
    store.hydrate(window.localStorage);
    store.beginEditing();
    const first = useGuestbookVoucherStore.getState();
    expect(first.status).toBe("editing");
    expect(first.client_request_id?.length).toBeGreaterThanOrEqual(16);
    expect(first.ownership_token?.length).toBeGreaterThanOrEqual(32);

    store.beginEditing();
    expect(useGuestbookVoucherStore.getState().client_request_id).toBe(first.client_request_id);

    const design = designWithText("오늘 함께 걸어서 좋았어");
    const decorated = normalizeGuestbookDesign({
      ...design,
      template_id: "rose-confetti-v1",
      signature: "다정한 산책자",
    });
    expect(store.arm(decorated)).toBe(true);
    expect(useGuestbookVoucherStore.getState().status).toBe("armed");
    expect(getGuestbookVoucherSubmission(useGuestbookVoucherStore.getState())).toMatchObject({
      design: decorated,
      client_request_id: first.client_request_id,
      ownership_token: first.ownership_token,
    });
    store.setPlacementPreview({
      surface_id: "wall.interior.west",
      kind: "wall",
      valid: true,
      invalid_reason: null,
    });
    expect(useGuestbookVoucherStore.getState().placement_preview).toMatchObject({
      surface_id: "wall.interior.west",
      kind: "wall",
      valid: true,
    });
    expect(window.localStorage.getItem(GUESTBOOK_VOUCHER_STORAGE_KEY))
      .not.toContain("placement_preview");

    expect(store.setSubmitting()).toBe(true);
    expect(store.setSubmitting()).toBe(false);
    store.fail("연결을 다시 확인해주세요.");
    expect(useGuestbookVoucherStore.getState()).toMatchObject({
      status: "error",
      error: "연결을 다시 확인해주세요.",
    });
    expect(getGuestbookVoucherSubmission(useGuestbookVoucherStore.getState())?.design).toEqual(decorated);

    store.complete();
    expect(useGuestbookVoucherStore.getState()).toMatchObject({
      status: "empty",
      design: null,
      placement_preview: null,
    });
    expect(window.localStorage.getItem(GUESTBOOK_VOUCHER_STORAGE_KEY)).toBeNull();
  });

  it("restores an interrupted submission as retryable instead of losing it", () => {
    const store = useGuestbookVoucherStore.getState();
    store.hydrate(window.localStorage);
    store.beginEditing();
    const retryDesign = normalizeGuestbookDesign({
      ...designWithText("다시 놓을 수 있는 편지"),
      template_id: "sky-postcard-v1",
      signature: "다시 온 마음",
    });
    store.arm(retryDesign);
    store.setSubmitting();
    const persisted = window.localStorage.getItem(GUESTBOOK_VOUCHER_STORAGE_KEY);
    expect(persisted).toContain('"submitting"');

    useGuestbookVoucherStore.setState({
      status: "empty",
      design: null,
      client_request_id: null,
      ownership_token: null,
      rotation_offset_deg: 0,
      error: null,
      hydrated: false,
    });
    store.hydrate(window.localStorage);
    expect(useGuestbookVoucherStore.getState().status).toBe("armed");
    expect(useGuestbookVoucherStore.getState().error).toContain("재시도");
    expect(useGuestbookVoucherStore.getState().placement_preview).toBeNull();
    expect(getGuestbookVoucherSubmission(useGuestbookVoucherStore.getState())?.design).toEqual(retryDesign);
  });

  it("restores an exact legacy V1 voucher without upgrading or dropping it", () => {
    const legacy = {
      version: 1 as const,
      template_id: "warm-paper-v1" as const,
      layers: [createGuestbookTextLayer({ text: "오래된 편지도 그대로" })],
    };
    window.localStorage.setItem(GUESTBOOK_VOUCHER_STORAGE_KEY, JSON.stringify({
      version: 1,
      status: "armed",
      design: legacy,
      client_request_id: "request_1234567890",
      ownership_token: "owner_12345678901234567890123456789012",
      rotation_offset_deg: 15,
      error: null,
      updated_at: "2026-07-23T00:00:00.000Z",
    }));

    useGuestbookVoucherStore.getState().hydrate(window.localStorage);
    expect(useGuestbookVoucherStore.getState()).toMatchObject({
      status: "armed",
      design: legacy,
      rotation_offset_deg: 15,
    });
  });

  it("rejects corrupted local state and normalizes whole-letter rotation", () => {
    window.localStorage.setItem(GUESTBOOK_VOUCHER_STORAGE_KEY, JSON.stringify({
      version: 1,
      status: "armed",
      design: { version: 1, template_id: "warm-paper-v1", layers: [], url: "https://bad.test" },
      client_request_id: "request_1234567890",
      ownership_token: "owner_12345678901234567890123456789012",
      rotation_offset_deg: 0,
      error: null,
    }));
    useGuestbookVoucherStore.getState().hydrate(window.localStorage);
    expect(useGuestbookVoucherStore.getState().status).toBe("empty");
    expect(window.localStorage.getItem(GUESTBOOK_VOUCHER_STORAGE_KEY)).toBeNull();

    const store = useGuestbookVoucherStore.getState();
    store.beginEditing();
    store.rotate(195);
    expect(useGuestbookVoucherStore.getState().rotation_offset_deg).toBe(-165);
  });
});
