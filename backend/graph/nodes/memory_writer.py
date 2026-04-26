"""
memory_writer — 세션 메모리를 갱신하는 노드

각 턴의 결과를 누적 저장하여 이후 턴 제어에 활용한다.
"""

from backend.graph.state import InterviewState


def memory_writer(state: InterviewState) -> dict:
    """턴 결과를 메모리에 누적 저장한다."""
    final_phase = state["final_phase"]
    interviewer_response = state["interviewer_response"]
    candidate_analysis = state["candidate_analysis"] or {}
    user_input = state["user_input"]

    # 대화 이력에 면접관 응답 추가
    conversation_history = list(state["conversation_history"])
    conversation_history.append({
        "role": "interviewer",
        "content": interviewer_response,
    })

    # phase 이력 갱신
    phase_history = list(state["phase_history"])
    phase_history.append(final_phase)

    # last_two_phases 갱신 (대주제만: technical, behavioral)
    last_two = list(state["last_two_phases"])
    if final_phase in ("technical_question", "behavioral_question"):
        last_two.append(final_phase)
        if len(last_two) > 2:
            last_two = last_two[-2:]

    # 질문 이력 갱신
    asked_questions = list(state["asked_questions"])
    if final_phase != "live_qa":
        # 면접관 응답을 질문으로 기록
        asked_questions.append(interviewer_response[:80])  # 처음 80자만

    # 강점/리스크 갱신
    strengths = list(state["strengths"])
    risks = list(state["risks"])

    if candidate_analysis:
        # 구체적이고 깊이 있는 답변이면 강점에 추가
        specificity = candidate_analysis.get("specificity", 0)
        depth = candidate_analysis.get("depth", 0)
        if specificity > 0.7 and depth > 0.7:
            strengths.append(f"턴{state['turn_id']}: {user_input[:50]}")
            if len(strengths) > 5:
                strengths = strengths[-5:]

        # 모호한 부분이 있으면 리스크에 추가
        ambiguity = candidate_analysis.get("ambiguity_flags", [])
        for flag in ambiguity:
            if flag and flag not in risks:
                risks.append(flag)
        if len(risks) > 5:
            risks = risks[-5:]

    # 미검증 역량 갱신 (높은 점수 받은 역량은 제거)
    unverified = list(state["unverified_competencies"])
    if candidate_analysis:
        role_fit = candidate_analysis.get("role_fit", 0)
        if role_fit > 0.8 and unverified:
            # 가장 앞의 역량을 검증 완료로 처리 (간단 구현)
            unverified = unverified[1:]

    # 난이도 조절
    current_difficulty = state["current_difficulty"]
    difficulty_delta = candidate_analysis.get("difficulty_delta", 0) if candidate_analysis else 0
    current_difficulty = max(1, min(5, current_difficulty + difficulty_delta))

    # retrieval 카운트 갱신
    retrieval_count = state["retrieval_count_recent"]
    if state["should_retrieve"]:
        retrieval_count += 1
    # 3턴마다 리셋
    if state["turn_id"] % 3 == 0:
        retrieval_count = 0

    # 대화 요약 갱신 (간단 — 최근 대화 기반)
    recent_exchanges = conversation_history[-4:]
    summary_parts = []
    for msg in recent_exchanges:
        role = "후보자" if msg["role"] == "user" else "면접관"
        summary_parts.append(f"{role}: {msg['content'][:40]}")
    short_summary = " | ".join(summary_parts)

    return {
        "conversation_history": conversation_history,
        "phase_history": phase_history,
        "last_two_phases": last_two,
        "asked_questions": asked_questions,
        "strengths": strengths,
        "risks": risks,
        "unverified_competencies": unverified,
        "current_difficulty": current_difficulty,
        "retrieval_count_recent": retrieval_count,
        "short_summary": short_summary,
    }
