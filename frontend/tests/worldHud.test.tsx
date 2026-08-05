import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorldHud } from "@/components/game/WorldHud";
import { useGameStore } from "@/store/useGameStore";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import {
  resetMemoryRelocationStore,
} from "@/store/useMemoryRelocationStore";
import type { CounselReport } from "@/types/counseling";

describe("world HUD guestbook placement", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.setState({
      phase: "exploring-interior",
      scene: "interior",
      confirmedCharacterId: "cat",
    });
    resetMemoryRelocationStore();
    useGuestbookVoucherStore.getState().discard();
  });

  it("describes the live wall candidate and wall-specific Q action", () => {
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_ready: true,
      placement_preview: {
        surface_id: "wall.interior.west",
        kind: "wall",
        valid: true,
        invalid_reason: null,
      },
    });

    render(<WorldHud />);

    const voucher = within(screen.getByTestId("guestbook-voucher-hud"));
    expect(voucher.getByText("현재: 상담실 서쪽 벽")).toBeVisible();
    expect(voucher.getByText(/Q 벽에 붙이기/)).toBeVisible();
  });

  it("surfaces wall fixture collisions before Q is pressed", () => {
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_ready: true,
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

  it("shows a neutral carry instruction and suppresses the nearby E prompt", () => {
    useGameStore.setState({ nearbyInteractable: "guestbook" });
    useGuestbookVoucherStore.setState({
      status: "armed",
      placement_ready: false,
      placement_preview: null,
    });

    render(<WorldHud />);

    const voucher = within(screen.getByTestId("guestbook-voucher-hud"));
    expect(voucher.getByText("방명록을 들었어요")).toBeVisible();
    expect(voucher.getByText("책상 주변을 벗어나 열린 곳으로 이동해주세요.")).toBeVisible();
    expect(screen.queryByTestId("interaction-prompt")).not.toBeInTheDocument();
  });

  it("hides the reopen-report button when no report has completed yet", () => {
    render(<WorldHud />);
    expect(screen.queryByRole("button", { name: "마음 정리 다시 보기" })).not.toBeInTheDocument();
  });

  it("reopens the last report from the HUD button", () => {
    const report: CounselReport = {
      id: "run-1",
      experimentId: "experiment-1",
      arm: "optimized",
      createdAt: "2026-07-20T00:00:00.000Z",
      markdown: "## 마음 정리\n\n### 1. 지금의 마음\n- 충분히 애썼어요.",
      reportFallback: false,
      state: { stage: "done", turn_count: 12, filled_slots: [], slot_values: {} },
    };
    useGameStore.setState({ lastCounselReport: report });

    render(<WorldHud />);

    fireEvent.click(screen.getByRole("button", { name: "마음 정리 다시 보기" }));
    expect(useGameStore.getState()).toMatchObject({ phase: "report-active", counselReport: report });
  });
});
