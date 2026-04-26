"""
phase_guard — phase 전환을 안정화하는 노드

순수 규칙 기반으로 면접 흐름이 너무 자주 튀지 않도록 보정한다.
SLM 호출 없음 — 빠르고 예측 가능한 동작.
"""

from backend.graph.state import InterviewState


def phase_guard(state: InterviewState) -> dict:
    """router가 제안한 phase를 규칙 기반으로 보정한다."""
    proposed = state["proposed_phase"]
    last_two = state["last_two_phases"]
    phase_history = state["phase_history"]

    # 규칙 1: live_qa는 항상 허용 (지원자 질문은 즉시 대응)
    if proposed == "live_qa":
        return {
            "final_phase": "live_qa",
            "phase_reason": "지원자 질문 — 즉시 응답",
        }

    # 규칙 2: followup_probe는 직전 phase를 따라가므로 우선 허용
    if proposed == "followup_probe":
        return {
            "final_phase": "followup_probe",
            "phase_reason": "직전 답변 빈틈 — 꼬리질문 우선",
        }

    # 규칙 3: 같은 대주제는 최소 2턴 유지
    if len(last_two) >= 1:
        current_axis = last_two[-1]
        if current_axis in ("technical_question", "behavioral_question"):
            # 현재 축에서 연속 턴 수 계산
            consecutive = 0
            for p in reversed(phase_history):
                if p == current_axis or p == "followup_probe":
                    consecutive += 1
                else:
                    break

            if consecutive < 2 and proposed != current_axis:
                return {
                    "final_phase": current_axis,
                    "phase_reason": f"최소 2턴 유지 규칙 — {current_axis} 유지 ({consecutive}턴째)",
                }

    # 규칙 4: 3턴 내 재왕복 방지 (tech → behavioral → tech)
    if len(last_two) >= 2:
        if (
            last_two[-2] == proposed
            and last_two[-1] != proposed
            and proposed in ("technical_question", "behavioral_question")
        ):
            return {
                "final_phase": last_two[-1],
                "phase_reason": f"3턴 재왕복 방지 — {last_two[-1]} 유지",
            }

    # 규칙 통과 — 제안된 phase 승인
    return {
        "final_phase": proposed,
        "phase_reason": f"전환 승인: {proposed}",
    }
