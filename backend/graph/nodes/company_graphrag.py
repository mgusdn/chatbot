"""
company_graphrag — Mock 회사 데이터를 반환하는 노드

실제 GraphRAG 대신 하드코딩된 회사 정보를 검색 결과로 반환한다.
"""

from backend.graph.state import InterviewState
from backend.mock_data.companies import get_evidence_for_query


def company_graphrag(state: InterviewState) -> dict:
    """Mock 회사 근거를 검색하여 반환한다."""
    company_name = state["company_name"]
    final_phase = state["final_phase"]

    # phase에 따라 검색 모드 결정
    if final_phase == "behavioral_question":
        mode = "global"  # 인재상, 문화 관련
    elif final_phase == "live_qa":
        mode = "global"  # 회사 전반
    else:
        mode = "local"   # JD, 기술 스택 관련

    # 회사 ID 매핑 (간단 구현)
    company_id_map = {
        "AI 플랫폼 기업": "ai_platform",
        "핀테크 스타트업": "fintech",
    }
    company_id = company_id_map.get(company_name, "ai_platform")

    evidence = get_evidence_for_query(
        company_id=company_id,
        query=state["user_input"],
        mode=mode,
    )

    return {
        "evidence_summary": evidence,
    }
