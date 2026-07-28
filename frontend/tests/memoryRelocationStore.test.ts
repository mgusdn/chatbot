import { beforeEach, describe, expect, it } from "vitest";
import { evaluateMemoryRelocation } from "@/lib/memoryRelocation";
import {
  resetMemoryRelocationStore,
  useMemoryRelocationStore,
} from "@/store/useMemoryRelocationStore";
import type { RoomMemory } from "@/types/memoryRoom";

const REQUEST_ONE = "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b4";
const REQUEST_TWO = "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b5";
const REQUEST_THREE = "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b6";
const REQUEST_FOUR = "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b7";

function memory(): RoomMemory {
  return {
    id: "memory-owned",
    kind: "story",
    body: "옮겨 둘 방명록",
    design: {
      version: 2,
      template_id: "sage-grid-v1",
      signature: "다정한 여행자",
      layers: [{
        id: "text-1",
        type: "text",
        text: "오늘도 안녕",
        x: 0.5,
        y: 0.45,
        width: 0.7,
        font_size: 0.12,
        font: "round",
        color: "ink",
        align: "center",
        rotation_deg: 0,
      }],
    },
    emotion: "tender",
    card_style: "sage",
    author_alias: "다정한 여행자",
    reaction_count: 0,
    version: 1,
    created_at: "2026-07-23T00:00:00Z",
    updated_at: "2026-07-23T00:00:00Z",
    placement: {
      surface_id: "floor.interior",
      u: 0.4,
      v: 0.6,
      rotation_deg: 12,
      scale: 1.1,
      z_index: 4,
      version: 3,
    },
  };
}

beforeEach(() => {
  resetMemoryRelocationStore();
});

describe("ephemeral memory relocation state", () => {
  it("always generates a backend-compatible UUID request id", () => {
    const requestId = useMemoryRelocationStore.getState().begin(memory());
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("rejects a caller-supplied request id that the backend cannot parse", () => {
    expect(useMemoryRelocationStore.getState().begin(memory(), "not-a-uuid")).toBeNull();
    expect(useMemoryRelocationStore.getState().status).toBe("idle");
  });

  it("captures an immutable visual and original-placement snapshot", () => {
    const source = memory();
    expect(useMemoryRelocationStore.getState().begin(source, REQUEST_ONE)).toBe(REQUEST_ONE);

    const carrying = useMemoryRelocationStore.getState();
    expect(carrying).toMatchObject({
      status: "carrying",
      memoryId: "memory-owned",
      kind: "story",
      cardStyle: "sage",
      emotion: "tender",
      requestId: REQUEST_ONE,
      original: source.placement,
      design: {
        version: 2,
        template_id: "sage-grid-v1",
        signature: "다정한 여행자",
      },
      candidate: null,
      validation: null,
      error: null,
    });
    expect(carrying.original).not.toBe(source.placement);
    expect(carrying.design).not.toBe(source.design);
    expect(carrying.design?.layers).not.toBe(source.design?.layers);

    source.placement.u = 0.9;
    const sourceLayer = source.design?.layers[0];
    if (sourceLayer?.type === "text") sourceLayer.text = "밖에서 바뀐 값";
    expect(useMemoryRelocationStore.getState().original?.u).toBe(0.4);
    const storedLayer = useMemoryRelocationStore.getState().design?.layers[0];
    expect(storedLayer?.type).toBe("text");
    if (storedLayer?.type === "text") expect(storedLayer.text).toBe("오늘도 안녕");
  });

  it("moves through carrying, submitting, retryable error and completion", () => {
    const store = useMemoryRelocationStore.getState();
    store.begin(memory(), REQUEST_TWO);
    const evaluation = evaluateMemoryRelocation(
      { x: 0, z: 0, yaw: 0 },
      { scale: 1.1, zIndex: 5 },
    );

    expect(store.update(evaluation, "stale-request")).toBe(false);
    expect(store.update(evaluation, REQUEST_TWO)).toBe(true);
    expect(useMemoryRelocationStore.getState()).toMatchObject({
      status: "carrying",
      candidate: { placement: { surface_id: "floor.interior", scale: 1.1, z_index: 5 } },
      validation: { valid: true },
    });

    expect(store.setSubmitting(REQUEST_TWO)).toBe(true);
    expect(store.setSubmitting(REQUEST_TWO)).toBe(false);
    expect(store.cancel()).toBe(false);
    expect(store.fail("네트워크 오류", REQUEST_TWO)).toBe(true);
    expect(useMemoryRelocationStore.getState()).toMatchObject({
      status: "error",
      error: "네트워크 오류",
      candidate: { surfaceId: "floor.interior" },
    });

    expect(store.setSubmitting(REQUEST_TWO)).toBe(true);
    expect(store.complete("stale-request")).toBe(false);
    expect(store.complete(REQUEST_TWO)).toBe(true);
    expect(useMemoryRelocationStore.getState()).toMatchObject({
      status: "idle",
      memoryId: null,
      original: null,
      candidate: null,
      requestId: null,
      design: null,
    });
  });

  it("never submits an invalid candidate and can recover after movement", () => {
    const store = useMemoryRelocationStore.getState();
    store.begin(memory(), REQUEST_THREE);
    const blocked = evaluateMemoryRelocation({ x: -5.25, z: 4.35, yaw: 0 });
    const open = evaluateMemoryRelocation({ x: 0, z: 0, yaw: 0 });

    expect(blocked.validation.valid).toBe(false);
    expect(store.update(blocked, REQUEST_THREE)).toBe(true);
    expect(store.setSubmitting(REQUEST_THREE)).toBe(false);
    expect(useMemoryRelocationStore.getState().status).toBe("carrying");

    expect(store.fail("", REQUEST_THREE)).toBe(true);
    expect(useMemoryRelocationStore.getState().error).toContain("다시 시도");
    expect(store.update(open, REQUEST_THREE)).toBe(true);
    expect(useMemoryRelocationStore.getState()).toMatchObject({
      status: "carrying",
      error: null,
      validation: { valid: true },
    });
    expect(store.setSubmitting(REQUEST_THREE)).toBe(true);
  });

  it("cancels without mutating the original and ignores stale session updates", () => {
    const store = useMemoryRelocationStore.getState();
    store.begin(memory(), REQUEST_THREE);
    expect(store.begin(memory(), REQUEST_FOUR)).toBe(REQUEST_FOUR);
    const evaluation = evaluateMemoryRelocation({ x: 0, z: 0, yaw: 0 });

    expect(store.update(evaluation, REQUEST_THREE)).toBe(false);
    expect(useMemoryRelocationStore.getState().candidate).toBeNull();
    expect(store.cancel()).toBe(true);
    expect(store.cancel()).toBe(false);
    expect(useMemoryRelocationStore.getState()).toMatchObject({
      status: "idle",
      memoryId: null,
      original: null,
    });
  });
});
