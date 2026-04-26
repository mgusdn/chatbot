"""
interviewer_gen — 실제 면접 질문/응답을 생성하는 핵심 노드

설계서에서 가장 중요한 노드. SLM을 사용하여
현재 phase, 후보자 분석 결과, 회사 정보를 바탕으로
자연스러운 면접 질문을 생성한다.
"""

from langchain_core.messages import SystemMessage, HumanMessage
from backend.graph.state import InterviewState
from backend.services.llm import llm


INTERVIEWER_BASE_PROMPT = """당신은 실무 경력이 풍부한 시니어 기술 면접관입니다.
회사에서 {role_name} 직무 면접을 진행하고 있습니다.

## 페르소나
- 이름: 김현우 팀장
- 성격: 차분하고 논리적. 지원자를 존중하되, 모호한 답변은 구체적으로 파고든다.
- 말투: 정중하지만 직설적. "-습니다", "-세요" 어체를 사용.
- 절대 하지 않는 것: 무례한 표현, 지원자 답변 재작성, 점수 언급

## 회사 정보
{evidence}

## 핵심 규칙
1. 한 번에 하나의 질문만 한다
2. 꼬리질문은 하나의 빈틈만 파고든다
3. 기계적이거나 문서 냄새나는 표현을 피한다
4. 자연스러운 대화 흐름을 유지한다
5. 이전 답변 내용을 자연스럽게 연결한다
"""

PHASE_INSTRUCTIONS = {
    "technical_question": """## 현재 모드: 기술 질문
- 직무 역량과 연결되는 기술 질문을 한다
- 회사의 기술 스택과 연결 가능하면 연결한다
- 경험 기반 질문을 선호한다 (이론 질문보다)
- 예: "~하신 경험이 있나요? 어떻게 접근하셨나요?"
""",

    "behavioral_question": """## 현재 모드: 인성/행동 질문
- 협업, 갈등 해결, 리더십, 실패 경험 등을 확인한다
- STAR 프레임워크를 자연스럽게 유도한다 (명시적으로 "STAR로 답하세요"라고 하지 않는다)
- 예: "팀에서 의견이 충돌했던 경험이 있다면, 어떻게 해결하셨나요?"
""",

    "followup_probe": """## 현재 모드: 꼬리질문
- 직전 답변에서 하나의 빈틈만 선택하여 파고든다
- 빈틈 후보: 수치 부재, 본인 기여 범위 불명확, 결과 미언급, 과정 생략
- 같은 결함을 2번 이상 반복 추궁하지 않는다
- 자연스럽게 "방금 말씀하신 ~에서..." 형태로 연결한다
""",

    "live_qa": """## 현재 모드: 지원자 질문 응답
- 지원자의 질문에 2~3문장 이내로 간결하게 답한다
- 회사 정보를 바탕으로 성실하게 답변한다
- 답변 끝에 면접 질문으로 자연스럽게 복귀한다
- 복귀 문장 예: "그럼 이어서, 방금 말씀하신 ~에 대해 조금 더 여쭤볼게요."
""",
}


def interviewer_gen(state: InterviewState) -> dict:
    """면접 질문 또는 응답을 생성한다."""
    final_phase = state["final_phase"]
    user_input = state["user_input"]
    evidence = state["evidence_summary"]
    role_name = state["role_name"]
    company_name = state["company_name"]
    candidate_analysis = state["candidate_analysis"] or {}
    conversation_history = state["conversation_history"]
    short_summary = state["short_summary"]
    current_difficulty = state["current_difficulty"]
    asked_questions = state["asked_questions"]

    # 시스템 프롬프트 구성
    system = INTERVIEWER_BASE_PROMPT.format(
        role_name=role_name,
        evidence=evidence if evidence else f"회사: {company_name}",
    )

    # phase별 지시사항 추가
    phase_instruction = PHASE_INSTRUCTIONS.get(final_phase, "")
    system += "\n" + phase_instruction

    # 후보자 분석 결과 포함
    if candidate_analysis:
        probe_goal = candidate_analysis.get("next_probe_goal", "")
        missing = candidate_analysis.get("missing_evidence", [])
        ambiguity = candidate_analysis.get("ambiguity_flags", [])
        difficulty_delta = candidate_analysis.get("difficulty_delta", 0)

        system += f"""
## 답변 분석 결과
- 다음 확인 목표: {probe_goal}
- 미확인 증거: {', '.join(missing) if missing else '없음'}
- 모호한 부분: {', '.join(ambiguity) if ambiguity else '없음'}
- 난이도 조절: {'올리기' if difficulty_delta > 0 else '유지' if difficulty_delta == 0 else '내리기'}
"""

    # 대화 이력 구성 (최근 6턴)
    recent_history = conversation_history[-6:] if conversation_history else []
    history_text = ""
    for msg in recent_history:
        role_label = "지원자" if msg["role"] == "user" else "면접관"
        history_text += f"{role_label}: {msg['content']}\n"

    # 이전에 한 질문 목록 (중복 방지)
    if asked_questions:
        system += f"\n## 이미 한 질문 (중복 금지)\n{chr(10).join('- ' + q for q in asked_questions[-5:])}\n"

    # 사용자 메시지 구성
    user_message = f"""## 대화 이력
{history_text if history_text else '(면접 시작)'}

## 지원자의 최신 발화
"{user_input}"

위 내용을 바탕으로 면접관으로서 다음 발화를 생성하세요.
면접관의 발화만 작성하세요. "면접관:" 접두사 없이 순수 발화 내용만 작성하세요.
"""

    try:
        response = llm.invoke([
            SystemMessage(content=system),
            HumanMessage(content=user_message),
        ])

        content = response.content if isinstance(response.content, str) else str(response.content)

        # /think 태그 제거 (Qwen3 thinking mode 대응)
        if "</think>" in content:
            content = content.split("</think>")[-1].strip()

        # "면접관:" 접두사 제거
        if content.startswith("면접관:"):
            content = content[len("면접관:"):].strip()
        if content.startswith("Interviewer:"):
            content = content[len("Interviewer:"):].strip()

        return {"interviewer_response": content}

    except Exception as e:
        print(f"[interviewer_gen] Error: {e}")
        return {
            "interviewer_response": "이전 경험에 대해 조금 더 구체적으로 설명해 주시겠어요?"
        }
