"use client";

import type { PublicCounselState } from "@/types/counseling";

const CORE_SLOTS = ["situation", "thought", "emotion", "behavior", "coping", "goal"] as const;
const SLOT_LABELS: Record<string, string> = {
  situation: "상황", thought: "생각", emotion: "감정", behavior: "행동",
  cause: "원인", impact: "영향", duration: "기간", coping: "대처", goal: "바람",
};
const PLACEHOLDERS: Record<(typeof CORE_SLOTS)[number], string> = {
  situation: "어떤 일이 있었나요?",
  thought: "무슨 생각이 들었나요?",
  emotion: "어떤 감정이었나요?",
  behavior: "어떻게 반응했나요?",
  coping: "무엇을 해보았나요?",
  goal: "어떻게 달라지고 싶나요?",
};

function substantive(value: unknown): value is string {
  return typeof value === "string" && value.replace(/\s+/g, "").length >= 2 && /[0-9A-Za-z가-힣]/.test(value);
}

function joinedValues(values: string[] | undefined) {
  return (values || []).filter(substantive).join(", ");
}

export function MindMap({ state, isBusy }: { state: PublicCounselState; isBusy?: boolean }) {
  const filled = new Set(state.filled_slots || []);
  if (isBusy && state.pending_slot) {
    filled.add(state.pending_slot);
  }
  const entries = CORE_SLOTS.map((slot) => {
    const value = joinedValues(state.slot_values?.[slot]);
    return { slot, value, isFilled: Boolean(value) || filled.has(slot) };
  });
  const count = entries.filter((entry) => entry.isFilled).length;
  const nextClue = state.stage === "done"
    ? "마음 정리가 완성됐어요"
    : state.pending_slot && SLOT_LABELS[state.pending_slot]
      ? `다음 단서 · ${SLOT_LABELS[state.pending_slot]}`
      : count ? "다음 이야기를 기다리고 있어요" : "첫 이야기를 기다리고 있어요";

  return (
    <>
      <header className="mind-header">
        <div>
          <span className="section-kicker">LIVE MIND MAP</span>
          <h2 id="mindMapTitle">내 마음의 연결</h2>
          <p>대화에서 발견된 단서가 차례로 이어져요.</p>
        </div>
        <div className="progress-orb" style={{ "--progress": `${count * 60}deg` } as React.CSSProperties}>
          <strong>{count}</strong><span>/ 6</span>
        </div>
      </header>
      <div className="mind-map" aria-live="polite">
        {entries.slice(0, 2).map((entry) => (
          <article key={entry.slot} className={`mind-node node-${entry.slot} ${entry.isFilled ? "is-filled" : ""}`} data-slot={entry.slot}>
            <span>{SLOT_LABELS[entry.slot]}</span>
            <p>{entry.value || (entry.isFilled ? "관련 단서를 발견했어요." : PLACEHOLDERS[entry.slot])}</p>
          </article>
        ))}
        <div className="mind-center" aria-hidden="true"><i></i><strong>지금의<br />마음</strong></div>
        {entries.slice(2).map((entry) => (
          <article key={entry.slot} className={`mind-node node-${entry.slot} ${entry.isFilled ? "is-filled" : ""}`} data-slot={entry.slot}>
            <span>{SLOT_LABELS[entry.slot]}</span>
            <p>{entry.value || (entry.isFilled ? "관련 단서를 발견했어요." : PLACEHOLDERS[entry.slot])}</p>
          </article>
        ))}
      </div>
      <div className="mind-legend">
        <span><i></i>대화에서 발견됨</span>
        <span>{nextClue}</span>
      </div>
    </>
  );
}
