"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechApi } from "@/lib/api/speechClient";

export type SpeechSegment = {
  id: string;
  text: string;
  turnId?: string;
};

type QueuedSegment = SpeechSegment & { generation: number };

export function useSpeechOutput({ available }: { available: boolean }) {
  const [enabled, setEnabledState] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(enabled);
  const availableRef = useRef(available);
  const queueRef = useRef<QueuedSegment[]>([]);
  const seenRef = useRef(new Set<string>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const pumpingRef = useRef(false);

  enabledRef.current = enabled;
  availableRef.current = available;

  const stop = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    seenRef.current.clear();
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    pumpingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const playAudio = useCallback((url: string, generation: number) => new Promise<void>((resolve, reject) => {
    if (generation !== generationRef.current) {
      resolve();
      return;
    }
    const audio = new Audio(url);
    audio.preload = "auto";
    audioRef.current = audio;
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      if (audioRef.current === audio) audioRef.current = null;
    };
    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); reject(new Error("생성된 음성을 재생하지 못했습니다.")); };
    audio.play().catch((caught) => { cleanup(); reject(caught); });
  }), []);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    setIsSpeaking(true);
    setError("");
    try {
      while (queueRef.current.length && enabledRef.current && availableRef.current) {
        const segment = queueRef.current.shift();
        if (!segment || segment.generation !== generationRef.current) continue;
        const controller = new AbortController();
        abortRef.current = controller;
        const ticket = await speechApi.createSynthesis(
          segment.text,
          { turnId: segment.turnId, segmentId: segment.id },
          controller.signal,
        );
        abortRef.current = null;
        await playAudio(ticket.audio_url, segment.generation);
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(String(caught instanceof Error ? caught.message : caught));
      }
      queueRef.current = [];
    } finally {
      pumpingRef.current = false;
      setIsSpeaking(false);
      // A segment can arrive between the loop condition and finally.
      if (queueRef.current.length && enabledRef.current && availableRef.current) void pump();
    }
  }, [playAudio]);

  const enqueue = useCallback((segment: SpeechSegment) => {
    const text = segment.text.split(/\s+/).join(" ").trim();
    if (!text || !enabledRef.current || !availableRef.current || seenRef.current.has(segment.id)) return;
    seenRef.current.add(segment.id);
    queueRef.current.push({ ...segment, text, generation: generationRef.current });
    void pump();
  }, [pump]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    enabledRef.current = next;
    if (!next) stop();
  }, [stop]);

  useEffect(() => {
    if (!available) stop();
  }, [available, stop]);

  useEffect(() => stop, [stop]);

  return { enabled, setEnabled, isSpeaking, error, enqueue, stop };
}
