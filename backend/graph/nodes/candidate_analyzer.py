"""
candidate_analyzer — 지원자 답변을 분석하는 노드

SLM을 사용하여 답변의 구체성, 깊이, STAR 완성도 등을 분석하고,
다음 질문 전략(next_probe_goal, missing_evidence)을 생성한다.
점수 자체보다 "다음에 뭘 확인해야 하는가"에 집중한다.
"""

import json
from langchain_core.messages import SystemMessage, HumanMessage
from backend.graph.state import InterviewState
from backend.services.llm import structured_llm_base


ANALYZER_SYSTEM_PROMPT = """당신은 면접 답변 분석 전문가입니다.
지원자의 답변을 분석하여 다음 질문 전략을 수립해 주세요.

## 분석 기준
- specificity (0~1): 답변의 구체성. 수치나 사례가 있으면 높음
- depth (0~1): 기술적 깊이. 원리나 이유를 설명하면 높음
- star_completeness (0~1): STAR 프레임워크 완성도 (Situation, Task, Action, Result)
- confidence_level (0~1): 답변의 자신감 수준

## 핵심 출력
- next_probe_goal: 다음 질문에서 확인해야 할 가장 중요한 한 가지
- missing_evidence: 아직 확인되지 않은 증거 목록 (최대 3개)
- ambiguity_flags: 모호하거나 불명확한 부분 (최대 2개)
- difficulty_delta: 난이도 조절 (-1: 쉽게, 0: 유지, 1: 어렵게)

반드시 아래 JSON 형식으로만 응답하세요:
{
  "specificity": 0.0,
  "depth": 0.0,
  "star_completeness": 0.0,
  "confidence_level": 0.0,
  "next_probe_goal": "...",
  "missing_evidence": ["...", "..."],
  "ambiguity_flags": ["...", "..."],
  "difficulty_delta": 0
}
"""


def candidate_analyzer(state: InterviewState) -> dict:
    """SLM을 사용하여 지원자 답변을 분석한다."""
    user_input = state["user_input"]
    final_phase = state["final_phase"]
    target_competencies = state["target_competencies"]
    unverified = state["unverified_competencies"]
    asked = state["asked_questions"]

    # live_qa에서는 분석 생략
    if final_phase == "live_qa":
        return {
            "candidate_analysis": {
                "next_probe_goal": "지원자 질문에 답변 후 면접 복귀",
                "missing_evidence": [],
                "ambiguity_flags": [],
                "difficulty_delta": 0,
            }
        }

    context = f"""## 분석 대상
- 지원자 답변: "{user_input}"
- 현재 phase: {final_phase}
- 확인 중인 역량: {target_competencies}
- 아직 미검증 역량: {unverified}
- 이전 질문 이력: {asked[-3:] if asked else '없음'}
"""

    try:
        response = structured_llm_base.invoke([
            SystemMessage(content=ANALYZER_SYSTEM_PROMPT),
            HumanMessage(content=context),
        ])

        content = response.content if isinstance(response.content, str) else str(response.content)

        # /think 태그 제거
        if "</think>" in content:
            content = content.split("</think>")[-1].strip()

        # JSON 파싱
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        if json_start != -1 and json_end > json_start:
            parsed = json.loads(content[json_start:json_end])
            return {"candidate_analysis": parsed}
    except Exception as e:
        print(f"[candidate_analyzer] Error: {e}")

    # 기본 폴백
    return {
        "candidate_analysis": {
            "next_probe_goal": "구체적인 경험과 수치를 확인",
            "missing_evidence": ["구체적 수치", "본인 기여 범위"],
            "ambiguity_flags": [],
            "difficulty_delta": 0,
        }
    }
