"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { counselingApi } from "@/lib/api/counselingClient";
import type {
  CounselReport,
  CounselingSendOutcome,
  ModelArm,
  PandaStageState,
  PublicCounselState,
  TranscriptEntry,
  TurnResult,
} from "@/types/counseling";

const COUNSELING_ARM: ModelArm = "baseline";

const EMPTY_STATE: PublicCounselState = {
  stage: "rapport",
  turn_count: 0,
  filled_slots: [],
  pending_slot: null,
  slot_values: {},
};

export function hasSubstantiveText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, "").trim();
  return normalized.length >= 2 && /[0-9A-Za-z가-힣]/.test(normalized);
}

export function isNormalCounselCompletion(result: TurnResult) {
  return result.status === "ok"
    && result.state?.stage === "done"
    && result.safety_bypass === false
    && hasSubstantiveText(result.message);
}

export function withoutLatestTranscriptEntry(
  entries: TranscriptEntry[],
  target: TranscriptEntry,
) {
  let index = -1;
  for (let current = entries.length - 1; current >= 0; current -= 1) {
    const entry = entries[current];
    if (entry.role === target.role && entry.text === target.text) {
      index = current;
      break;
    }
  }
  if (index < 0) return entries;
  return [...entries.slice(0, index), ...entries.slice(index + 1)];
}

export function friendlyCounselingError(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error || "");
  const lower = raw.toLowerCase();
  if (lower.includes("404") || lower.includes("세션을 찾을 수 없습니다")) {
    return "상담 서버가 재시작되어 이전 세션이 만료됐어요. ‘새 상담’을 눌러 다시 시작해 주세요.";
  }
  if (lower.includes("429") || lower.includes("prepayment") || lower.includes("credits")) {
    return "Gemini 사용 크레딧이 소진되어 지금은 답변할 수 없어요. Google AI Studio 결제를 확인해 주세요.";
  }
  if (
    lower.includes("connection refused") || lower.includes("connecterror") ||
    lower.includes("failed to connect") || lower.includes("all connection attempts failed") ||
    lower.includes("서버에 연결할 수 없습니다") || lower.includes("connection error")
  ) {
    return "상담 서비스에 연결하지 못했어요. FastAPI 서버와 Gemini 설정을 확인해 주세요.";
  }
  if (lower.includes("api_key") || lower.includes("provider 설정")) {
    return "선택한 모델의 설정이 아직 준비되지 않았어요. 로컬 환경설정을 확인해 주세요.";
  }
  if (lower.includes("응답 시간이 초과")) {
    return "상담 서버의 응답이 늦어 요청을 마쳤어요. 잠시 뒤 다시 시도해 주세요.";
  }
  if (lower.includes("non_substantive_response")) {
    return "모델이 의미 있는 답변을 만들지 못했어요. 새 상담으로 다시 시작하거나 다른 모델을 선택해 주세요.";
  }
  return "답변을 가져오는 중 문제가 생겼어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

export type CounselingSpeechSegment = {
  id: string;
  text: string;
  turnId?: string;
  isFinal?: boolean;
};

export function useCounselingSession(
  shouldPrepare: boolean,
  onSpeechSegment?: (segment: CounselingSpeechSegment) => void,
  participantName = "사용자",
) {
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [safetyBypass, setSafetyBypass] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [runState, setRunState] = useState<PublicCounselState>(EMPTY_STATE);
  const [stageState, setStageState] = useState<PandaStageState>("booting");
  const [responseText, setResponseText] = useState("잠시만요. 편안하게 이야기할 자리를 준비하고 있어요.");
  const [formStatus, setFormStatus] = useState("상담 세션을 준비하고 있어요.");
  const [formError, setFormError] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [firstResponseLatency, setFirstResponseLatency] = useState<number | null>(null);
  const sessionEpoch = useRef(0);
  const pendingTurn = useRef(false);
  const pendingAbort = useRef<AbortController | null>(null);
  const prepared = useRef(false);
  const preparing = useRef<Promise<void> | null>(null);
  const timers = useRef<number[]>([]);
  const onSpeechSegmentRef = useRef(onSpeechSegment);
  onSpeechSegmentRef.current = onSpeechSegment;

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const appendTranscript = useCallback((entry: TranscriptEntry) => {
    setTranscript((current) => [...current, entry].slice(-30));
  }, []);

  const newSession = useCallback(async () => {
    pendingAbort.current?.abort();
    pendingAbort.current = null;
    const epoch = ++sessionEpoch.current;
    clearTimers();
    setBusy(true);
    setDone(false);
    setSafetyBypass(false);
    setExperimentId(null);
    setTurnCount(0);
    setTranscript([]);
    setRunState(EMPTY_STATE);
    setLatency(null);
    setFirstResponseLatency(null);
    setStageState("booting");
    setResponseText("잠시만요. 편안하게 이야기할 자리를 준비하고 있어요.");
    setFormStatus("새 상담 세션을 만드는 중이에요.");
    setFormError(false);

    try {
      const data = await counselingApi.createExperiment(participantName.trim() || "사용자");
      if (epoch !== sessionEpoch.current) return;
      const greeting = data.greetings[COUNSELING_ARM] || "안녕하세요. 오늘 어떤 마음으로 오셨나요?";
      setExperimentId(data.experiment_id);
      setResponseText(greeting);
      setTranscript([{ role: "bot", text: greeting }]);
      setRunState(data.states[COUNSELING_ARM] || EMPTY_STATE);
      setStageState("idle");
      setFormStatus("준비됐어요. 지금 마음에 걸리는 일을 편하게 들려주세요.");
    } catch (error) {
      if (epoch !== sessionEpoch.current) return;
      const message = friendlyCounselingError(error);
      setStageState("error");
      setResponseText(message);
      setFormStatus(message);
      setFormError(true);
    } finally {
      if (epoch === sessionEpoch.current) setBusy(false);
    }
  }, [clearTimers, participantName]);

  const prepare = useCallback(async () => {
    if (prepared.current) return;
    if (preparing.current) return preparing.current;
    preparing.current = newSession().finally(() => {
      prepared.current = true;
      preparing.current = null;
    });
    return preparing.current;
  }, [newSession]);

  useEffect(() => {
    if (shouldPrepare) void prepare();
  }, [shouldPrepare, prepare]);

  useEffect(() => () => {
    pendingAbort.current?.abort();
    pendingAbort.current = null;
    clearTimers();
    sessionEpoch.current += 1;
  }, [clearTimers]);

  const scheduleThinkingCopy = useCallback(() => {
    clearTimers();
    timers.current.push(
      window.setTimeout(() => setFormStatus("상황과 감정의 단서를 살피고 있어요."), 1600),
      window.setTimeout(() => setFormStatus("지금 필요한 다음 질문을 고르고 있어요."), 4300),
      window.setTimeout(() => setFormStatus("답변을 차분하게 다듬고 있어요."), 7600),
    );
  }, [clearTimers]);

  const sendMessage = useCallback(async (messageInput: string): Promise<CounselingSendOutcome> => {
    if (busy || pendingTurn.current || done || !experimentId) {
      return { accepted: false, kind: "rejected" };
    }
    const message = messageInput.trim();
    if (!message) {
      setFormStatus("프바오에게 들려줄 이야기를 입력해 주세요.");
      setFormError(true);
      return { accepted: false, kind: "rejected" };
    }

    const epoch = sessionEpoch.current;
    const requestStartedAt = performance.now();
    const turnAbort = new AbortController();
    pendingAbort.current = turnAbort;
    let lastStreamSequence = 0;
    let firstSegmentSeen = false;
    let speechSegmentSeen = false;
    const pendingSpeechTail: string[] = [];
    pendingTurn.current = true;
    appendTranscript({ role: "user", text: message });
    setBusy(true);
    setStageState("thinking");
    setResponseText("이야기를 차분히 듣고 있어요");
    setFormStatus("프바오가 마음의 흐름을 살피고 있어요.");
    setFormError(false);
    setLatency(null);
    setFirstResponseLatency(null);
    scheduleThinkingCopy();

    try {
      const data = await counselingApi.sendTurnStream(
          experimentId,
          message,
          (event) => {
            if (
              epoch === sessionEpoch.current
              && event.type === "arm_result"
              && event.arm === "baseline"
            ) {
              const tail = [...pendingSpeechTail, event.speech_continuation || ""]
                .filter(Boolean)
                .join(" ")
                .trim();
              if (tail) {
                speechSegmentSeen = true;
                onSpeechSegmentRef.current?.({
                  id: `${event.turn_id || `baseline-${event.sequence}`}:continuation`,
                  turnId: event.turn_id,
                  text: tail,
                  isFinal: true,
                });
              }
              return;
            }
            if (
              epoch !== sessionEpoch.current
              || event.type !== "segment"
              || event.arm !== "baseline"
              || event.sequence <= lastStreamSequence
            ) return;
            lastStreamSequence = event.sequence;
            if (event.segment === "reflection") {
              speechSegmentSeen = true;
              onSpeechSegmentRef.current?.({
                id: `${event.turn_id}:${event.sequence}`,
                turnId: event.turn_id,
                text: event.text,
                isFinal: false,
              });
            } else {
              // Hold short asides until the analyzer supplies the final
              // continuation. One combined TTS request avoids a prosody reset
              // and a network gap between two neighboring sentences.
              pendingSpeechTail.push(event.text);
            }
            if (!firstSegmentSeen) {
              firstSegmentSeen = true;
              setFirstResponseLatency(Math.round(performance.now() - requestStartedAt));
            }
            clearTimers();
            setResponseText((current) => (
              event.segment === "reflection" ? event.text : `${current} ${event.text}`.trim()
            ));
            setStageState("talking");
            setFormStatus(
              event.segment === "bridge"
                ? "프바오가 천천히 이야기를 이어가고 있어요."
                : event.segment === "aside"
                  ? "프바오가 생각을 정리하며 이야기를 잇고 있어요."
                  : "프바오가 먼저 마음을 헤아려 말하고 있어요.",
            );
          },
          turnAbort.signal,
        );
      if (epoch !== sessionEpoch.current) return { accepted: false, kind: "rejected" };
      const result = data.results[COUNSELING_ARM];
      if (!result || result.status !== "ok") throw new Error(result?.error || "모델 응답이 없습니다.");
      if (!hasSubstantiveText(result.message)) {
        if (result.state) setTurnCount(result.state.turn_count || turnCount);
        if (result.metrics?.total_ms != null) setLatency(Math.round(result.metrics.total_ms));
        setDone(true);
        throw new Error("NON_SUBSTANTIVE_RESPONSE");
      }

      if (!speechSegmentSeen) {
        onSpeechSegmentRef.current?.({
          id: `${result.run_id || data.comparison_id}:complete`,
          turnId: result.run_id,
          text: result.message,
          isFinal: true,
        });
      }

      clearTimers();
      const nextState = result.state || EMPTY_STATE;
      setTurnCount(nextState.turn_count);
      setDone(nextState.stage === "done");
      setSafetyBypass(result.safety_bypass === true);
      setLatency(result.metrics?.total_ms == null ? null : Math.round(result.metrics.total_ms));
      if (!firstSegmentSeen) {
        setFirstResponseLatency(Math.round(performance.now() - requestStartedAt));
      }
      setResponseText(result.message);
      appendTranscript({ role: "bot", text: result.message });
      setStageState("talking");

      let detailedState = nextState;
      try {
        const demoState = await counselingApi.demoState(experimentId);
        if (epoch !== sessionEpoch.current) return { accepted: false, kind: "rejected" };
        detailedState = { ...nextState, ...demoState, stage: nextState.stage };
      } catch {
        detailedState = nextState;
      }
      setRunState(detailedState);

      if (result.safety_bypass) {
        setFormStatus("지금은 안전을 가장 먼저 생각해야 해요. 화면의 안내에 따라 즉시 도움을 요청해 주세요.");
      } else if (nextState.stage === "done") {
        setFormStatus("마음 정리가 완성됐어요. 다시 이야기하려면 ‘새 상담’을 눌러주세요.");
      } else {
        setFormStatus("답변이 도착했어요. 이어서 천천히 이야기해 주세요.");
      }
      timers.current.push(window.setTimeout(() => setStageState("idle"), 1500));

      if (isNormalCounselCompletion(result)) {
        const report: CounselReport = {
          id: result.run_id || `${experimentId}-${nextState.turn_count}`,
          experimentId,
          arm: COUNSELING_ARM,
          createdAt: new Date().toISOString(),
          markdown: result.message,
          reportFallback: Boolean(nextState.report_fallback),
          state: detailedState,
        };
        return { accepted: true, kind: "complete", report };
      }
      return { accepted: true, kind: result.safety_bypass === true ? "safety" : "continue" };
    } catch (error) {
      if (epoch !== sessionEpoch.current) return { accepted: false, kind: "rejected" };
      clearTimers();
      setTranscript((current) => withoutLatestTranscriptEntry(current, { role: "user", text: message }));
      const messageForUser = friendlyCounselingError(error);
      setStageState("error");
      setResponseText(messageForUser);
      setFormStatus(messageForUser);
      setFormError(true);
      return { accepted: false, kind: "error" };
    } finally {
      if (epoch === sessionEpoch.current) {
        if (pendingAbort.current === turnAbort) pendingAbort.current = null;
        pendingTurn.current = false;
        setBusy(false);
      }
    }
  }, [appendTranscript, busy, clearTimers, done, experimentId, scheduleThinkingCopy, turnCount]);

  const cancelPendingTurn = useCallback(() => {
    if (!pendingTurn.current) return false;
    pendingAbort.current?.abort();
    pendingAbort.current = null;
    pendingTurn.current = false;
    sessionEpoch.current += 1;
    clearTimers();
    setBusy(false);
    setStageState("idle");
    setFormStatus("진행 중이던 답변 요청을 멈췄어요. 다음 방문을 위해 새 상담을 준비할게요.");
    setFormError(false);
    return true;
  }, [clearTimers]);

  return {
    busy,
    done,
    safetyBypass,
    experimentId,
    turnCount,
    transcript,
    runState,
    stageState,
    responseText,
    formStatus,
    formError,
    latency,
    firstResponseLatency,
    sendMessage,
    cancelPendingTurn,
    newSession,
    appendTranscript,
  };
}
