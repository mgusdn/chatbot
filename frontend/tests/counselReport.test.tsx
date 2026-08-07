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

const keepsakePayload = {
  share_token: "safe-token_123",
  expires_at: "2026-08-05T13:30:00.000Z",
  letter: {
    id: "letter-1",
    recipient_name: "구름",
    recipient_modifier: "소원을 품고 걸어가는",
    recipient_label: "구름에게",
    phrase_id: "own_pace",
    phrase_text: "너의 속도를 믿어줘.",
    hashtags: ["나만의속도", "방향찾기", "한걸음씩"],
    sender_name: "프바오",
    sender_label: "프바오",
    template_id: "pink_doodle_v1",
    template_version: 1,
    orientation: "landscape",
    created_at: "2026-08-05T13:00:00.000Z",
    expires_at: "2026-08-05T13:30:00.000Z",
  },
};

/** Routes the keepsake create call and the LAN probe to separate payloads. */
function stubKeepsakeFetch(lanOrigin: { origin: string | null; addresses: string[] } | null) {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    if (String(input).includes("/api/lan-origin")) {
      if (!lanOrigin) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => lanOrigin };
    }
    return { ok: true, json: async () => keepsakePayload };
  }));
}

const realLocation = window.location;

/** jsdom pins the origin at environment setup, so swap the whole object. */
function stubOrigin(origin: string) {
  const url = new URL(origin);
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...realLocation,
      origin: url.origin,
      href: `${url.origin}/`,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: realLocation });
});

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
    // Sections start collapsed; open it before checking the rendered text.
    fireEvent.click(screen.getByRole("button", { name: "요약" }));
    expect(screen.getByText(/<img src=x/)).toBeVisible();
  });

  it("shows the closing hashtag line unhidden, without a section toggle", () => {
    render(
      <SafeReportContent
        markdown={"### 1. 지금의 마음\n- 내용\n\n### 2. 바람\n- 내용\n\n#키워드하나 #키워드둘"}
      />,
    );

    // Not gated behind any button/toggle.
    expect(screen.getByText("#키워드하나 #키워드둘")).toBeVisible();
    // And not left stuck inside section 2's collapsed body.
    fireEvent.click(screen.getByRole("button", { name: "2. 바람" }));
    const section2Body = screen.getByRole("button", { name: "2. 바람" }).parentElement;
    expect(section2Body).not.toHaveTextContent("#키워드하나");
  });

  it("expands a section on click instead of dismissing the report", () => {
    const onDismiss = vi.fn();
    render(<CounselReportOverlay report={report} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "1. 지금의 마음" }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByText(/중요한 내용/)).toBeInTheDocument();
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

  it("does not dismiss from a stray click on the card, only the explicit action", () => {
    const onDismiss = vi.fn();
    render(<CounselReportOverlay report={report} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("counsel-report-card"));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "확인하고 계속 둘러보기" }));
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

  it("creates a short-lived keepsake link and renders its QR without dismissing the report", async () => {
    stubKeepsakeFetch(null);
    const onDismiss = vi.fn();
    render(<CounselReportOverlay report={report} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "기념 편지 가져가기" }));

    expect(await screen.findByRole("dialog", { name: "기념 편지 QR" })).toBeInTheDocument();
    expect(screen.getByText("구름님의 편지가 준비됐어요")).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("builds the QR from the address the booth browser is open at, over a stale env origin", async () => {
    // The venue reassigned the laptop's IP; the env file still holds the old one.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://192.168.0.62:3000");
    stubOrigin("http://192.168.1.44:3000");
    stubKeepsakeFetch({ origin: "http://192.168.1.44:3000", addresses: ["192.168.1.44"] });

    render(<CounselReportOverlay report={report} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "기념 편지 가져가기" }));

    const url = await screen.findByTestId("keepsake-share-url");
    expect(url).toHaveTextContent("http://192.168.1.44:3000/letter/safe-token_123");
    expect(screen.queryByText(/현재 컴퓨터에서만/)).toBeNull();
  });

  it("falls back to the detected LAN address when opened at localhost", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    stubOrigin("http://localhost:3000");
    stubKeepsakeFetch({ origin: "http://192.168.1.44:3000", addresses: ["192.168.1.44"] });

    render(<CounselReportOverlay report={report} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "기념 편지 가져가기" }));

    const url = await screen.findByTestId("keepsake-share-url");
    expect(url).toHaveTextContent("http://192.168.1.44:3000/letter/safe-token_123");
  });

  it("warns when the QR host no longer matches any address on this machine", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    stubOrigin("http://192.168.0.62:3000");
    stubKeepsakeFetch({ origin: "http://192.168.1.44:3000", addresses: ["192.168.1.44"] });

    render(<CounselReportOverlay report={report} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "기념 편지 가져가기" }));

    expect(await screen.findByText(/192\.168\.0\.62.*현재 주소와 달라요/)).toBeInTheDocument();
  });
});
