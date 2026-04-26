"""
retrieval_planner — GraphRAG 호출 여부와 검색 모드를 결정하는 노드

규칙 기반으로 retrieve/skip을 결정한다.
"""

from backend.graph.state import InterviewState


def retrieval_planner(state: InterviewState) -> dict:
    """GraphRAG 호출 여부를 규칙 기반으로 결정한다."""
    final_phase = state["final_phase"]
    retrieval_count = state["retrieval_count_recent"]
    should_retrieve_hint = state["should_retrieve"]

    # 규칙 1: 최근 retrieval이 2회 이상이면 skip 우선
    if retrieval_count >= 2:
        return {
            "should_retrieve": False,
            "evidence_summary": "",
        }

    # 규칙 2: followup_probe는 기본 skip (메모리 기반)
    if final_phase == "followup_probe":
        return {
            "should_retrieve": False,
            "evidence_summary": "",
        }

    # 규칙 3: technical_question은 JD grounding 필요 시 retrieve
    if final_phase == "technical_question" and should_retrieve_hint:
        return {
            "should_retrieve": True,
            "evidence_summary": "",  # company_graphrag에서 채움
        }

    # 규칙 4: behavioral_question은 인재상/문화 필요 시 retrieve
    if final_phase == "behavioral_question" and should_retrieve_hint:
        return {
            "should_retrieve": True,
            "evidence_summary": "",
        }

    # 규칙 5: live_qa는 회사 정보가 필요할 수 있으므로 retrieve
    if final_phase == "live_qa":
        return {
            "should_retrieve": True,
            "evidence_summary": "",
        }

    # 기본: skip
    return {
        "should_retrieve": False,
        "evidence_summary": "",
    }
