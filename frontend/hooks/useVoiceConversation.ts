"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MicVAD } from "@ricky0123/vad-web/dist/real-time-vad";
import { speechApi } from "@/lib/api/speechClient";
import { float32ToWavBlob } from "@/lib/audio/float32ToWav";

export type VoiceConversationState =
  | "off"
  | "starting"
  | "listening"
  | "speaking"
  | "transcribing"
  | "waiting"
  | "error";

const REARM_DELAY_MS = 250;

function voiceError(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error || "");
  if (/notallowed|permission|denied/i.test(raw)) {
    return "목소리 대화를 시작하려면 브라우저의 마이크 권한이 필요해요.";
  }
  if (/notfound|device/i.test(raw)) return "사용할 수 있는 마이크를 찾지 못했어요.";
  if (/abort/i.test(raw)) return "";
  return raw || "목소리를 처리하지 못했어요. 잠시 후 다시 말해 주세요.";
}

export function useVoiceConversation({
  available,
  canListen,
  onTranscript,
}: {
  available: boolean;
  canListen: boolean;
  onTranscript: (text: string, sttMs: number) => Promise<void> | void;
}) {
  const [active, setActive] = useState(false);
  const [state, setState] = useState<VoiceConversationState>("off");
  const [error, setError] = useState("");
  const vadRef = useRef<MicVAD | null>(null);
  const vadPromiseRef = useRef<Promise<MicVAD> | null>(null);
  const activeRef = useRef(false);
  const canListenRef = useRef(canListen);
  const stateRef = useRef<VoiceConversationState>(state);
  const abortRef = useRef<AbortController | null>(null);
  const rearmTimerRef = useRef<number | null>(null);
  const utteranceSequenceRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);

  activeRef.current = active;
  canListenRef.current = canListen;
  stateRef.current = state;
  onTranscriptRef.current = onTranscript;

  const clearRearmTimer = useCallback(() => {
    if (rearmTimerRef.current != null) window.clearTimeout(rearmTimerRef.current);
    rearmTimerRef.current = null;
  }, []);

  const processUtterance = useCallback(async (audio: Float32Array) => {
    if (!activeRef.current) return;
    const utteranceId = ++utteranceSequenceRef.current;
    clearRearmTimer();
    await vadRef.current?.pause();
    if (!activeRef.current || utteranceId !== utteranceSequenceRef.current) return;
    setState("transcribing");
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await speechApi.transcribe(float32ToWavBlob(audio), controller.signal);
      if (!activeRef.current || utteranceId !== utteranceSequenceRef.current) return;
      await onTranscriptRef.current(result.text, result.stt_ms);
    } catch (caught) {
      const message = voiceError(caught);
      if (message && activeRef.current) setError(message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (activeRef.current && utteranceId === utteranceSequenceRef.current) setState("waiting");
    }
  }, [clearRearmTimer]);

  const getVad = useCallback(async () => {
    if (vadRef.current) return vadRef.current;
    if (!vadPromiseRef.current) {
      vadPromiseRef.current = import("@ricky0123/vad-web/dist/real-time-vad")
        .then(({ MicVAD }) => MicVAD.new({
          model: "v5",
          startOnLoad: false,
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/vad/",
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionMs: 800,
          preSpeechPadMs: 200,
          minSpeechMs: 300,
          submitUserSpeechOnPause: false,
          onSpeechStart: () => {
            if (!activeRef.current) return;
            setError("");
            setState("speaking");
          },
          onSpeechRealStart: () => undefined,
          onVADMisfire: () => {
            if (activeRef.current) setState("listening");
          },
          onSpeechEnd: (audio) => processUtterance(audio),
        }))
        .then((vad) => {
          vadRef.current = vad;
          return vad;
        })
        .catch((caught) => {
          vadPromiseRef.current = null;
          throw caught;
        });
    }
    return vadPromiseRef.current;
  }, [processUtterance]);

  const resumeListening = useCallback(async () => {
    if (!activeRef.current || !canListenRef.current) return;
    try {
      const vad = await getVad();
      if (!activeRef.current || !canListenRef.current) return;
      await vad.start();
      if (activeRef.current && canListenRef.current) setState("listening");
    } catch (caught) {
      if (!activeRef.current) return;
      setState("error");
      setError(voiceError(caught));
    }
  }, [getVad]);

  const start = useCallback(async () => {
    if (!available || activeRef.current) return;
    activeRef.current = true;
    setActive(true);
    setError("");
    setState("starting");
    if (canListenRef.current) await resumeListening();
    else setState("waiting");
  }, [available, resumeListening]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    utteranceSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearRearmTimer();
    void vadRef.current?.pause();
    setState("off");
    setError("");
  }, [clearRearmTimer]);

  useEffect(() => {
    if (!active) return;
    if (!canListen && (state === "listening" || state === "speaking")) {
      clearRearmTimer();
      void vadRef.current?.pause();
      setState("waiting");
      return;
    }
    if (canListen && (state === "waiting" || state === "starting")) {
      clearRearmTimer();
      rearmTimerRef.current = window.setTimeout(() => {
        rearmTimerRef.current = null;
        void resumeListening();
      }, REARM_DELAY_MS);
    }
    return clearRearmTimer;
  }, [active, canListen, clearRearmTimer, resumeListening, state]);

  useEffect(() => {
    if (!available && activeRef.current) stop();
  }, [available, stop]);

  useEffect(() => () => {
    activeRef.current = false;
    abortRef.current?.abort();
    clearRearmTimer();
    vadRef.current?.destroy();
    vadRef.current = null;
    vadPromiseRef.current = null;
  }, [clearRearmTimer]);

  return {
    active,
    state,
    error,
    isListening: state === "listening",
    isUserSpeaking: state === "speaking",
    start,
    stop,
  };
}
