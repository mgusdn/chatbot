import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommonsComposer } from "@/components/commons";

afterEach(cleanup);

describe("commons composer Korean IME", () => {
  it("preserves a composing final consonant and trailing spaces until submit", async () => {
    const onSubmit = vi.fn();
    render(<CommonsComposer onSubmit={onSubmit} />);
    const message = screen.getByRole("textbox", { name: "남길 메시지" });

    fireEvent.compositionStart(message);
    fireEvent.change(message, { target: { value: "오늘도 안녀ㄴ" } });

    expect(message).toHaveValue("오늘도 안녀ㄴ");
    expect(Array.from((message as HTMLTextAreaElement).value).at(-1)?.codePointAt(0)).toBe(0x3134);

    fireEvent.change(message, { target: { value: "오늘도 안녕 " } });
    fireEvent.compositionEnd(message, { data: "안녕" });

    expect(message).toHaveValue("오늘도 안녕 ");
    fireEvent.change(message, { target: { value: "오늘도 안녕 반가워요 " } });
    expect(message).toHaveValue("오늘도 안녕 반가워요 ");

    fireEvent.click(screen.getByRole("button", { name: "흔적 남기기" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "guestbook",
        message: "오늘도 안녕 반가워요",
      });
    });
  });
});
