"""A-series LangGraph assembly."""

from __future__ import annotations

import time

from langgraph.graph import END, START, StateGraph

from .baseline_nodes import (
    consolidate_slots_node,
    gate_check_node,
    insight_report_node,
    rapport_node,
    render_question_node,
    values_node,
)
from .debug import debug_print
from .router import (
    AFTER_GATE_MAP,
    AFTER_RAPPORT_MAP,
    AFTER_VALUES_MAP,
    ENTRY_MAP,
    route_after_gate,
    route_after_rapport,
    route_after_values,
    route_entry,
)
from .state import SessionState


def _timed(name, fn):
    def wrapped(state):
        started = time.perf_counter()
        result = fn(state)
        debug_print(
            f"[TIMING DEBUG] node '{name}': "
            f"{time.perf_counter() - started:.3f}s"
        )
        return result

    return wrapped


def build_graph():
    graph = StateGraph(SessionState)
    graph.add_node("rapport", _timed("rapport", rapport_node))
    graph.add_node("render_question", _timed("render_question", render_question_node))
    graph.add_node("values", _timed("values", values_node))
    graph.add_node("gate_check", _timed("gate_check", gate_check_node))
    graph.add_node(
        "consolidate_slots",
        _timed("consolidate_slots", consolidate_slots_node),
    )
    graph.add_node("insight_report", _timed("insight_report", insight_report_node))

    graph.add_conditional_edges(START, route_entry, ENTRY_MAP)
    graph.add_conditional_edges("rapport", route_after_rapport, AFTER_RAPPORT_MAP)
    graph.add_edge("render_question", "gate_check")
    graph.add_conditional_edges("gate_check", route_after_gate, AFTER_GATE_MAP)
    graph.add_conditional_edges("values", route_after_values, AFTER_VALUES_MAP)
    graph.add_edge("consolidate_slots", "insight_report")
    graph.add_edge("insight_report", END)
    return graph.compile()


_GRAPH = None


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH
