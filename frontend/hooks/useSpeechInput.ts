"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechApi } from "@/lib/api/speechClient";

export type SpeechInputState = "idle" | "requesting" | "recording" | "transcribing" | "error";

export function selectRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  ) || "";
}

function speechInputError(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error || "");
  if (/notallowed|permission|denied/i.test(raw)) return "마이크 권한이 필요해요. 브라우저 주소창에서 마이크를 허용해 주세요.";
  if (/notfound|device/i.test(raw)) return "사용할 수 있는 마이크를 찾지 못했어요.";
  if (/abort/i.test(raw)) return "";
  return raw || "음성을 글로 바꾸지 못했어요. 다시 한번 말해 주세요.";
}

export function useSpeechInput({
  available,
  disabled,
  onTranscript,
}: {
  available: boolean;
  disabled: boolean;
  onTranscript: (text: string, sttMs: number) => void;
}) {
  const [state, setState] = useState<SpeechInputState>("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const discardOnStopRef = useRef(false);
  const maxDurationTimerRef = useRef<number | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearMaxDurationTimer = useCallback(() => {
    if (maxDurationTimerRef.current != null) window.clearTimeout(maxDurationTimerRef.current);
    maxDurationTimerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    discardOnStopRef.current = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    chunksRef.current = [];
    clearMaxDurationTimer();
    releaseStream();
    setState("idle");
    setError("");
  }, [clearMaxDurationTimer, releaseStream]);

  useEffect(() => () => {
    abortRef.current?.abort();
    discardOnStopRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    clearMaxDurationTimer();
    releaseStream();
  }, [clearMaxDurationTimer, releaseStream]);

  const start = useCallback(async () => {
    if (!available || disabled || ["requesting", "recording", "transcribing"].includes(state)) return;
    setError("");
    setState("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (disabled) {
        stream.getTracks().forEach((track) => track.stop());
        setState("idle");
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      discardOnStopRef.current = false;
      const mimeType = selectRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        recorderRef.current = null;
        clearMaxDurationTimer();
        releaseStream();
        if (discardOnStopRef.current) {
          discardOnStopRef.current = false;
          chunksRef.current = [];
          return;
        }
        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (!chunks.length) {
          setState("error");
          setError("녹음된 음성이 없어요. 다시 한번 말해 주세요.");
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setState("transcribing");
        try {
          const result = await speechApi.transcribe(
            new Blob(chunks, { type: recorder.mimeType || mimeType || "application/octet-stream" }),
            controller.signal,
          );
          onTranscriptRef.current(result.text, result.stt_ms);
          setState("idle");
        } catch (caught) {
          const message = speechInputError(caught);
          if (message) {
            setState("error");
            setError(message);
          } else {
            setState("idle");
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      };
      recorder.start(250);
      maxDurationTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 60_000);
      setState("recording");
    } catch (caught) {
      releaseStream();
      setState("error");
      setError(speechInputError(caught));
    }
  }, [available, clearMaxDurationTimer, disabled, releaseStream, state]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else void start();
  }, [start, state, stop]);

  return {
    state,
    error,
    isRecording: state === "recording",
    isTranscribing: state === "transcribing",
    toggle,
    cancel,
  };
}
