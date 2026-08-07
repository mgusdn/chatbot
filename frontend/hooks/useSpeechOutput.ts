"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechApi } from "@/lib/api/speechClient";

export type SpeechSegment = {
  id: string;
  text: string;
  turnId?: string;
  isFinal?: boolean;
};

type QueuedSegment = SpeechSegment & { generation: number };

const TTS_SAMPLE_RATE = 32_000;
const WORKLET_URL = "/audio/pcm-stream-player.worklet.js";

function pcm16leToFloat32(bytes: Uint8Array) {
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32_768;
  }
  return samples;
}

export function useSpeechOutput({ available }: { available: boolean }) {
  const [enabled, setEnabledState] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(enabled);
  const availableRef = useRef(available);
  const queueRef = useRef<QueuedSegment[]>([]);
  const seenRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const pumpingRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletPromiseRef = useRef<Promise<AudioWorkletNode> | null>(null);

  enabledRef.current = enabled;
  availableRef.current = available;

  const prime = useCallback(async () => {
    if (typeof window === "undefined") throw new Error("브라우저에서만 음성을 재생할 수 있습니다.");
    if (!window.AudioContext || !window.AudioWorkletNode) {
      throw new Error("이 브라우저는 연속 음성 재생을 지원하지 않습니다.");
    }
    if (!workletPromiseRef.current) {
      workletPromiseRef.current = (async () => {
        const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE, latencyHint: "interactive" });
        contextRef.current = context;
        await context.audioWorklet.addModule(WORKLET_URL);
        const node = new AudioWorkletNode(context, "pcm-stream-player", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
          if (event.data?.type === "drained" && !pumpingRef.current && queueRef.current.length === 0) {
            setIsSpeaking(false);
          }
        };
        node.connect(context.destination);
        workletRef.current = node;
        return node;
      })().catch((caught) => {
        workletPromiseRef.current = null;
        void contextRef.current?.close();
        contextRef.current = null;
        workletRef.current = null;
        throw caught;
      });
    }
    const node = await workletPromiseRef.current;
    if (contextRef.current?.state === "suspended") await contextRef.current.resume();
    return node;
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    seenRef.current.clear();
    abortRef.current?.abort();
    abortRef.current = null;
    workletRef.current?.port.postMessage({ type: "reset" });
    pumpingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const streamTicket = useCallback(async (url: string, generation: number, signal: AbortSignal, padEnd: boolean) => {
    const node = await prime();
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`음성 스트림을 받지 못했습니다. (${response.status})`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("wav")) {
      throw new Error("음성 서버가 연속 재생용 raw PCM 대신 WAV를 반환했습니다.");
    }

    const reader = response.body.getReader();
    let carry: number | null = null;
    const push = (samples: Float32Array) => {
      if (!samples.length || generation !== generationRef.current) return;
      node.port.postMessage({ type: "push", samples }, [samples.buffer]);
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength || generation !== generationRef.current) continue;

      let bytes = value;
      if (carry != null) {
        const joined = new Uint8Array(value.byteLength + 1);
        joined[0] = carry;
        joined.set(value, 1);
        bytes = joined;
        carry = null;
      }
      if (bytes.byteLength % 2 === 1) {
        carry = bytes[bytes.byteLength - 1];
        bytes = bytes.subarray(0, bytes.byteLength - 1);
      }
      if (!bytes.byteLength) continue;
      const samples = pcm16leToFloat32(bytes);
      push(samples);
    }
    
    // Manually append trailing silence (0.3s) if this is a final segment.
    // This ensures OS-level audio buffers fully drain the actual speech
    // before the worklet signals "drained" and UI transitions occur.
    if (padEnd && generation === generationRef.current) {
      const silenceDuration = 0.3;
      const silenceSamples = new Float32Array(Math.floor(TTS_SAMPLE_RATE * silenceDuration));
      push(silenceSamples);
    }
  }, [prime]);

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
        const isFinal = segment.isFinal !== false;
        const ticket = await speechApi.createSynthesis(
          segment.text,
          { turnId: segment.turnId, segmentId: segment.id, padEnd: isFinal },
          controller.signal,
        );
        if (segment.generation !== generationRef.current) continue;
        await streamTicket(ticket.audio_url, segment.generation, controller.signal, isFinal);
        abortRef.current = null;
      }
      // Wait for the AudioWorklet to finish playing every buffered sample
      // before releasing the pump lock. Without this, the last ~300ms of
      // speech (e.g. "있나요?" → "있ㄴ…") gets silently discarded.
      if (workletRef.current) {
        await new Promise<void>((resolve) => {
          const node = workletRef.current!;
          const gen = generationRef.current;
          const onDrain = (event: MessageEvent<{ type?: string }>) => {
            if (event.data?.type === "drained") {
              node.port.removeEventListener("message", onDrain);
              resolve();
            }
          };
          node.port.addEventListener("message", onDrain);
          node.port.postMessage({ type: "check-drain" });
          // Safety timeout: don't block forever if the worklet never drains
          setTimeout(() => {
            node.port.removeEventListener("message", onDrain);
            resolve();
          }, 5000);
        });
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(String(caught instanceof Error ? caught.message : caught));
      }
      queueRef.current = [];
    } finally {
      abortRef.current = null;
      pumpingRef.current = false;
      setIsSpeaking(false);
      // A segment can arrive between the loop condition and finally.
      if (queueRef.current.length && enabledRef.current && availableRef.current) void pump();
    }
  }, [streamTicket]);

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
    if (next) {
      void prime().catch((caught) => setError(String(caught instanceof Error ? caught.message : caught)));
    } else {
      stop();
    }
  }, [prime, stop]);

  useEffect(() => {
    if (!available) stop();
  }, [available, stop]);

  useEffect(() => () => {
    stop();
    workletRef.current?.disconnect();
    void contextRef.current?.close();
    workletRef.current = null;
    contextRef.current = null;
    workletPromiseRef.current = null;
  }, [stop]);

  return { enabled, setEnabled, isSpeaking, error, enqueue, stop, prime };
}
