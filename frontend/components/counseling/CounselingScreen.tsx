"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCounselingSession } from "@/hooks/useCounselingSession";
import { useSpeechOutput } from "@/hooks/useSpeechOutput";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { speechApi, type SpeechHealth } from "@/lib/api/speechClient";
import { useGameStore } from "@/store/useGameStore";
import { MindMap } from "./MindMap";
import { ValueSelectionScreen } from "./ValueSelectionScreen";

const SLOT_EXAMPLES: Record<string, readonly (readonly [string, string])[]> = {
  situation: [
    ["미루는 습관", "요즘 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요."],
    ["관계 걱정", "사람들을 만나고 나면 제가 이상하게 말한 것 같아서 계속 걱정돼요."],
    ["잠들기 어려움", "밤에 생각이 많아져서 잠들기가 어렵고 다음 날 너무 피곤해요."],
    ["진로 고민", "취업 준비를 몇 년째 하고 있는데 계속 떨어져서 이 길이 맞나 싶어요."],
    ["자존감 저하", "작은 실수 하나에도 저 자신을 심하게 몰아세우게 돼요."],
  ],
  emotion: [
    ["미루는 습관", "일을 또 미뤘다는 생각에 답답하고 저 자신한테 실망스러워요."],
    ["관계 걱정", "그 자리를 떠올리면 창피하고 불안한 마음이 들어요."],
    ["잠들기 어려움", "잠을 설치고 나면 무기력하고 답답해요."],
    ["진로 고민", "이러다 영영 자리를 못 잡을까봐 불안하고 초조해요."],
    ["자존감 저하", "제가 한심하고 괴로워요."],
  ],
  thought: [
    ["미루는 습관", "나는 왜 항상 이렇게 미루기만 할까 하는 생각이 들어요."],
    ["관계 걱정", "다들 나를 이상하게 봤을 것 같다는 생각이 계속 들어요."],
    ["잠들기 어려움", "내일도 못 잘까봐 걱정하는 생각이 머릿속을 떠나지 않아요."],
    ["진로 고민", "남들은 다 앞서가는데 나만 제자리인 것 같다는 생각이 들어요."],
    ["자존감 저하", "다른 사람들 눈엔 부족한 나를 다들 알아챌 것 같다는 생각이 계속 들어요."],
  ],
  // Disabled with the five non-core slots in backend/counsel/state.py.
  // These are keyed by pending_slot, so they are unreachable until the
  // matching slot is uncommented there.
  // cause: [
  //   ["미루는 습관", "완벽하게 하지 못할 바엔 시작을 미루는 게 편해서 그런 것 같아요."],
  //   ["관계 걱정", "예전에 말실수했던 기억이 자꾸 떠올라서 그런 것 같아요."],
  //   ["잠들기 어려움", "낮 동안 정리 못 한 걱정거리들이 밤에 한꺼번에 떠올라서 그런 것 같아요."],
  //   ["진로 고민", "한 번 실패하면 돌이킬 수 없을 것 같다는 생각 때문에 더 조급해지는 것 같아요."],
  //   ["자존감 저하", "예전부터 잘해도 칭찬보다 지적을 많이 들어서 그런 것 같아요."],
  // ],
  behavior: [
    ["미루는 습관", "마감이 코앞에 닥쳐야 겨우 시작하고, 그전까진 계속 딴짓을 해요."],
    ["관계 걱정", "사람 만나는 자리를 이런저런 핑계로 피하게 돼요."],
    ["잠들기 어려움", "잠들려고 누워서도 계속 휴대폰을 들여다보게 돼요."],
    ["진로 고민", "자꾸 다른 사람 근황을 찾아보면서 저랑 비교하게 돼요."],
    ["자존감 저하", "잘한 일도 자꾸 깎아내리고 인정을 못 해요."],
  ],
  // duration: [
  //   ["미루는 습관", "몇 달째 그랬고, 마감 있는 일마다 매번 반복돼요."],
  //   ["관계 걱정", "두 달 전부터 사람을 만날 때마다 매번 그래요."],
  //   ["잠들기 어려움", "3주 정도 됐고, 거의 매일 밤 그래요."],
  //   ["진로 고민", "1년 넘게 이런 상태고, 서류 결과 나올 때마다 심해져요."],
  //   ["자존감 저하", "꽤 오래됐는데, 특히 최근 두 달 새 거의 매일 심해지는 것 같아요."],
  // ],
  // impact: [
  //   ["미루는 습관", "마감 직전에 몰아서 하다 보니 결과물 퀄리티도 떨어지고 스트레스도 심해져요."],
  //   ["관계 걱정", "만남 자체가 부담스러워져서 약속을 점점 줄이게 돼요."],
  //   ["잠들기 어려움", "다음 날 계속 피곤해서 일에 집중이 잘 안 돼요."],
  //   ["진로 고민", "자신감이 떨어져서 지원할 수 있는 자리인데도 도전을 자꾸 미루게 돼요."],
  //   ["자존감 저하", "그래서 새로운 업무를 맡아보라는 제안도 자꾸 거절하게 돼요."],
  // ],
  // relationship: [
  //   ["미루는 습관", "팀원들한테 계속 민폐를 끼치는 것 같아서 점점 부담스러워하고 거리를 두게 돼요."],
  //   ["관계 걱정", "친했던 친구들과도 점점 연락이 뜸해졌어요."],
  //   ["잠들기 어려움", "예민해져서 가족들과 자주 다투게 되고 관계가 서먹해졌어요."],
  //   ["진로 고민", "친구들 만나면 취업 얘기 나올까봐 약속을 피하게 돼요."],
  //   ["자존감 저하", "가까운 친구들 앞에서도 부족한 모습을 들킬까봐 점점 연락을 피하고 멀어지게 돼요."],
  // ],
  coping: [
    ["미루는 습관", "할 일 목록을 계획대로 시도해봤는데 효과가 오래가지 않아요."],
    ["관계 걱정", "만나기 전에 할 말을 미리 연습해봤는데 크게 도움은 안 됐어요."],
    ["잠들기 어려움", "자기 전에 휴대폰을 안 보려고 시도해봤는데 효과가 오래 유지되지 않아요."],
    ["진로 고민", "면접 스터디를 몇 달 다녔는데 그때뿐이고 크게 나아지진 않았어요."],
    ["자존감 저하", "자기 전에 칭찬 일기를 써보려고 시도했는데 효과가 오래 유지되지 않았어요."],
  ],
  goal: [
    ["미루는 습관", "미리미리 시작해서 여유 있게 마무리하고 싶어요."],
    ["관계 걱정", "만남 후에 곱씹지 않고 편하게 넘기고 싶어요."],
    ["잠들기 어려움", "누우면 금방 잠들고 싶어요."],
    ["진로 고민", "하루에 이력서 하나씩이라도 꾸준히 넣으면서 준비하고 싶어요."],
    ["자존감 저하", "작은 실수를 해도 스스로를 다그치지 않고 넘어가고 싶어요."],
  ],
  // self_message: [
  //   ["미루는 습관", "완벽하지 않아도 괜찮으니 일단 시작해보자고 말해주고 싶어요."],
  //   ["관계 걱정", "그 정도 실수는 아무도 신경 안 쓴다고 말해주고 싶어요."],
  //   ["잠들기 어려움", "오늘 하루도 충분히 애썼다고, 이제 마음 편히 쉬어도 된다고 말해주고 싶어요."],
  //   ["진로 고민", "지금 잠깐 늦더라도 그게 실패는 아니라고 말해주고 싶어요."],
  //   ["자존감 저하", "지금 이대로도 충분히 괜찮은 사람이라고 말해주고 싶어요."],
  // ],
} as const;

const DEFAULT_EXAMPLES = SLOT_EXAMPLES.situation;

const RAPPORT_EXAMPLES: Record<string, readonly (readonly [string, string])[]> = {
  greeting: [
    ["예시 답안", "안녕하세요, 저도 만나서 반가워요."],
  ],
  mood: [
    ["예시 답안", "오늘은 그냥 그런 것 같아요."],
  ],
  how: [
    ["예시 답안", "네, 편하게 왔어요."],
  ],
  who: [
    ["예시 답안", "친구가 추천해줘서 알게 됐어요."],
  ],
} as const;

export function CounselingScreen({
  isOpen,
  shouldPrepare,
  participantName,
}: {
  isOpen: boolean;
  shouldPrepare: boolean;
  participantName: string;
}) {
  const [speechHealth, setSpeechHealth] = useState<SpeechHealth | null>(null);
  const [lastSttMs, setLastSttMs] = useState<number | null>(null);
  const ttsAvailable = Boolean(
    speechHealth?.tts.configured && speechHealth.tts.connected !== false,
  );
  const speechOutput = useSpeechOutput({ available: ttsAvailable });
  const session = useCounselingSession(shouldPrepare, speechOutput.enqueue, participantName);
  const currentExamples = session.runState.stage === "rapport"
    ? RAPPORT_EXAMPLES[session.runState.rapport_step ?? ""] ?? DEFAULT_EXAMPLES
    : SLOT_EXAMPLES[session.runState.pending_slot ?? ""] ?? DEFAULT_EXAMPLES;
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
    window.setTimeout(() => inputRef.current?.focus(), 0);
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
                <div className="speech-bubble"><div className="speech-bubble-scroll"><p aria-live="polite">{session.responseText}</p></div><span className="bubble-tail" aria-hidden="true"></span></div>
              </div>
            </div>
          </section>

          <aside className="mind-card" aria-labelledby="mindMapTitle">
            <MindMap state={session.runState} isBusy={session.busy} />
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
            <div><span className="section-kicker">TELL ME YOUR STORY</span><h2 id="composerTitle">당신의 이야기를 편하게 들려주세요</h2></div>
            <p>Enter로 전송 · Shift + Enter로 줄바꿈</p>
          </div>
          <div className="input-shell">
            <textarea
              ref={inputRef}
              rows={3}
              maxLength={4000}
              value={message}
              placeholder={`예: ${currentExamples[0][1]}`}
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
              {currentExamples.map(([label, example]) => (
                <button key={example} type="button" disabled={session.busy || session.done} onClick={() => { setMessage(example); inputRef.current?.focus(); }}>{label}</button>
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
