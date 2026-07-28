import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorldHud } from "@/components/game/WorldHud";
import { useGameStore } from "@/store/useGameStore";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import {
  resetMemoryRelocationStore,
} from "@/store/useMemoryRelocationStore";

describe("world HUD guestbook placement", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.setState({
      phase: "exploring-interior",
      scene: "interior",
      confirmedCharacterId: "sprout",
    });
    resetMemoryRelocationStore();
    useGuestbookVoucherStore.getState().discard();
  });

  it("describes the live wall candidate and wall-specific Q action", () => {
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_preview: {
        surface_id: "wall.interior.west",
        kind: "wall",
        valid: true,
        invalid_reason: null,
      },
    });

    render(<WorldHud nickname="초록마음" />);

    const voucher = within(screen.getByTestId("guestbook-voucher-hud"));
    expect(voucher.getByText("현재: 상담실 서쪽 벽")).toBeVisible();
    expect(voucher.getByText(/Q 벽에 붙이기/)).toBeVisible();
  });

  it("surfaces wall fixture collisions before Q is pressed", () => {
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_preview: {
        surface_id: "wall.interior.north",
        kind: "wall",
        valid: false,
        invalid_reason: "wall-fixture-collision",
      },
    });

    render(<WorldHud />);

    const voucher = screen.getByTestId("guestbook-voucher-hud");
    expect(voucher).toHaveClass("is-error");
    expect(within(voucher).getByText("벽의 가구나 게시물과 겹쳐요.")).toBeVisible();
  });
});
