"""
unified_interviewer — 단일 에이전트 통합 노드

3가지 스트리밍 전략을 지원한다:
  1) response_first  — <response> 먼저, <analysis> 나중에 (TTFT 최소화)
  2) response_only   — 분석 없이 순수 대화만 (가장 빠르고 자연스러움)
  3) think_response  — Qwen3 Thinking 모드 ON + <response> 출력 (고품질)
"""

import json
import re
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from backend.graph.state import InterviewState
from backend.services.llm import llm, llm_think
from backend.mock_data.companies import get_evidence_for_query


# ──────────────────────────────────────────────
# 프롬프트 공통 기반
# ──────────────────────────────────────────────

PERSONA_BASE = """당신은 실무 경력이 풍부한 시니어 기술 면접관입니다.
회사에서 {role_name} 직무 면접을 진행하고 있습니다.

## 페르소나
- 이름: 김현우 팀장
- 성격: 차분하고 논리적. 지원자를 존중하되, 모호한 답변은 구체적으로 파고든다.
- 말투: 정중하지만 직설적. "-습니다", "-세요" 어체를 사용.
- 절대 하지 않는 것: 무례한 표현, 지원자 답변 재작성, 점수 언급

## 회사 정보
{evidence}

## 면접 흐름 규칙
- 같은 대주제(기술/인성)는 최소 2턴 유지한 뒤 전환
- 꼬리질문은 직전 답변의 빈틈이 있을 때 우선 적용
- 지원자가 질문하면 짧게 답변 후 면접으로 자연스럽게 복귀
- 한 번에 하나의 질문만 한다
- 꼬리질문은 하나의 빈틈만 파고든다
- 같은 결함을 2번 이상 반복 추궁하지 않는다
- 기계적이거나 문서 냄새나는 표현을 피한다

## Phase 종류
- technical_question: 기술적 역량 확인 질문
- behavioral_question: 인성/협업/갈등/리더십/실패 경험 확인 질문
- followup_probe: 직전 답변의 빈틈을 파는 꼬리질문
- live_qa: 지원자가 회사/직무에 대해 질문한 경우 짧게 답변 후 면접 복귀
"""

# ──────────────────────────────────────────────
# 전략 1: Response-First (TTFT 최소화)
# ──────────────────────────────────────────────

PROMPT_RESPONSE_FIRST = PERSONA_BASE + """
## 응답 형식
/no_think
반드시 <response> 태그를 먼저 출력하고, 그 다음 <analysis> 태그를 출력하세요.
JSON을 사용하지 마세요. 반드시 XML 태그만 사용하세요.

<response>
면접관의 실제 한국어 발화를 여기에 적으세요. 이 부분만 지원자에게 보입니다.
</response>
<analysis>
phase_decision: technical_question 또는 behavioral_question 또는 followup_probe 또는 live_qa
phase_reason: 이 phase를 선택한 이유
missing_evidence: 지원자 답변에서 부족한 점
next_probe_goal: 다음에 확인해야 할 것
difficulty_delta: -1 또는 0 또는 1
</analysis>
"""

# ──────────────────────────────────────────────
# 전략 4: Response-Only (분석 제거, 순수 대화)
# ──────────────────────────────────────────────

PROMPT_RESPONSE_ONLY = PERSONA_BASE + """
## 응답 형식
/no_think
면접관으로서 자연스럽게 한국어로 대화하세요.
XML 태그나 JSON을 사용하지 말고, 면접관의 발화만 직접 출력하세요.
한 번에 하나의 질문만 하세요.
"""

# ──────────────────────────────────────────────
# 전략 5: Think+Response (Thinking ON, 고품질)
# ──────────────────────────────────────────────

PROMPT_THINK_RESPONSE = PERSONA_BASE + """
## 응답 형식
충분히 생각한 뒤, <response> 태그 안에 면접관의 한국어 발화만 출력하세요.
<response> 태그 외에 다른 텍스트를 출력하지 마세요.

<response>
면접관의 실제 한국어 발화를 여기에 적으세요.
</response>
"""


# ──────────────────────────────────────────────
# 통합 노드
# ──────────────────────────────────────────────

async def unified_interviewer(state: InterviewState, config: RunnableConfig) -> dict:
    """단일 LLM 호출로 면접관 응답을 생성한다. stream_strategy에 따라 프롬프트/파싱 분기."""
    user_input = state["user_input"]
    role_name = state["role_name"]
    company_name = state["company_name"]
    conversation_history = state["conversation_history"]
    phase_history = state["phase_history"]
    last_two = state["last_two_phases"]
    unverified = state["unverified_competencies"]
    asked_questions = state["asked_questions"]
    risks = state["risks"]
    current_difficulty = state["current_difficulty"]
    stream_strategy = state.get("stream_strategy", "response_first")

    # ── Mock evidence 가져오기 ──
    company_id_map = {
        "AI 플랫폼 기업": "ai_platform",
        "핀테크 스타트업": "fintech",
    }
    company_id = company_id_map.get(company_name, "ai_platform")
    evidence = get_evidence_for_query(company_id, user_input, mode="local")

    # ── 전략별 프롬프트 선택 ──
    if stream_strategy == "response_only":
        system_template = PROMPT_RESPONSE_ONLY
    elif stream_strategy == "think_response":
        system_template = PROMPT_THINK_RESPONSE
    else:  # response_first (기본값)
        system_template = PROMPT_RESPONSE_FIRST

    system = system_template.format(
        role_name=role_name,
        evidence=evidence,
    )

    # 이미 한 질문 목록 (중복 방지)
    if asked_questions:
        system += f"\n## 이미 한 질문 (중복 금지)\n"
        for q in asked_questions[-5:]:
            system += f"- {q}\n"

    # ── 대화 이력 구성 (최근 6턴) ──
    recent_history = conversation_history[-6:] if conversation_history else []
    history_text = ""
    for msg in recent_history:
        role_label = "지원자" if msg["role"] == "user" else "면접관"
        history_text += f"{role_label}: {msg['content']}\n"

    # ── 사용자 메시지 ──
    if stream_strategy == "response_only":
        format_instruction = "면접관으로서 자연스럽게 답변하세요."
    else:
        format_instruction = "<response> 태그 형식으로 응답하세요."

    user_message = f"""## 현재 면접 상태
- 진행된 턴: {len(phase_history)}턴
- 최근 phase 이력: {phase_history[-4:] if phase_history else '없음'}
- 최근 대주제 이력: {last_two}
- 미검증 역량: {unverified}
- 이전 리스크: {risks[-3:] if risks else '없음'}
- 현재 난이도: {current_difficulty}/5

## 대화 이력
{history_text if history_text else '(면접 시작)'}

## 지원자의 최신 발화
"{user_input}"

{format_instruction}"""

    # ── 전략별 LLM 선택 ──
    selected_llm = llm_think if stream_strategy == "think_response" else llm

    try:
        response = await selected_llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user_message),
        ], config=config)

        content = response.content if isinstance(response.content, str) else str(response.content)

        # </think> 태그 제거 (Qwen3 thinking mode 대응)
        if "</think>" in content:
            content = content.split("</think>")[-1].strip()

        # ── 전략별 파싱 ──
        if stream_strategy == "response_only":
            return _parse_response_only(content, evidence)
        elif stream_strategy == "think_response":
            return _parse_xml_response(content, evidence)
        else:  # response_first
            return _parse_xml_response(content, evidence)

    except Exception as e:
        print(f"[unified_interviewer] Error: {e}")
        import traceback
        traceback.print_exc()

    # ── 폴백 ──
    return _fallback_result(content if 'content' in dir() else "", evidence)


def _parse_xml_response(content: str, evidence: str) -> dict:
    """<response> 및 <analysis> XML 태그에서 데이터를 추출한다."""
    response_text = ""
    phase = "technical_question"
    phase_reason = ""
    missing_evidence = []
    next_probe_goal = ""
    difficulty_delta = 0

    # response 태그 추출
    response_match = re.search(r"<response>(.*?)</response>", content, re.DOTALL)
    if response_match:
        response_text = response_match.group(1).strip()
    elif "<response>" in content:
        response_text = content.split("<response>")[-1].strip()
        # 혹시 </response>가 뒤에 있으면 제거
        if "</response>" in response_text:
            response_text = response_text.split("</response>")[0].strip()
    else:
        response_text = content.strip()

    # analysis 태그 추출
    analysis_match = re.search(r"<analysis>(.*?)</analysis>", content, re.DOTALL)
    if analysis_match:
        analysis_text = analysis_match.group(1).strip()
        for line in analysis_text.split('\n'):
            line_lower = line.strip().lower()
            if "phase_decision" in line_lower:
                for p in ["technical_question", "behavioral_question", "followup_probe", "live_qa"]:
                    if p in line_lower:
                        phase = p
                        break
            elif "phase_reason" in line_lower:
                phase_reason = line.strip().split(":", 1)[-1].strip()
            elif "missing_evidence" in line_lower:
                val = line.strip().split(":", 1)[-1].strip()
                if val and val != "없음":
                    missing_evidence.append(val)
            elif "next_probe_goal" in line_lower:
                next_probe_goal = line.strip().split(":", 1)[-1].strip()
            elif "difficulty_delta" in line_lower:
                if "-1" in line_lower:
                    difficulty_delta = -1
                elif "1" in line_lower:
                    difficulty_delta = 1

    # "면접관:" 접두사 제거
    if response_text.startswith("면접관:"):
        response_text = response_text[len("면접관:"):].strip()

    candidate_analysis = {
        "next_probe_goal": next_probe_goal,
        "missing_evidence": missing_evidence,
        "ambiguity_flags": missing_evidence,
        "difficulty_delta": difficulty_delta,
        "specificity": 0.5,
        "depth": 0.5,
    }

    return {
        "proposed_phase": phase,
        "final_phase": phase,
        "phase_reason": phase_reason,
        "candidate_analysis": candidate_analysis,
        "should_retrieve": False,
        "evidence_summary": evidence,
        "interviewer_response": response_text,
    }


def _parse_response_only(content: str, evidence: str) -> dict:
    """순수 대화 모드 — 텍스트 전체가 면접관 발화."""
    response_text = content.strip()

    # 혹시 XML 태그가 포함됐으면 제거
    if "<response>" in response_text:
        match = re.search(r"<response>(.*?)</response>", response_text, re.DOTALL)
        if match:
            response_text = match.group(1).strip()

    if response_text.startswith("면접관:"):
        response_text = response_text[len("면접관:"):].strip()

    return {
        "proposed_phase": "technical_question",
        "final_phase": "technical_question",
        "phase_reason": "순수 대화 모드 (분석 비활성)",
        "candidate_analysis": {
            "next_probe_goal": "",
            "missing_evidence": [],
            "ambiguity_flags": [],
            "difficulty_delta": 0,
            "specificity": 0.5,
            "depth": 0.5,
        },
        "should_retrieve": False,
        "evidence_summary": evidence,
        "interviewer_response": response_text,
    }


def _fallback_result(content: str, evidence: str) -> dict:
    """폴백: 파싱 실패 시 기본 응답."""
    fallback_response = "이전 경험에 대해 조금 더 구체적으로 설명해 주시겠어요?"
    if content and len(content) > 10:
        clean = content.strip()
        if not clean.startswith("{") and not clean.startswith("<"):
            fallback_response = clean

    return {
        "proposed_phase": "technical_question",
        "final_phase": "technical_question",
        "phase_reason": "폴백",
        "candidate_analysis": {
            "next_probe_goal": "구체적 경험 확인",
            "missing_evidence": [],
            "ambiguity_flags": [],
            "difficulty_delta": 0,
        },
        "should_retrieve": False,
        "evidence_summary": evidence,
        "interviewer_response": fallback_response,
    }
