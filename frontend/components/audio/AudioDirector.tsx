"use client";

import { useCallback, useEffect, useRef } from "react";
import { useGameStore } from "@/store/useGameStore";

export const AUDIO_UNLOCK_EVENT = "pume:audio-unlock";

const BACKGROUND_MUSIC_SRC = "/audio/music/forest-main.mp3";
const EXPLORATION_VOLUME = 0.2;

const BACKGROUND_MUSIC_PAUSED_PHASES = new Set([
  "entering-counsel",
  "counsel-active",
  "leaving-counsel",
  "report-active",
]);

export function requestBackgroundAudioPlayback() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUDIO_UNLOCK_EVENT));
  }
}

export function AudioDirector() {
  const muted = useGameStore((state) => state.muted);
  const phase = useGameStore((state) => state.phase);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  const playIfAllowed = useCallback(() => {
    const audio = audioRef.current;
    if (
      !audio
      || !unlockedRef.current
      || useGameStore.getState().muted
      || BACKGROUND_MUSIC_PAUSED_PHASES.has(useGameStore.getState().phase)
      || document.visibilityState === "hidden"
    ) return;
    void audio.play().catch(() => {
      // Browsers can still reject playback until a direct user gesture.
      // The next pointer/key interaction retries through the listeners below.
    });
  }, []);

  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      playIfAllowed();
    };
    window.addEventListener(AUDIO_UNLOCK_EVENT, unlock);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener(AUDIO_UNLOCK_EVENT, unlock);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [playIfAllowed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted || BACKGROUND_MUSIC_PAUSED_PHASES.has(phase)) audio.pause();
    else playIfAllowed();
  }, [muted, phase, playIfAllowed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = EXPLORATION_VOLUME;
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (document.visibilityState === "hidden") audio.pause();
      else playIfAllowed();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [playIfAllowed]);

  return (
    <audio
      ref={audioRef}
      src={BACKGROUND_MUSIC_SRC}
      preload="metadata"
      loop
      aria-hidden="true"
      data-testid="background-music"
    />
  );
}
