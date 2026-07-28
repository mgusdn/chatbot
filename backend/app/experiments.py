from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from threading import Lock, RLock
import time
from uuid import uuid4

from counsel.delivery import (
    BaselineTurnDelivery,
    use_baseline_delivery,
)
from counsel.graph import get_graph
from counsel.llm import ModelProviderError, collect_model_metrics, redact_secrets
from counsel.state import PipelineArm, SessionState, new_session

from .safety import CRISIS_RESPONSE, detect_crisis


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_state(state: SessionState) -> dict:
    filled = [slot for slot, values in state["slots"].items() if values]
    return {
        "stage": state["stage"],
        "rapport_step": state["rapport_step"],
        "turn_count": state["turn_count"],
        "filled_slots": filled,
        "pending_slot": (state.get("pending") or {}).get("target_slot"),
        "gate": state["gate"],
        "slot_switches": state["slot_switches"],
        "pipeline_arm": state["pipeline_arm"],
        "provider": state["provider"],
        "upstream_commit": state["upstream_commit"],
        "report_fallback": state["report_fallback"],
    }


def _demo_state(state: SessionState) -> dict:
    """Return local UI details without adding private slot text to result logs."""
    public = _public_state(state)
    public["slot_values"] = {
        slot: [
            str(value).strip()[:280]
            for value in values[-3:]
            if str(value).strip()
        ]
        for slot, values in state["slots"].items()
    }
    return public


def _turn_metrics(model_calls: list[dict], total_ms: float) -> dict:
    failed_calls = sum(not bool(call.get("success")) for call in model_calls)
    return {
        "total_ms": total_ms,
        "model_ms": round(sum(float(call.get("duration_ms", 0)) for call in model_calls), 2),
        "model_calls": len(model_calls),
        "input_tokens": sum(int(call.get("input_tokens", 0)) for call in model_calls),
        "output_tokens": sum(int(call.get("output_tokens", 0)) for call in model_calls),
        "retries": sum(max(0, int(call.get("attempts", 1)) - 1) for call in model_calls),
        "failed_calls": failed_calls,
        # A successful counseling turn can still use a deterministic fallback
        # after a bounded provider call fails. Keep that visible for quality
        # and latency comparisons instead of treating the turn as fully clean.
        "fallback_used": failed_calls > 0,
        "fallback_count": failed_calls,
    }


def _reconcile_delivered_bot_log(
    conversation_log: list[dict],
    *,
    original_message: str,
    delivered_message: str,
) -> list[dict]:
    """Replace the authoritative bot line and remove a superseded same-turn line."""
    log = list(conversation_log)
    authoritative_index: int | None = None
    for index in range(len(log) - 1, -1, -1):
        if (
            log[index].get("role") == "bot"
            and log[index].get("content") == original_message
        ):
            authoritative_index = index
            break

    if authoritative_index is None:
        log.append({"role": "bot", "content": delivered_message})
        return log

    log[authoritative_index] = {
        **log[authoritative_index],
        "content": delivered_message,
    }

    # On the final slot, render_question records a speculative question before
    # gate_check routes through values in the same graph invocation.  The values
    # prompt is the only bot reply delivered for that turn, so discard the
    # immediately preceding superseded bot line from the canonical history.
    if (
        authoritative_index > 0
        and log[authoritative_index - 1].get("role") == "bot"
    ):
        del log[authoritative_index - 1]
    return log


class ResultLogger:
    def __init__(self) -> None:
        configured = os.getenv("AB_RESULTS_PATH", "runs/ab_results.jsonl")
        self.path = Path(configured)
        if not self.path.is_absolute():
            self.path = Path(__file__).resolve().parents[1] / self.path
        self._lock = Lock()

    def append(self, event: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")


@dataclass
class ArmSession:
    state: SessionState
    lock: RLock = field(default_factory=RLock)
    bridge_history: list[str] = field(default_factory=list)


@dataclass
class Experiment:
    experiment_id: str
    created_at: str
    arms: dict[PipelineArm, ArmSession]
    runs: list[dict] = field(default_factory=list)


class RunNotFoundError(KeyError):
    """Raised when a rating does not reference a run from this experiment/arm."""


class ExperimentStore:
    def __init__(self) -> None:
        self._experiments: dict[str, Experiment] = {}
        self._lock = RLock()
        self._logger = ResultLogger()

    def create(self, name: str = "사용자") -> dict:
        experiment_id = uuid4().hex
        sessions: dict[PipelineArm, ArmSession] = {}
        greetings: dict[str, str] = {}

        for arm in ("baseline", "optimized"):
            state = new_session(
                arm,
                f"{experiment_id}:{arm}",
                name=name,
            )
            state = get_graph(arm).invoke(state)
            state["user_input"] = None
            sessions[arm] = ArmSession(state=state)
            greetings[arm] = state.get("bot_message") or ""

        experiment = Experiment(experiment_id=experiment_id, created_at=_now_iso(), arms=sessions)
        with self._lock:
            self._experiments[experiment_id] = experiment

        return {
            "experiment_id": experiment_id,
            "created_at": experiment.created_at,
            "greetings": greetings,
            "states": {arm: _public_state(session.state) for arm, session in sessions.items()},
        }

    def _get(self, experiment_id: str) -> Experiment:
        with self._lock:
            experiment = self._experiments.get(experiment_id)
        if experiment is None:
            raise KeyError(experiment_id)
        return experiment

    def describe(self, experiment_id: str) -> dict:
        experiment = self._get(experiment_id)
        return {
            "experiment_id": experiment.experiment_id,
            "created_at": experiment.created_at,
            "states": {arm: _public_state(session.state) for arm, session in experiment.arms.items()},
            "runs": experiment.runs[-50:],
        }

    def demo_state(self, experiment_id: str, arm: PipelineArm) -> dict:
        """Expose slot text to the same-origin demo only; this method never logs it."""
        session = self._get(experiment_id).arms[arm]
        with session.lock:
            return _demo_state(session.state)

    def run_turn(
        self,
        experiment_id: str,
        arm: PipelineArm,
        message: str,
        comparison_id: str | None = None,
        delivery: BaselineTurnDelivery | None = None,
    ) -> dict:
        experiment = self._get(experiment_id)
        session = experiment.arms[arm]
        run_id = delivery.turn_id if delivery is not None else uuid4().hex
        started_at = _now_iso()
        started = time.perf_counter()
        model_calls: list[dict] = []

        try:
            with session.lock:
                working = deepcopy(session.state)
                if delivery is not None and arm == "baseline":
                    delivery.configure_bridge(
                        seed=f"{experiment_id}:{working['turn_count']}:{message}",
                        recent=session.bridge_history,
                    )
                crisis_terms = detect_crisis(message)
                if crisis_terms:
                    log = list(working["conversation_log"])
                    log.extend(
                        [
                            {"role": "user", "content": message},
                            {"role": "bot", "content": CRISIS_RESPONSE},
                        ]
                    )
                    working.update(
                        {
                            "stage": "done",
                            "turn_count": working["turn_count"] + 1,
                            "user_input": None,
                            "bot_message": CRISIS_RESPONSE,
                            "report": CRISIS_RESPONSE,
                            "conversation_log": log,
                        }
                    )
                    safety_bypass = True
                else:
                    working["user_input"] = message
                    with use_baseline_delivery(
                        delivery if arm == "baseline" else None
                    ):
                        with collect_model_metrics() as model_calls:
                            working = get_graph(arm).invoke(working)
                    if not (working.get("bot_message") or "").strip():
                        raise ModelProviderError("그래프가 빈 답변을 반환했습니다.")
                    working["user_input"] = None
                    safety_bypass = False

                if delivery is not None and arm == "baseline":
                    original_message = working.get("bot_message") or ""
                    delivered_message = delivery.finalize_message(original_message)
                    log = _reconcile_delivered_bot_log(
                        list(working["conversation_log"]),
                        original_message=original_message,
                        delivered_message=delivered_message,
                    )
                    if log != working["conversation_log"]:
                        working["conversation_log"] = log
                    if delivery.active_bridge:
                        session.bridge_history.append(delivery.active_bridge)
                        session.bridge_history = session.bridge_history[-5:]
                else:
                    delivered_message = working.get("bot_message") or ""

                session.state = working
        except Exception as exc:
            if delivery is not None:
                delivery.cancel()
            total_ms = round((time.perf_counter() - started) * 1000, 2)
            return self.record_error(
                experiment_id,
                arm,
                message,
                exc,
                run_id=run_id,
                started_at=started_at,
                total_ms=total_ms,
                calls=model_calls,
                comparison_id=comparison_id,
                delivery_metrics=(
                    delivery.metrics()
                    if delivery is not None and arm == "baseline"
                    else None
                ),
            )

        total_ms = round((time.perf_counter() - started) * 1000, 2)
        metrics = _turn_metrics(model_calls, total_ms)
        last_analysis = working.get("last_analysis") or {}
        analyzer_called = any(
            call.get("task") in {"target_slot_analysis", "baseline_turn_analysis"}
            for call in model_calls
        )
        if analyzer_called or last_analysis.get("analysis_source") == "local_rule":
            analyzer_fallback = bool(last_analysis.get("fallback_used"))
            response_fallback = bool(last_analysis.get("response_fallback_used"))
            metrics.update(
                {
                    "analysis_source": str(
                        last_analysis.get("analysis_source")
                        or "gemini"
                    ),
                    "analyzer_fallback_used": analyzer_fallback,
                    "response_fallback_used": response_fallback,
                    "fallback_used": analyzer_fallback or response_fallback,
                    "fallback_count": int(analyzer_fallback)
                    + int(response_fallback),
                }
            )
        if arm == "baseline" and last_analysis:
            metrics.update(
                {
                    key: last_analysis.get(key)
                    for key in (
                        "principle_lookup_ms",
                        "principle_cache_hit",
                        "principle_candidate_count",
                        "principle_retrieval_status",
                        "principle_selected",
                        "principle_id",
                        "principle_mode",
                        "principle_score",
                        "principle_used",
                        "principle_renderer",
                        "principle_render_ms",
                        "principle_skip_reason",
                    )
                }
            )
        if delivery is not None and arm == "baseline":
            metrics.update(delivery.metrics())
        result = {
            "run_id": run_id,
            "experiment_id": experiment_id,
            "comparison_id": comparison_id,
            "arm": arm,
            "pipeline_arm": arm,
            "provider": "gemini",
            "started_at": started_at,
            "status": "ok",
            # bot_message stays graph-authoritative for the next turn's prompt;
            # only the user-facing result and canonical transcript include the
            # optional delivery-only waiting bridge.
            "message": delivered_message,
            "metrics": metrics,
            "calls": model_calls,
            "state": _public_state(working),
            "safety_bypass": safety_bypass,
        }

        summary = {
            "run_id": run_id,
            "comparison_id": comparison_id,
            "arm": arm,
            "pipeline_arm": arm,
            "provider": "gemini",
            "status": "ok",
            "total_ms": total_ms,
            "model_ms": metrics["model_ms"],
            "turn_count": working["turn_count"],
        }
        with self._lock:
            experiment.runs.append(summary)

        log_event = {
            "type": "turn",
            "timestamp": _now_iso(),
            "run_id": run_id,
            "experiment_id": experiment_id,
            "comparison_id": comparison_id,
            "arm": arm,
            "pipeline_arm": arm,
            "provider": "gemini",
            "message_sha256": hashlib.sha256(message.encode("utf-8")).hexdigest(),
            "result": result,
        }
        if os.getenv("AB_LOG_CONTENT", "false").lower() not in {"1", "true", "yes", "on"}:
            log_event["result"] = {**result, "message": "[redacted]"}
        else:
            log_event["user_message"] = message
        self._logger.append(log_event)
        return result

    def record_error(
        self,
        experiment_id: str,
        arm: PipelineArm,
        message: str,
        exc: Exception,
        *,
        run_id: str | None = None,
        started_at: str | None = None,
        total_ms: float = 0.0,
        calls: list[dict] | None = None,
        comparison_id: str | None = None,
        delivery_metrics: dict | None = None,
    ) -> dict:
        model_calls = list(calls or [])
        metrics = _turn_metrics(model_calls, total_ms)
        if delivery_metrics:
            metrics.update(delivery_metrics)
        result = {
            "run_id": run_id or uuid4().hex,
            "experiment_id": experiment_id,
            "comparison_id": comparison_id,
            "arm": arm,
            "pipeline_arm": arm,
            "provider": "gemini",
            "started_at": started_at or _now_iso(),
            "status": "error",
            "message": None,
            "error": redact_secrets(f"{type(exc).__name__}: {exc}")[:300],
            "metrics": metrics,
            "calls": model_calls,
            "state": _public_state(self._get(experiment_id).arms[arm].state),
            "safety_bypass": False,
        }
        with self._lock:
            self._get(experiment_id).runs.append(
                {
                    "run_id": result["run_id"],
                    "comparison_id": comparison_id,
                    "arm": arm,
                    "status": "error",
                    "total_ms": total_ms,
                    "model_ms": metrics["model_ms"],
                    "turn_count": result["state"]["turn_count"],
                }
            )
        self._logger.append(
            {
                "type": "turn_error",
                "timestamp": _now_iso(),
                "experiment_id": experiment_id,
                "comparison_id": comparison_id,
                "arm": arm,
                "message_sha256": hashlib.sha256(message.encode("utf-8")).hexdigest(),
                "error": result["error"],
                "result": result,
            }
        )
        return result

    def rate(
        self,
        experiment_id: str,
        run_id: str,
        arm: PipelineArm,
        score: int,
        note: str,
    ) -> None:
        experiment = self._get(experiment_id)
        if not any(run["run_id"] == run_id and run["arm"] == arm for run in experiment.runs):
            raise RunNotFoundError(run_id)
        self._logger.append(
            {
                "type": "rating",
                "timestamp": _now_iso(),
                "experiment_id": experiment_id,
                "run_id": run_id,
                "arm": arm,
                "score": score,
                "note": note,
            }
        )


store = ExperimentStore()
