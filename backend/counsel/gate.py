"""Coverage/gate computation. Pure function, no LLM or embedding calls."""
from .state import GateState, SLOT_ORDER, SessionState


def compute_gate(state: SessionState) -> GateState:
    slots = state["slots"]
    switches = state.get("slot_switches") or {}
    asked_slots = set(state.get("asked_slots") or [])

    # Check coverage only for the 6 core visual slots
    CORE_SLOTS = ["situation", "emotion", "thought", "behavior", "coping", "goal"]

    coverage_ok = all(
        slots[s]
        and (
            switches.get(s) in {"on", "unknown"}
            or (state.get("pipeline_arm") == "baseline" and s in asked_slots)
        )
        for s in CORE_SLOTS
    )
    return GateState(coverage_ok=coverage_ok)
