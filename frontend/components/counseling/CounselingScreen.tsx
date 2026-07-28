"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCounselingSession } from "@/hooks/useCounselingSession";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { useSpeechOutput } from "@/hooks/useSpeechOutput";
import { speechApi, type SpeechHealth } from "@/lib/api/speechClient";
import { useGameStore } from "@/store/useGameStore";
import { MindMap } from "./MindMap";
import { ValueSelectionScreen } from "./ValueSelectionScreen";

const EXAMPLES = [
  ["미루는 습관", "요즘 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요."],
  ["관계 걱정", "사람들을 만나고 나면 제가 이상하게 말한 것 같아서 계속 걱정돼요."],
  ["잠들기 어려움", "밤에 생각이 많아져서 잠들기가 어렵고 다음 날 너무 피곤해요."],
] as const;

export function CounselingScreen({ isOpen, shouldPrepare }: { isOpen: boolean; shouldPrepare: boolean }) {
  const [speechHealth, setSpeechHealth] = useState<SpeechHealth | null>(null);
  const [lastSttMs, setLastSttMs] = useState<number | null>(null);
  const ttsAvailable = Boolean(
    speechHealth?.tts.configured && speechHealth.tts.connected !== false,
  );
  const speechOutput = useSpeechOutput({ available: ttsAvailable });
  const session = useCounselingSession(shouldPrepare, speechOutput.enqueue);
  const closeCounsel = useGameStore((state) => state.closeCounsel);
  const completeCounsel = useGameStore((state) => state.completeCounsel);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldPrepare) return;
    let active = true;
    void speechApi.health(true)
      .then((health) => { if (active) setSpeechHealth(health); })
      .catch(() => { if (active) setSpeechHealth(null); });
    return () => { active = false; };
  }, [shouldPrepare]);

  useEffect(() => {
    if (isOpen) window.setTimeout(() => inputRef.current?.focus(), 250);
  }, [isOpen]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [session.transcript]);

  const handleClose = useCallback(() => {
    speechOutput.stop();
    const canceledPendingTurn = session.cancelPendingTurn();
    closeCounsel();
    if (canceledPendingTurn) void session.newSession();
  }, [closeCounsel, session.cancelPendingTurn, session.newSession, speechOutput.stop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOpen && !session.safetyBypass && event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose, isOpen, session.safetyBypass]);

  const baseControlsDisabled = session.busy || session.done || !session.experimentId;
  const speechInput = useSpeechInput({
    available: Boolean(speechHealth?.stt.available),
    disabled: baseControlsDisabled,
    onTranscript: (text, sttMs) => {
      setMessage((current) => [current.trim(), text].filter(Boolean).join(" "));
      setLastSttMs(Math.round(sttMs));
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
  });

  const submit = async () => {
    if (speechInput.state !== "idle") return;
    speechOutput.stop();
    const outcome = await session.sendMessage(message);
    if (outcome.accepted) setMessage("");
    else inputRef.current?.focus();
    if (outcome.accepted && outcome.kind === "complete") completeCounsel(outcome.report);
  };

  const controlsDisabled = baseControlsDisabled || speechInput.state !== "idle";
  const speechStatus = speechInput.isRecording
    ? "말씀을 듣고 있어요. 다시 누르면 글로 바꿉니다."
    : speechInput.isTranscribing
      ? "음성을 글로 옮기고 있어요."
      : speechInput.error
        ? speechInput.error
        : lastSttMs != null
          ? `음성을 ${lastSttMs} ms에 글로 옮겼어요. 확인 후 전송해 주세요.`
          : speechOutput.error || session.formStatus;
  const providerClass = session.providerSummary.pending
    ? "is-pending"
    : session.providerSummary.ready ? "is-ready" : "is-error";

  return (
    <section
      className={`counseling-overlay ${isOpen ? "is-open" : ""}`}
      aria-hidden={!isOpen}
      aria-label="프바오 상담 화면"
      data-testid="counseling-screen"
    >
      {isOpen && session.runState?.stage === "values" && (
        <ValueSelectionScreen
          onSubmit={async (selectedNumbers) => {
            const numbersString = selectedNumbers.join(", ");
            const outcome = await session.sendMessage(numbersString);
            if (outcome.accepted && outcome.kind === "complete") {
              completeCounsel(outcome.report);
            }
          }}
          busy={session.busy}
        />
      )}
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="#counselTitle" aria-label="프바오 마음상담 홈">
            <span className="brand-mark" aria-hidden="true"><i></i></span>
            <span><strong>프바오 마음상담</strong><small>천천히 말해도 괜찮아요</small></span>
          </a>
          <nav className="top-actions" aria-label="페이지 메뉴">
            <a className="text-link" href="http://127.0.0.1:8000/" target="_blank" rel="noreferrer">A/B 실험실</a>
            <button className="soft-button" type="button" onClick={() => { speechOutput.stop(); speechInput.cancel(); void session.newSession(); }} disabled={session.busy}>새 상담</button>
            <button className="soft-button return-button" type="button" onClick={handleClose}>상담소로 돌아가기</button>
          </nav>
        </header>

        <section className="service-bar" aria-label="상담 모델 연결 상태">
          <div className="connection-copy">
            <span className={`connection-chip ${providerClass}`}><i></i>{session.providerSummary.label}</span>
            <p>{session.providerSummary.detail}</p>
          </div>
          <div className="model-picker" role="radiogroup" aria-label="상담 모델 선택">
            {(["baseline", "optimized"] as const).map((arm) => (
              <button
                key={arm}
                className={`model-option ${session.arm === arm ? "is-active" : ""}`}
                type="button"
                role="radio"
                aria-checked={session.arm === arm}
                disabled={session.busy || session.turnCount > 0}
                title={session.turnCount > 0 ? "모델을 바꾸려면 새 상담을 시작해 주세요." : ""}
                onClick={() => void session.setArm(arm)}
              >
                <span>{session.armLabels[arm].badge}</span>
                <strong>{session.armLabels[arm].option}</strong>
              </button>
            ))}
          </div>
        </section>

        <main className="demo-grid">
          <section className="counsel-card" aria-labelledby="counselTitle">
            <h1 id="counselTitle" className="sr-only">프바오와 나누는 상담</h1>
            <div className="stage-visual" data-state={session.stageState} role="img" aria-label="따뜻한 상담실 책상에 앉아 이야기를 듣는 귀여운 판다 상담사 프바오">
              <img className="room-image" src="/demo-assets/panda-room-v2.png" alt="" />
              <div className="panda-body-layer" aria-hidden="true"><img className="panda-body-sprite" src="/demo-assets/panda-body-noscarf-v3.png" alt="" /></div>
              <div className="panda-head-layer" aria-hidden="true"><img className="panda-head-sprite" src="/demo-assets/panda-head-centered-noscarf-v4.png" alt="" /></div>
              <div className="panda-collar-layer" aria-hidden="true"><img className="panda-body-sprite panda-collar-sprite" src="/demo-assets/panda-body-noscarf-v3.png" alt="" /></div>
              <div className="stage-vignette" aria-hidden="true"></div>
              <div className="presence-pill" aria-live="polite"><span className="presence-dot"></span><strong>{
                { booting: "상담 준비 중", idle: "귀 기울이는 중", thinking: "마음을 살피는 중", talking: "이야기하는 중", error: "연결을 확인해 주세요" }[session.stageState]
              }</strong></div>
              <div className="speech-area">
                <span className="name-tag"><i aria-hidden="true"></i>프바오</span>
                <div className="speech-bubble"><p aria-live="polite">{session.responseText}</p><span className="bubble-tail" aria-hidden="true"></span></div>
              </div>
            </div>
            <div className="stage-meta" aria-label="현재 상담 정보">
              <span><i className="meta-dot"></i><b>{session.armLabels[session.arm].short}</b>으로 상담 중</span>
              <span>{session.firstResponseLatency != null
                ? session.latency == null
                  ? `브라우저 첫 표시 ${session.firstResponseLatency} ms · 서버 전체 계산 중`
                  : `브라우저 첫 표시 ${session.firstResponseLatency} ms · 서버 전체 ${session.latency} ms`
                : session.latency == null
                  ? session.busy ? "응답 시간 측정 중…" : "응답 시간 —"
                  : `서버 전체 ${session.latency} ms`}</span>
              <span>{session.turnCount}번째 이야기</span>
            </div>
          </section>

          <aside className="mind-card" aria-labelledby="mindMapTitle">
            <MindMap state={session.runState} />
            <details className="transcript-panel">
              <summary>대화 기록 보기 <span>{session.transcript.length}</span></summary>
              <div className="transcript-list" ref={transcriptRef}>
                {session.transcript.map((entry, index) => (
                  <div className={`transcript-item ${entry.role}`} key={`${entry.role}-${index}`}>
                    <strong>{entry.role === "user" ? "나" : "프바오"}</strong><span>{entry.text}</span>
                  </div>
                ))}
              </div>
            </details>
          </aside>
        </main>

        <section className="composer-card" aria-labelledby="composerTitle">
          <div className="composer-heading">
            <div><span className="section-kicker">TELL ME YOUR STORY</span><h2 id="composerTitle">지금 마음에 걸리는 일을 말해 주세요</h2></div>
            <p>Enter로 전송 · Shift + Enter로 줄바꿈</p>
          </div>
          <div className="input-shell">
            <textarea
              ref={inputRef}
              rows={3}
              maxLength={4000}
              value={message}
              placeholder="예: 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요."
              aria-describedby="formStatus"
              disabled={controlsDisabled}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              className={`mic-button ${speechInput.isRecording ? "is-recording" : ""}`}
              type="button"
              disabled={baseControlsDisabled || speechInput.state === "requesting" || speechInput.isTranscribing || !speechHealth?.stt.available}
              aria-pressed={speechInput.isRecording}
              title={speechHealth?.stt.available
                ? speechInput.isRecording ? "녹음을 멈추고 글로 바꾸기" : "마이크로 말하기"
                : speechHealth?.stt.reason || "음성 입력을 준비하고 있어요."}
              onClick={() => {
                if (!speechInput.isRecording) speechOutput.stop();
                speechInput.toggle();
              }}
            >
              <span aria-hidden="true">{speechInput.isRecording ? "■" : "●"}</span>
              {speechInput.isRecording ? "말하기 끝" : "음성 입력"}
            </button>
            <button className="send-button" type="button" disabled={controlsDisabled} onClick={() => void submit()}>
              <span>{session.armLabels[session.arm].send}</span><i aria-hidden="true">↗</i>
            </button>
          </div>
          <div className="composer-footer">
            <div className="prompt-chips" aria-label="상담 예시">
              {EXAMPLES.map(([label, example]) => (
                <button key={label} type="button" disabled={session.busy || session.done} onClick={() => { setMessage(example); inputRef.current?.focus(); }}>{label}</button>
              ))}
            </div>
            <div className="speech-controls">
              <button
                className={`voice-toggle ${speechOutput.enabled && ttsAvailable ? "is-on" : ""}`}
                type="button"
                disabled={!ttsAvailable}
                aria-pressed={speechOutput.enabled && ttsAvailable}
                title={ttsAvailable ? "프바오 음성 답변 켜기/끄기" : speechHealth?.tts.reason || "GPT-SoVITS 연결을 확인해 주세요."}
                onClick={() => speechOutput.setEnabled(!speechOutput.enabled)}
              >
                {speechOutput.isSpeaking ? "음성 재생 중" : speechOutput.enabled && ttsAvailable ? "음성 답변 켜짐" : "음성 답변 꺼짐"}
              </button>
              <p id="formStatus" className={`form-status ${session.formError || speechInput.error ? "is-error" : ""}`} role="status">{speechStatus}</p>
            </div>
          </div>
        </section>

        <footer className="safety-note">
          <span>연구·시연용 AI 상담 도구</span>
          <p>의료 진단이나 응급 대응을 대신하지 않아요. 즉각적인 위험이 있다면 112·119 또는 가까운 응급실에 도움을 요청해 주세요.</p>
        </footer>
      </div>
    </section>
  );
}
