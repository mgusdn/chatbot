"""
builder_single — 단일 에이전트용 LangGraph 그래프

LLM을 1번만 호출하는 경량 파이프라인:
  turn_ingest → unified_interviewer → memory_writer → output_builder → END

기존 turn_ingest, memory_writer, output_builder를 그대로 재사용한다.
"""

from langgraph.graph import StateGraph, END

from backend.graph.state import InterviewState
from backend.graph.nodes.turn_ingest import turn_ingest
from backend.graph.nodes.unified_interviewer import unified_interviewer
from backend.graph.nodes.memory_writer import memory_writer
from backend.graph.nodes.output_builder import output_builder


def build_single_agent_graph():
    """단일 에이전트 파이프라인 그래프를 빌드하고 컴파일한다."""
    builder = StateGraph(InterviewState)

    # ── 노드 등록 (4개뿐) ──
    builder.add_node("turn_ingest", turn_ingest)
    builder.add_node("unified_interviewer", unified_interviewer)
    builder.add_node("memory_writer", memory_writer)
    builder.add_node("output_builder", output_builder)

    # ── 단순 직선 연결 ──
    builder.set_entry_point("turn_ingest")
    builder.add_edge("turn_ingest", "unified_interviewer")
    builder.add_edge("unified_interviewer", "memory_writer")
    builder.add_edge("memory_writer", "output_builder")
    builder.add_edge("output_builder", END)

    return builder.compile()


# 싱글턴 그래프 인스턴스
graph_single = build_single_agent_graph()
