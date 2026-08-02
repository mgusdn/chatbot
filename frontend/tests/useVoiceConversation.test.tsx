import { act, renderHook, waitFor } from "@testing-library/react";
import type { MicVAD, RealTimeVADOptions } from "@ricky0123/vad-web/dist/real-time-vad";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { speechApi } from "@/lib/api/speechClient";

const vadHarness = vi.hoisted(() => ({
  options: null as Partial<RealTimeVADOptions> | null,
  start: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
  destroy: vi.fn(),
}));

vi.mock("@ricky0123/vad-web/dist/real-time-vad", () => ({
  MicVAD: {
    new: vi.fn(async (options: Partial<RealTimeVADOptions>) => {
      vadHarness.options = options;
      return {
        start: vadHarness.start,
        pause: vadHarness.pause,
        destroy: vadHarness.destroy,
      } as unknown as MicVAD;
    }),
  },
}));

vi.mock("@/lib/api/speechClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/speechClient")>();
  return {
    ...actual,
    speechApi: {
      ...actual.speechApi,
      transcribe: vi.fn(),
    },
  };
});

describe("useVoiceConversation", () => {
  beforeEach(() => {
    vadHarness.options = null;
    vadHarness.start.mockClear();
    vadHarness.pause.mockClear();
    vadHarness.destroy.mockClear();
    vi.mocked(speechApi.transcribe).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns one VAD utterance into WAV, sends it, and waits while the answer plays", async () => {
    vi.mocked(speechApi.transcribe).mockResolvedValue({ text: "오늘은 조금 답답해요", stt_ms: 412 });
    const onTranscript = vi.fn(async () => undefined);
    const { result } = renderHook(() => useVoiceConversation({
      available: true,
      canListen: true,
      onTranscript,
    }));

    await act(async () => result.current.start());
    expect(result.current.state).toBe("listening");
    expect(vadHarness.start).toHaveBeenCalledOnce();

    act(() => {
      vadHarness.options?.onSpeechStart?.();
    });
    expect(result.current.state).toBe("speaking");

    await act(async () => {
      await vadHarness.options?.onSpeechEnd?.(new Float32Array([0, 0.25, -0.25]));
    });

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("오늘은 조금 답답해요", 412));
    expect(result.current.state).toBe("waiting");
    expect(vadHarness.pause).toHaveBeenCalled();
    const audio = vi.mocked(speechApi.transcribe).mock.calls[0]?.[0];
    expect(audio).toBeInstanceOf(Blob);
    expect(audio?.type).toBe("audio/wav");
    expect(audio?.size).toBe(50);
  });

  it("re-arms only after Gemini and TTS release the half-duplex gate", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ canListen }) => useVoiceConversation({
        available: true,
        canListen,
        onTranscript: vi.fn(),
      }),
      { initialProps: { canListen: false } },
    );

    await act(async () => result.current.start());
    expect(result.current.state).toBe("waiting");
    expect(vadHarness.start).not.toHaveBeenCalled();

    rerender({ canListen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(vadHarness.start).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(vadHarness.start).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("listening");

    rerender({ canListen: false });
    expect(result.current.state).toBe("waiting");
    expect(vadHarness.pause).toHaveBeenCalled();
  });

  it("stops the microphone and invalidates pending work", async () => {
    const { result } = renderHook(() => useVoiceConversation({
      available: true,
      canListen: true,
      onTranscript: vi.fn(),
    }));

    await act(async () => result.current.start());
    act(() => result.current.stop());

    expect(result.current.active).toBe(false);
    expect(result.current.state).toBe("off");
    expect(vadHarness.pause).toHaveBeenCalled();
  });
});
