"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCounselingSession } from "@/hooks/useCounselingSession";
import { useSpeechOutput } from "@/hooks/useSpeechOutput";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
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
  const voiceAvailable = Boolean(speechHealth?.stt.available && ttsAvailable);

  const handleVoiceTranscript = useCallback(async (text: string, sttMs: number) => {
    setMessage(text);
    setLastSttMs(Math.round(sttMs));
    const outcome = await session.sendMessage(text);
    if (outcome.accepted) setMessage("");
    if (outcome.accepted && outcome.kind === "complete") completeCounsel(outcome.report);
  }, [completeCounsel, session.sendMessage]);

  const voiceConversation = useVoiceConversation({
    available: voiceAvailable,
    canListen: Boolean(
      isOpen
      && session.experimentId
      && !session.busy
      && !session.done
      && session.runState.stage !== "values"
      && !speechOutput.isSpeaking
    ),
    onTranscript: handleVoiceTranscript,
  });

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
    voiceConversation.stop();
    speechOutput.stop();
    const canceledPendingTurn = session.cancelPendingTurn();
    closeCounsel();
    if (canceledPendingTurn) void session.newSession();
  }, [closeCounsel, session.cancelPendingTurn, session.newSession, speechOutput.stop, voiceConversation.stop]);

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

  const submit = async () => {
    if (voiceConversation.active) return;
    speechOutput.stop();
    void speechOutput.prime();
    const outcome = await session.sendMessage(message);
    if (outcome.accepted) setMessage("");
    else inputRef.current?.focus();
    if (outcome.accepted && outcome.kind === "complete") completeCounsel(outcome.report);
  };

  const controlsDisabled = baseControlsDisabled || voiceConversation.active;
  const speechStatus = voiceConversation.active
    ? voiceConversation.error || speechOutput.error
      || (voiceConversation.state === "starting"
        ? "목소리 대화를 준비하고 있어요."
        : voiceConversation.state === "listening"
          ? "목소리를 기다리고 있어요. 편하게 말씀해 주세요."
          : voiceConversation.state === "speaking"
            ? "말씀을 듣고 있어요. 멈추면 자동으로 전할게요."
            : voiceConversation.state === "transcribing"
              ? "음성을 글로 옮기고 있어요."
              : speechOutput.isSpeaking
                ? "프바오가 이야기하고 있어요. 끝나면 다시 들을게요."
                : session.busy
                  ? "프바오가 마음을 살피고 있어요."
                  : "잠시 후 다음 목소리를 들을게요.")
    : lastSttMs != null
      ? `마지막 음성을 ${lastSttMs} ms에 글로 옮겼어요.`
      : speechOutput.error || session.formStatus;
  return (
    <section
      className={`counseling-overlay ${isOpen ? "is-open" : ""}`}
      aria-hidden={!isOpen}
      aria-label="프바오와 나 찾기 화면"
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
          <a className="brand" href="#counselTitle" aria-label="프바오와 나 찾기 홈">
            <span className="brand-mark" aria-hidden="true"><i></i></span>
            <span><strong>프바오와 나 찾기</strong><small>천천히 말해도 괜찮아요</small></span>
          </a>
          <nav className="top-actions" aria-label="페이지 메뉴">
            <button className="soft-button" type="button" onClick={() => { voiceConversation.stop(); speechOutput.stop(); void session.newSession(); }} disabled={session.busy}>새 상담</button>
            <button className="soft-button return-button" type="button" onClick={handleClose}>상담소로 돌아가기</button>
          </nav>
        </header>

        <main className="demo-grid">
          <section className="counsel-card" aria-labelledby="counselTitle">
            <h1 id="counselTitle" className="sr-only">프바오와 나 찾기</h1>
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
              className={`mic-button ${voiceConversation.active ? "is-recording" : ""}`}
              type="button"
              disabled={!voiceConversation.active && (baseControlsDisabled || !voiceAvailable)}
              aria-pressed={voiceConversation.active}
              title={voiceAvailable
                ? voiceConversation.active ? "목소리 대화 종료" : "목소리로 프바오와 대화 시작"
                : speechHealth?.stt.reason || speechHealth?.tts.reason || "음성 대화를 준비하고 있어요."}
              onClick={() => {
                if (voiceConversation.active) {
                  voiceConversation.stop();
                  return;
                }
                speechOutput.stop();
                speechOutput.setEnabled(true);
                void speechOutput.prime();
                void voiceConversation.start();
              }}
            >
              <span aria-hidden="true">{voiceConversation.active ? "■" : "●"}</span>
              {voiceConversation.active ? "목소리 대화 종료" : "목소리 대화 시작"}
            </button>
            <button className="send-button" type="button" disabled={controlsDisabled} onClick={() => void submit()}>
              <span>프바오에게 전하기</span><i aria-hidden="true">↗</i>
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
                onClick={() => {
                  if (voiceConversation.active && speechOutput.enabled) voiceConversation.stop();
                  speechOutput.setEnabled(!speechOutput.enabled);
                }}
              >
                {speechOutput.isSpeaking ? "음성 재생 중" : speechOutput.enabled && ttsAvailable ? "음성 답변 켜짐" : "음성 답변 꺼짐"}
              </button>
              <p id="formStatus" className={`form-status ${session.formError || voiceConversation.error ? "is-error" : ""}`} role="status">{speechStatus}</p>
            </div>
          </div>
        </section>

        <footer className="safety-note">
          <span>프바오와 나 찾기</span>
          <p>의료 진단이나 응급 대응을 대신하지 않아요. 즉각적인 위험이 있다면 112·119 또는 가까운 응급실에 도움을 요청해 주세요.</p>
        </footer>
      </div>
    </section>
  );
}
