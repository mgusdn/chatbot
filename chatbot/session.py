"""Reusable synchronous session wrapper for the A-series graph."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Callable
from uuid import uuid4

from .delivery import BaselineTurnDelivery, use_baseline_delivery
from .graph import get_graph
from .llm import ModelProviderError, collect_model_metrics, redact_secrets
from .safety import CRISIS_RESPONSE, detect_crisis
from .state import SessionState, new_session


SegmentSink = Callable[[dict], None]


class ChatbotRuntimeError(RuntimeError):
    """Raised when a turn cannot produce a usable response."""


@dataclass(frozen=True, slots=True)
class TurnResult:
    message: str
    continuation: str
    segments: tuple[dict, ...]
    model_calls: tuple[dict, ...]
    safety_bypass: bool
    state: SessionState


def _reconcile_bot_log(
    log: list[dict],
    *,
    original: str,
    delivered: str,
) -> list[dict]:
    result = list(log)
    for index in range(len(result) - 1, -1, -1):
        if result[index].get("role") == "bot" and result[index].get("content") == original:
            result[index] = {**result[index], "content": delivered}
            return result
    result.append({"role": "bot", "content": delivered})
    return result


class ChatbotSession:
    """Own one terminal counseling session and its immutable graph."""

    def __init__(self, name: str = "사용자", session_id: str | None = None) -> None:
        normalized_name = " ".join(name.split()).strip() or "사용자"
        self.state = new_session(session_id or f"cli-{uuid4().hex[:12]}", normalized_name)
        self._graph = get_graph()
        self._bridge_history: list[str] = []

    def start(self) -> TurnResult:
        if not (self.state.get("bot_message") or "").strip():
            self.state = self._graph.invoke(self.state)
            self.state["user_input"] = None
        message = str(self.state.get("bot_message") or "").strip()
        return TurnResult(
            message=message,
            continuation=message,
            segments=(),
            model_calls=(),
            safety_bypass=False,
            state=deepcopy(self.state),
        )

    def turn(
        self,
        message: str,
        *,
        on_segment: SegmentSink | None = None,
    ) -> TurnResult:
        normalized = " ".join(str(message or "").split()).strip()
        if not normalized:
            raise ValueError("빈 메시지는 전송할 수 없습니다.")

        working = deepcopy(self.state)
        crisis_terms = detect_crisis(normalized)
        if crisis_terms:
            log = list(working["conversation_log"])
            log.extend(
                [
                    {"role": "user", "content": normalized},
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
            self.state = working
            return TurnResult(
                message=CRISIS_RESPONSE,
                continuation=CRISIS_RESPONSE,
                segments=(),
                model_calls=(),
                safety_bypass=True,
                state=deepcopy(working),
            )

        segments: list[dict] = []

        def sink(event: dict) -> None:
            event_copy = dict(event)
            segments.append(event_copy)
            if on_segment is not None:
                on_segment(event_copy)

        delivery = BaselineTurnDelivery(uuid4().hex, sink)
        delivery.configure_bridge(
            seed=f"{working['session_id']}:{working['turn_count']}:{normalized}",
            recent=self._bridge_history,
        )
        working["user_input"] = normalized
        calls: list[dict] = []
        try:
            with use_baseline_delivery(delivery):
                with collect_model_metrics() as calls:
                    working = self._graph.invoke(working)
            original = str(working.get("bot_message") or "").strip()
            if not original:
                raise ModelProviderError("그래프가 빈 답변을 반환했습니다.")
            delivered = delivery.finalize_message(original)
            continuation = delivery.unspoken_continuation(delivered)
            working["bot_message"] = delivered
            working["conversation_log"] = _reconcile_bot_log(
                list(working["conversation_log"]),
                original=original,
                delivered=delivered,
            )
            working["user_input"] = None
            if delivery.active_bridge:
                self._bridge_history = (
                    self._bridge_history + [delivery.active_bridge]
                )[-5:]
            self.state = working
        except Exception as exc:
            delivery.cancel()
            message_text = redact_secrets(f"{type(exc).__name__}: {exc}")
            raise ChatbotRuntimeError(message_text) from exc

        return TurnResult(
            message=delivered,
            continuation=continuation,
            segments=tuple(segments),
            model_calls=tuple(dict(call) for call in calls),
            safety_bypass=False,
            state=deepcopy(working),
        )
