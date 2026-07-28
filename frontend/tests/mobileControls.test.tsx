import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileControls } from "@/components/game/MobileControls";
import {
  MEMORY_RELOCATION_CANCEL_EVENT,
  MEMORY_RELOCATION_COMMIT_EVENT,
} from "@/lib/memory-room/relocationEvents";
import { evaluateMemoryRelocation } from "@/lib/memoryRelocation";
import { useGameStore } from "@/store/useGameStore";
import {
  resetMemoryRelocationStore,
  useMemoryRelocationStore,
} from "@/store/useMemoryRelocationStore";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import type { RoomMemory } from "@/types/memoryRoom";

describe("mobile controls", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.setState({ phase: "exploring-exterior", scene: "exterior" });
    resetMemoryRelocationStore();
    useGuestbookVoucherStore.getState().discard();
  });

  it("releases a held joystick when the browser loses focus", () => {
    render(<MobileControls />);
    const joystick = screen.getByRole("application", { name: "이동 조이스틱" });
    Object.defineProperty(joystick, "setPointerCapture", { value: vi.fn(), configurable: true });
    vi.spyOn(joystick, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 112,
      bottom: 112,
      width: 112,
      height: 112,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(joystick, { pointerId: 7, clientX: 98, clientY: 56 });
    expect(useGameStore.getState().mobileMove[0]).toBeGreaterThan(0.9);

    fireEvent.blur(window);
    expect(useGameStore.getState().mobileMove).toEqual([0, 0]);
  });

  it("replaces interaction controls with commit and cancel while carrying a memory", () => {
    const source = {
      id: "memory-mobile",
      kind: "story",
      body: "옮길 추억",
      design: null,
      emotion: null,
      card_style: "sage",
      author_alias: "산책자",
      reaction_count: 0,
      version: 1,
      created_at: "2026-07-23T00:00:00Z",
      updated_at: "2026-07-23T00:00:00Z",
      placement: {
        surface_id: "floor.interior",
        u: 0.5,
        v: 0.5,
        rotation_deg: 0,
        scale: 1,
        z_index: 1,
        version: 1,
      },
    } satisfies RoomMemory;
    useGameStore.setState({ phase: "exploring-interior", scene: "interior" });
    const store = useMemoryRelocationStore.getState();
    const requestId = store.begin(source, "0a37c67c-1da5-4783-a278-15e62d914745");
    store.update(evaluateMemoryRelocation({ x: 0, z: 0, yaw: 0 }), requestId || undefined);
    const commit = vi.fn();
    const cancel = vi.fn();
    window.addEventListener(MEMORY_RELOCATION_COMMIT_EVENT, commit);
    window.addEventListener(MEMORY_RELOCATION_CANCEL_EVENT, cancel);

    render(<MobileControls />);
    expect(screen.getByTestId("mobile-interaction-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("mobile-memory-relocation-commit"));
    fireEvent.click(screen.getByTestId("mobile-memory-relocation-cancel"));

    expect(commit).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    window.removeEventListener(MEMORY_RELOCATION_COMMIT_EVENT, commit);
    window.removeEventListener(MEMORY_RELOCATION_CANCEL_EVENT, cancel);
  });

  it("labels a new voucher as a wall attachment and disables floor-only rotation", () => {
    useGameStore.setState({ phase: "exploring-interior", scene: "interior" });
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_preview: {
        surface_id: "wall.interior.west",
        kind: "wall",
        valid: true,
        invalid_reason: null,
      },
    });

    render(<MobileControls />);

    expect(screen.getByTestId("mobile-guestbook-place")).toHaveTextContent("벽에 붙이기");
    expect(screen.getByRole("button", { name: "방명록 왼쪽으로 회전" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "방명록 오른쪽으로 회전" })).toBeDisabled();
    expect(screen.getByTestId("mobile-guestbook-place")).toBeEnabled();
  });

  it("prevents committing an invalid new-voucher wall preview", () => {
    useGameStore.setState({ phase: "exploring-interior", scene: "interior" });
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_preview: {
        surface_id: "wall.interior.north",
        kind: "wall",
        valid: false,
        invalid_reason: "wall-fixture-collision",
      },
    });

    render(<MobileControls />);

    expect(screen.getByTestId("mobile-guestbook-place")).toHaveTextContent("벽에 붙이기");
    expect(screen.getByTestId("mobile-guestbook-place")).toBeDisabled();
  });
});
