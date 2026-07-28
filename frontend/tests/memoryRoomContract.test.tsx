import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRoomPanel } from "@/components/memory-room";
import { memorySurfaceLocalPoint } from "@/components/memory-room/MemoryRoomField";
import { useMemoryPlacement } from "@/hooks/useMemoryPlacement";
import type { MemoryRoomController } from "@/hooks/useMemoryRoom";
import { memoryRoomApi } from "@/lib/api/memoryRoomClient";
import {
  MEMORY_OWNERSHIP_KEY,
  MEMORY_VISITOR_TOKEN_KEY,
  readMemoryOwnership,
  readOrCreateMemoryVisitorToken,
  writeMemoryOwnership,
} from "@/lib/storage/memoryRoomOwnership";
import type { CreateMemoryInput, RoomMemory } from "@/types/memoryRoom";

const memory: RoomMemory = {
  id: "memory-1",
  kind: "story",
  body: "서로의 말을 천천히 들어주었던 저녁",
  emotion: "tender",
  card_style: "sage",
  author_alias: "고요한 여행자",
  reaction_count: 2,
  version: 1,
  created_at: "2026-07-22T03:00:00Z",
  updated_at: "2026-07-22T03:00:00Z",
  placement: {
    surface_id: "wall.west",
    u: 0.25,
    v: 0.75,
    rotation_deg: -6,
    scale: 1.1,
    z_index: 3,
    version: 1,
  },
};

const createInput: CreateMemoryInput = {
  kind: "story",
  body: memory.body,
  emotion: "tender",
  card_style: "sage",
  author_alias: null,
  placement: {
    surface_id: "wall.west",
    u: 0.25,
    v: 0.75,
    rotation_deg: -6,
    scale: 1.1,
    z_index: 3,
  },
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("memory room API contract", () => {
  it("creates and moves memories with anonymous and ownership headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ memory, ownership_token: "owner-token-1234567890" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await memoryRoomApi.create("prometheus", createInput, "visitor-token-1234567890");
    await memoryRoomApi.move(
      "prometheus",
      memory.id,
      createInput.placement,
      1,
      "owner-token-1234567890",
      "visitor-token-1234567890",
    );
    await memoryRoomApi.relocate(
      "prometheus",
      memory.id,
      {
        client_request_id: "c6e1866d-3100-4e6c-9227-8413148c72d7",
        expected_version: 1,
        surface_id: "floor.interior",
        u: 0.4,
        v: 0.6,
        rotation_deg: 12,
        scale: 1,
      },
      "owner-token-1234567890",
      "visitor-token-1234567890",
    );

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/memory-rooms/prometheus/memories",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Visitor-Token": "visitor-token-1234567890" }),
        body: JSON.stringify(createInput),
      }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/memory-rooms/prometheus/memories/memory-1/placement",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "X-Ownership-Token": "owner-token-1234567890",
          "X-Visitor-Token": "visitor-token-1234567890",
        }),
        body: JSON.stringify({ ...createInput.placement, expected_version: 1 }),
      }),
    ]);
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/memory-rooms/prometheus/memories/memory-1/relocations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Ownership-Token": "owner-token-1234567890",
          "X-Visitor-Token": "visitor-token-1234567890",
        }),
        body: JSON.stringify({
          client_request_id: "c6e1866d-3100-4e6c-9227-8413148c72d7",
          expected_version: 1,
          surface_id: "floor.interior",
          u: 0.4,
          v: 0.6,
          rotation_deg: 12,
          scale: 1,
        }),
      }),
    ]);
  });
});

describe("memory local identity", () => {
  it("reuses an opaque visitor token and stores owner tokens per memory", () => {
    const first = readOrCreateMemoryVisitorToken(window.localStorage);
    expect(first.length).toBeGreaterThanOrEqual(20);
    expect(readOrCreateMemoryVisitorToken(window.localStorage)).toBe(first);
    expect(window.localStorage.getItem(MEMORY_VISITOR_TOKEN_KEY)).toBe(first);

    writeMemoryOwnership(window.localStorage, memory.id, "owner-token-1234567890");
    expect(readMemoryOwnership(window.localStorage)).toEqual({ [memory.id]: "owner-token-1234567890" });
    expect(JSON.parse(window.localStorage.getItem(MEMORY_OWNERSHIP_KEY) || "{}")).toEqual({
      [memory.id]: "owner-token-1234567890",
    });
  });
});

describe("normalized 3D placement", () => {
  it("maps u/v onto a surface and clamps ghost placement controls", () => {
    expect(memorySurfaceLocalPoint({ size: [4, 2] }, { u: 0.25, v: 0.75, z_index: 3 })).toEqual([
      -1,
      0.5,
      0.01203,
    ]);

    const { result } = renderHook(() => useMemoryPlacement());
    act(() => result.current.begin({ u: 2, scale: 0.1 }));
    expect(result.current.active).toBe(true);
    expect(result.current.value.u).toBe(1);
    expect(result.current.value.scale).toBe(0.75);
    act(() => result.current.placeOnSurface("desk.main", 0.2, 0.8));
    expect(result.current.value).toMatchObject({ surface_id: "desk.main", u: 0.2, v: 0.8 });
    act(() => result.current.finish());
    expect(result.current.active).toBe(false);
  });
});

describe("accessible memory room panel", () => {
  function controller(overrides: Partial<MemoryRoomController> = {}): MemoryRoomController {
    return {
      room: { slug: "prometheus", title: "프로메테우스 추억방", scene_version: 1, theme_id: "prometheus-coast", revision: 1 },
      memories: [memory],
      status: "ready",
      error: null,
      nextCursor: null,
      loadingMore: false,
      pendingIds: [],
      reactedIds: [],
      reportedIds: [],
      load: vi.fn(async () => undefined),
      createMemory: vi.fn(async () => memory),
      moveMemory: vi.fn(async () => memory),
      relocateMemory: vi.fn(async () => memory),
      deleteMemory: vi.fn(async () => undefined),
      react: vi.fn(async () => undefined),
      report: vi.fn(async () => undefined),
      ownsMemory: () => false,
      clearError: vi.fn(),
      ...overrides,
    };
  }

  it("offers a DOM composer and readable album without importing counseling text", async () => {
    const createMemory = vi.fn(async () => memory);
    const shared = controller({ createMemory });
    render(<MemoryRoomPanel controller={shared} autoStart={false} />);

    expect(screen.getByRole("dialog", { name: "프로메테우스 추억방" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("남기고 싶은 말")).toBeVisible();
    expect(screen.getByText("상담 내용은 자동으로 가져오지 않아요.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("남기고 싶은 말"), { target: { value: "오늘 함께 산책한 일을 기억해요" } });
    fireEvent.click(screen.getByRole("button", { name: "이 자리에 추억 남기기" }));
    await waitFor(() => expect(createMemory).toHaveBeenCalledWith(expect.objectContaining({
      kind: "note",
      body: "오늘 함께 산책한 일을 기억해요",
      placement: expect.objectContaining({
        surface_id: "wall.north",
        u: 0.18,
        v: 0.78,
        rotation_deg: -4,
        z_index: 1,
      }),
    })));

    expect(screen.getByText(memory.body)).toBeVisible();
    expect(screen.getByText(memory.author_alias)).toBeVisible();
  });

  it("selects the same memory from the album for the Canvas field", () => {
    const onSelectMemory = vi.fn();
    render(<MemoryRoomPanel controller={controller()} autoStart={false} onSelectMemory={onSelectMemory} selectedMemoryId={memory.id} />);
    fireEvent.click(screen.getByRole("tab", { name: /추억 앨범/ }));
    fireEvent.click(screen.getByRole("button", { name: "공간에서 보기" }));
    expect(onSelectMemory).toHaveBeenCalledWith(memory.id);
  });

  it("hands owned-memory relocation to the world flow without opening placement sliders", () => {
    const onBeginRelocation = vi.fn();
    render(
      <MemoryRoomPanel
        controller={controller({ ownsMemory: () => true })}
        autoStart={false}
        viewerOnly
        selectedMemoryId={memory.id}
        onBeginRelocation={onBeginRelocation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "위치 옮기기" }));
    expect(onBeginRelocation).toHaveBeenCalledWith(memory);
    expect(screen.queryByText("어디에 둘까요?")).not.toBeInTheDocument();
  });
});
