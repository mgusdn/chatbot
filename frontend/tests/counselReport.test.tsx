import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CounselReportOverlay, SafeReportContent, parseReportMarkdown } from "@/components/counseling/CounselReportOverlay";
import type { CounselReport } from "@/types/counseling";

const report: CounselReport = {
  id: "safe-report",
  experimentId: "experiment",
  arm: "optimized",
  createdAt: "2026-07-20T00:00:00.000Z",
  markdown: "## 마음 정리\n\n### 1. 지금의 마음\n- **중요한 내용**을 발견했어요.",
  reportFallback: false,
  state: { stage: "done", turn_count: 1, filled_slots: [] },
};

afterEach(cleanup);

describe("counsel report", () => {
  it("parses the fixed report headings and lists", () => {
    expect(parseReportMarkdown(report.markdown)).toEqual([
      { kind: "heading", level: 2, text: "마음 정리" },
      { kind: "heading", level: 3, text: "1. 지금의 마음" },
      { kind: "list", items: [{ text: "**중요한 내용**을 발견했어요.", depth: 0 }] },
    ]);
  });

  it("renders model HTML as inert text instead of injecting it", () => {
    const { container } = render(<SafeReportContent markdown={'### 요약\n- <img src=x onerror="alert(1)"> 안전한 내용'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeVisible();
  });

  it("dismisses from the explicit action", () => {
    const onDismiss = vi.fn();
    render(<CounselReportOverlay report={report} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "확인하고 계속 둘러보기" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("exposes a labelled modal and initially focuses its continue action", () => {
    render(<CounselReportOverlay report={report} onDismiss={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "마음 정리가 도착했어요" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "확인하고 계속 둘러보기" })).toHaveFocus();
  });

  it("dismisses when the paper card itself is clicked", () => {
    const onDismiss = vi.fn();
    render(<CounselReportOverlay report={report} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("counsel-report-card"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismisses from Enter and does not invoke the callback twice", () => {
    const onDismiss = vi.fn();
    render(<CounselReportOverlay report={report} onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus in the paused report surface", () => {
    render(<CounselReportOverlay report={report} onDismiss={vi.fn()} />);
    const action = screen.getByRole("button", { name: "확인하고 계속 둘러보기" });
    action.blur();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(action).toHaveFocus();
  });
});
