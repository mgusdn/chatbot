import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValueSelectionScreen } from "@/components/counseling/ValueSelectionScreen";

describe("value selection", () => {
  afterEach(cleanup);

  it("shows all values and submits exactly five selections", () => {
    const onSubmit = vi.fn();
    const { container } = render(<ValueSelectionScreen busy={false} onSubmit={onSubmit} />);

    expect(container.querySelectorAll("[data-value-page]")).toHaveLength(3);
    expect(container.querySelectorAll('button[aria-pressed="false"]')).toHaveLength(27);

    ["정의", "기쁨", "사랑", "충성심", "외모"].forEach((name) => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    });
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(5);
    expect(screen.getByText("5")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /미학/ }));
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(5);
    expect(screen.getByRole("button", { name: /미학/ })).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByRole("button", { name: "선택 완료하고 상담 시작하기" }));
    expect(onSubmit).toHaveBeenCalledWith([1, 2, 3, 4, 5]);
  });

  it("removes a selected value from the fixed selection tray", () => {
    const { container } = render(<ValueSelectionScreen busy={false} onSubmit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /정의/ }));
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^정의$/ }));
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
  });
});
