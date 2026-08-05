import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestbookLetterEditor, GuestbookLetterEditorModal } from "@/components/guestbook";
import { createDefaultGuestbookDesign } from "@/lib/guestbook";
import { useGuestbookVoucherStore } from "@/store/useGuestbookVoucherStore";
import type { GuestbookDesign } from "@/types/memoryRoom";

function canvasContext(canvas: HTMLCanvasElement) {
  const values: Record<string, unknown> = {
    canvas,
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  };
  return new Proxy(values, {
    get(target, property) {
      if (property in target) return target[property as string];
      const method = vi.fn();
      target[property as string] = method;
      return method;
    },
    set(target, property, value) {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function Harness() {
  const [design, setDesign] = useState<GuestbookDesign>(() => createDefaultGuestbookDesign());
  return <GuestbookLetterEditor design={design} onChange={setDesign} />;
}

class LoadedStickerImage {
  complete = true;
  naturalWidth = 128;
  naturalHeight = 128;
  decoding = "auto";
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  src = "";
}

beforeEach(() => {
  window.localStorage.clear();
  useGuestbookVoucherStore.getState().discard();
  vi.stubGlobal("Image", LoadedStickerImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(this: HTMLCanvasElement) {
    return canvasContext(this);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("guestbook letter editor", () => {
  it("adds and edits multiple text/sticker layers through DOM controls", () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText("마음을 적어주세요."), {
      target: { value: "첫 번째 인사" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ 글씨" }));
    expect(screen.getAllByText(/빈 글씨/)).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText("마음을 적어주세요."), {
      target: { value: "두 번째 마음" },
    });
    fireEvent.click(screen.getByRole("button", { name: "하트 스티커 추가" }));
    expect(screen.getAllByText("하트 스티커")).toHaveLength(2);
    fireEvent.change(screen.getByRole("slider", { name: "요소 회전" }), { target: { value: "27" } });
    expect(screen.getByText("27°")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "맨 뒤로" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.queryAllByText("하트 스티커")).toHaveLength(0);
  });

  it("renders every toolbar sticker as its real artwork instead of a placeholder glyph", () => {
    render(<Harness />);
    const thumbsUp = screen.getByRole("button", { name: "좋아요 스티커 추가" });
    const prometheus = screen.getByRole("button", { name: "프로메테우스 P 스티커 추가" });

    for (const stickerButton of screen.getAllByRole("button", { name: /스티커 추가$/ })) {
      const thumbnail = stickerButton.querySelector("canvas");
      expect(thumbnail).toBeInTheDocument();
      expect(thumbnail).toHaveAttribute("width", "26");
      expect(thumbnail).toHaveAttribute("height", "26");
    }

    fireEvent.click(thumbsUp);
    expect(screen.getAllByText("좋아요 스티커")).toHaveLength(2);
    fireEvent.click(prometheus);
    expect(screen.getAllByText("프로메테우스 P 스티커")).toHaveLength(2);
  });

  it("switches paper templates and normalizes an optional signature on blur", () => {
    render(<Harness />);
    const sage = screen.getByRole("radio", { name: /새잎 모눈/ });
    expect(sage).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sage);
    expect(sage).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/새잎 모눈 방명록 디자인 편집 영역/)).toBeVisible();

    const signature = screen.getByPlaceholderText("다정한 산책자");
    fireEvent.focus(signature);
    fireEvent.change(signature, { target: { value: "  Ａ  마음\u200b  " } });
    expect(signature).toHaveValue("  A  마음  ");
    fireEvent.blur(signature);
    expect(signature).toHaveValue("A 마음");
    expect(screen.getByText("4/24")).toBeVisible();
  });

  it("keeps a trailing space while a multi-word signature is being typed", () => {
    render(<Harness />);
    const signature = screen.getByPlaceholderText("다정한 산책자");
    fireEvent.focus(signature);
    fireEvent.change(signature, { target: { value: "푸른" } });
    fireEvent.change(signature, { target: { value: "푸른 " } });
    expect(signature).toHaveValue("푸른 ");
    fireEvent.change(signature, { target: { value: "푸른 산책자" } });
    expect(signature).toHaveValue("푸른 산책자");
  });

  it("preserves Korean final consonants until signature IME composition ends", () => {
    const onChange = vi.fn();
    render(
      <GuestbookLetterEditor
        design={createDefaultGuestbookDesign()}
        onChange={onChange}
      />,
    );
    const signature = screen.getByPlaceholderText("다정한 산책자");

    fireEvent.focus(signature);
    fireEvent.compositionStart(signature);
    fireEvent.change(signature, { target: { value: "윤지차ㄴ" } });

    expect(signature).toHaveValue("윤지차ㄴ");
    expect(Array.from((signature as HTMLInputElement).value).at(-1)?.codePointAt(0)).toBe(0x3134);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(signature, { target: { value: "윤지찬" } });
    fireEvent.compositionEnd(signature, { data: "윤지찬" });

    expect(signature).toHaveValue("윤지찬");
    expect(screen.getByText("3/24")).toBeVisible();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      version: 2,
      signature: "윤지찬",
    });
  });

  it("preserves Korean final consonants in the letter body until IME composition ends", () => {
    const onChange = vi.fn();
    render(
      <GuestbookLetterEditor
        design={createDefaultGuestbookDesign()}
        onChange={onChange}
      />,
    );
    const message = screen.getByPlaceholderText("마음을 적어주세요.");

    fireEvent.compositionStart(message);
    fireEvent.change(message, { target: { value: "오늘도 안녀ㄴ" } });

    expect(message).toHaveValue("오늘도 안녀ㄴ");
    expect(Array.from((message as HTMLTextAreaElement).value).at(-1)?.codePointAt(0)).toBe(0x3134);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(message, { target: { value: "오늘도 안녕" } });
    fireEvent.compositionEnd(message, { data: "안녕" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].layers[0]).toMatchObject({
      type: "text",
      text: "오늘도 안녕",
    });
  });

  it("supports arrow-key template selection and counts signature in the public text budget", () => {
    render(<Harness />);
    const warm = screen.getByRole("radio", { name: /따뜻한 편지/ });
    const sage = screen.getByRole("radio", { name: /새잎 모눈/ });
    warm.focus();
    fireEvent.keyDown(warm, { key: "ArrowRight" });
    expect(sage).toHaveFocus();
    expect(sage).toHaveAttribute("aria-checked", "true");

    fireEvent.change(screen.getByPlaceholderText("마음을 적어주세요."), {
      target: { value: "가".repeat(176) },
    });
    const signature = screen.getByPlaceholderText("다정한 산책자");
    fireEvent.focus(signature);
    fireEvent.change(signature, { target: { value: "나다라마" } });
    expect(screen.getByText("문구+서명 180/180")).toBeVisible();
  });

  it("keeps keyboard focus inside the modal", async () => {
    render(<GuestbookLetterEditorModal open onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "방명록 편집기 닫기" });
    const lastEnabled = screen.getByRole("button", { name: "초안으로 닫기" });

    lastEnabled.focus();
    fireEvent.keyDown(lastEnabled, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(lastEnabled).toHaveFocus();
  });

  it("does not close the editor when Escape is used during Korean composition", () => {
    const onClose = vi.fn();
    render(<GuestbookLetterEditorModal open onClose={onClose} />);
    const signature = screen.getByPlaceholderText("다정한 산책자");

    fireEvent.keyDown(signature, {
      key: "Escape",
      code: "Escape",
      isComposing: true,
      keyCode: 229,
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(signature, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("arms a valid draft from the store-connected modal", async () => {
    const onClose = vi.fn();
    const onArmed = vi.fn();
    render(<GuestbookLetterEditorModal open onClose={onClose} onArmed={onArmed} />);
    const textarea = await screen.findByPlaceholderText("마음을 적어주세요.");
    fireEvent.change(textarea, { target: { value: "바닥에 남길 다정한 편지" } });
    fireEvent.click(screen.getByRole("radio", { name: /하늘 엽서/ }));
    fireEvent.change(screen.getByPlaceholderText("다정한 산책자"), {
      target: { value: "푸른 산책자" },
    });
    const finish = screen.getByRole("button", { name: "꾸미기 완료" });
    await waitFor(() => expect(finish).toBeEnabled());
    fireEvent.click(finish);

    expect(onClose).toHaveBeenCalledOnce();
    expect(onArmed).toHaveBeenCalledWith(expect.objectContaining({
      version: 2,
      template_id: "sky-postcard-v1",
      signature: "푸른 산책자",
    }));
    expect(useGuestbookVoucherStore.getState()).toMatchObject({
      status: "armed",
      error: null,
    });
  });
});
