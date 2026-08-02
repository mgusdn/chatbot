import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioDirector, requestBackgroundAudioPlayback } from "@/components/audio/AudioDirector";
import { useGameStore } from "@/store/useGameStore";

describe("background audio director", () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    useGameStore.getState().reset();
  });

  afterEach(cleanup);

  it("waits for opt-in, then loops the configured music", () => {
    render(<AudioDirector />);

    const audio = screen.getByTestId("background-music") as HTMLAudioElement;
    expect(audio.loop).toBe(true);
    expect(audio.getAttribute("src")).toBe("/audio/music/forest-main.mp3");
    expect(play).not.toHaveBeenCalled();

    act(() => {
      useGameStore.getState().toggleMuted();
      requestBackgroundAudioPlayback();
    });

    expect(play).toHaveBeenCalled();
  });

  it("pauses throughout counseling and resumes in the world", () => {
    render(<AudioDirector />);
    const audio = screen.getByTestId("background-music") as HTMLAudioElement;

    expect(audio.volume).toBe(0.2);
    act(() => useGameStore.setState({ muted: false }));
    fireEvent.pointerDown(window);
    expect(play).toHaveBeenCalled();

    play.mockClear();
    pause.mockClear();
    act(() => useGameStore.setState({ phase: "counsel-active" }));
    expect(pause).toHaveBeenCalled();

    fireEvent.pointerDown(window);
    expect(play).not.toHaveBeenCalled();

    act(() => useGameStore.setState({ phase: "exploring-exterior" }));
    expect(play).toHaveBeenCalled();
  });
});
