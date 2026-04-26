"""
builder — LangGraph StateGraph 조립

설계서의 파이프라인을 LangGraph로 구현한다.
9개 노드를 조건 분기 포함하여 연결한다.

흐름:
turn_ingest → interview_router → phase_guard → candidate_analyzer
→ retrieval_planner → [company_graphrag | interviewer_gen]
→ interviewer_gen → memory_writer → output_builder → END
"""

from langgraph.graph import StateGraph, END

from backend.graph.state import InterviewState
from backend.graph.nodes.turn_ingest import turn_ingest
from backend.graph.nodes.interview_router import interview_router
from backend.graph.nodes.phase_guard import phase_guard
from backend.graph.nodes.candidate_analyzer import candidate_analyzer
from backend.graph.nodes.retrieval_planner import retrieval_planner
from backend.graph.nodes.company_graphrag import company_graphrag
from backend.graph.nodes.interviewer_gen import interviewer_gen
from backend.graph.nodes.memory_writer import memory_writer
from backend.graph.nodes.output_builder import output_builder


def _retrieval_router(state: InterviewState) -> str:
    """retrieval_planner 이후 조건 분기: retrieve vs skip"""
    if state.get("should_retrieve", False):
        return "retrieve"
    return "skip"


def build_interview_graph() -> StateGraph:
    """면접 파이프라인 그래프를 빌드하고 컴파일한다."""
    builder = StateGraph(InterviewState)

    # ── 노드 등록 ──
    builder.add_node("turn_ingest", turn_ingest)
    builder.add_node("interview_router", interview_router)
    builder.add_node("phase_guard", phase_guard)
    builder.add_node("candidate_analyzer", candidate_analyzer)
    builder.add_node("retrieval_planner", retrieval_planner)
    builder.add_node("company_graphrag", company_graphrag)
    builder.add_node("interviewer_gen", interviewer_gen)
    builder.add_node("memory_writer", memory_writer)
    builder.add_node("output_builder", output_builder)

    # ── 엣지 연결 ──
    builder.set_entry_point("turn_ingest")
    builder.add_edge("turn_ingest", "interview_router")
    builder.add_edge("interview_router", "phase_guard")
    builder.add_edge("phase_guard", "candidate_analyzer")
    builder.add_edge("candidate_analyzer", "retrieval_planner")

    # 조건 분기: retrieve → company_graphrag → interviewer_gen
    #            skip → interviewer_gen
    builder.add_conditional_edges(
        "retrieval_planner",
        _retrieval_router,
        {
            "retrieve": "company_graphrag",
            "skip": "interviewer_gen",
        },
    )
    builder.add_edge("company_graphrag", "interviewer_gen")

    builder.add_edge("interviewer_gen", "memory_writer")
    builder.add_edge("memory_writer", "output_builder")
    builder.add_edge("output_builder", END)

    return builder.compile()


# 싱글턴 그래프 인스턴스
graph = build_interview_graph()
