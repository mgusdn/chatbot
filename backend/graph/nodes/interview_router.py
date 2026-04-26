"""
interview_router — 면접 phase를 분류하는 노드

SLM을 사용하여 현재 턴이 어떤 면접 phase인지 결정한다.
- technical_question: 기술 질문
- behavioral_question: 인성 질문
- followup_probe: 꼬리질문
- live_qa: 지원자의 질문에 대한 응답
"""

import json
from langchain_core.messages import SystemMessage, HumanMessage
from backend.graph.state import InterviewState
from backend.services.llm import structured_llm_base


ROUTER_SYSTEM_PROMPT = """당신은 면접 흐름을 제어하는 라우터입니다.
지원자의 발화와 현재 면접 상태를 분석하여, 이번 턴에 적절한 면접 phase를 결정하세요.

## Phase 종류
- technical_question: 기술적 역량을 확인하는 질문 차례
- behavioral_question: 인성, 협업, 갈등 해결 등을 확인하는 질문 차례
- followup_probe: 직전 답변의 빈틈을 파고드는 꼬리질문 차례
- live_qa: 지원자가 회사나 직무에 대해 질문한 경우, 짧게 답변하는 차례

## 판단 기준
- 지원자가 "~인가요?", "~인지 궁금합니다" 등 질문을 했으면 live_qa
- 직전 답변에 구체적 수치 부족, 기여 범위 모호, STAR 불완전 등 빈틈이 있으면 followup_probe
- 미검증 역량 중 협업/갈등/리더십/실패 경험이 남아있으면 behavioral_question
- 그 외에는 technical_question

반드시 아래 JSON 형식으로만 응답하세요:
{"proposed_phase": "...", "reason": "...", "should_retrieve": true/false}
"""


def interview_router(state: InterviewState) -> dict:
    """SLM을 사용하여 이번 턴의 면접 phase를 결정한다."""
    user_input = state["user_input"]
    phase_history = state["phase_history"]
    unverified = state["unverified_competencies"]
    asked = state["asked_questions"]
    risks = state["risks"]
    summary = state["short_summary"]

    context = f"""## 현재 상태
- 지원자 발화: "{user_input}"
- 면접 진행 이력: {phase_history[-6:] if phase_history else '없음'}
- 미검증 역량: {unverified}
- 이전 리스크/모호점: {risks[-3:] if risks else '없음'}
- 이전 질문 수: {len(asked)}개
- 대화 요약: {summary if summary else '면접 초반'}
- 현재 난이도: {state['current_difficulty']}
"""

    try:
        response = structured_llm_base.invoke([
            SystemMessage(content=ROUTER_SYSTEM_PROMPT),
            HumanMessage(content=context),
        ])

        content = response.content if isinstance(response.content, str) else str(response.content)

        # /think 태그 제거 (Qwen3 thinking mode 대응)
        if "</think>" in content:
            content = content.split("</think>")[-1].strip()

        # JSON 파싱
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        if json_start != -1 and json_end > json_start:
            parsed = json.loads(content[json_start:json_end])
            proposed = parsed.get("proposed_phase", "technical_question")
            reason = parsed.get("reason", "")
            should_retrieve = parsed.get("should_retrieve", False)

            # 유효한 phase인지 검증
            valid_phases = ["technical_question", "behavioral_question", "followup_probe", "live_qa"]
            if proposed not in valid_phases:
                proposed = "technical_question"

            return {
                "proposed_phase": proposed,
                "phase_reason": reason,
                "should_retrieve": should_retrieve,
            }
    except Exception as e:
        print(f"[interview_router] Error: {e}")

    # 기본 폴백
    return {
        "proposed_phase": "technical_question",
        "phase_reason": "기본 기술 질문 (폴백)",
        "should_retrieve": False,
    }
