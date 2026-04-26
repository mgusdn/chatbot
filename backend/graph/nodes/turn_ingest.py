"""
turn_ingest — 사용자 입력을 표준화하는 노드

STT 없이 텍스트 입력을 받아 turn 정보를 구성한다.
"""

from backend.graph.state import InterviewState


def turn_ingest(state: InterviewState) -> dict:
    """사용자 텍스트 입력을 표준화하고 턴 ID를 증가시킨다."""
    new_turn_id = state["turn_id"] + 1
    user_input = state["user_input"].strip()

    # 대화 이력에 사용자 발화 추가
    conversation_history = list(state["conversation_history"])
    conversation_history.append({
        "role": "user",
        "content": user_input,
    })

    return {
        "turn_id": new_turn_id,
        "conversation_history": conversation_history,
    }
