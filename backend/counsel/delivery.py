"""Turn-local segmented delivery for the baseline counseling arm.

The counseling graph remains synchronous and authoritative.  This module
publishes the model-generated opening as soon as it is ready. The analyzer can
then approve one contextual aside while the opening is being spoken; only when
analysis is genuinely late does the timer activate a reviewed waiting bridge.
Delivered segments are folded into the canonical final transcript while
``bot_message`` remains graph-authoritative.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import os
from threading import Condition, Lock, Timer
import time
from typing import Callable, Iterator

from .prompts import WAITING_BRIDGE_LINES


DeliveryEventSink = Callable[[dict], None]


def _bridge_delay_seconds() -> float:
    """Temporary text boundary; replace with audio_near_end when TTS lands."""
    try:
        milliseconds = float(os.getenv("BASELINE_BRIDGE_DELAY_MS", "2200"))
    except ValueError:
        milliseconds = 2200.0
    return max(0.0, milliseconds / 1000.0)


def _select_bridge(seed: str, recent: list[str]) -> str:
    candidates = [line for line in WAITING_BRIDGE_LINES if line not in recent[-5:]]
    if not candidates:
        candidates = list(WAITING_BRIDGE_LINES)
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return candidates[int.from_bytes(digest[:4], "big") % len(candidates)]


class BaselineTurnDelivery:
    """Race-safe opening/aside/waiting-bridge controller for one A turn."""

    profile = "dynamic_principle_aside_v4"

    def __init__(self, turn_id: str, sink: DeliveryEventSink | None = None) -> None:
        self.turn_id = turn_id
        self._sink = sink
        self._started = time.perf_counter()
        self._lock = Lock()
        self._condition = Condition(self._lock)
        self._timer: Timer | None = None
        self._bridge_text = WAITING_BRIDGE_LINES[0]
        self._reflection = ""
        self._semantic_aside = ""
        self._active_bridge = ""
        self._continuation_ready = False
        self._cancelled = False
        self._segment_publish_pending = False
        self._sequence = 0
        self._reflection_ready_ms: float | None = None
        self._aside_ready_ms: float | None = None
        self._bridge_ready_ms: float | None = None

    def configure_bridge(self, *, seed: str, recent: list[str]) -> None:
        with self._lock:
            if not self._reflection and not self._active_bridge:
                self._bridge_text = _select_bridge(seed, recent)

    def _publish(self, event: dict | None) -> bool:
        if event is None or self._sink is None:
            return False
        try:
            self._sink(event)
        except Exception:
            # Delivery telemetry must never break the counseling graph.
            return False
        return True

    def _publish_lead(
        self,
        text: str,
        *,
        segment: str,
        schedule_bridge: bool,
    ) -> None:
        normalized = " ".join(str(text or "").split()).strip()
        if not normalized:
            return

        timer = None
        with self._condition:
            if (
                self._cancelled
                or self._continuation_ready
                or self._reflection
                or self._segment_publish_pending
            ):
                return
            elapsed_ms = round((time.perf_counter() - self._started) * 1000, 2)
            event = {
                "type": "segment",
                "turn_id": self.turn_id,
                "arm": "baseline",
                "sequence": self._sequence + 1,
                "segment": segment,
                "text": normalized,
                "elapsed_ms": elapsed_ms,
            }
            self._segment_publish_pending = True

        # Commit delivery state only after the sink accepted the event.  A
        # disconnected/failed sink must not make metrics or the canonical
        # message claim that the user saw an early segment.
        published = self._publish(event)

        with self._condition:
            if (
                published
                and not self._cancelled
                and not self._continuation_ready
                and not self._reflection
            ):
                self._sequence = event["sequence"]
                self._reflection = normalized
                self._reflection_ready_ms = elapsed_ms
                if schedule_bridge:
                    timer = Timer(_bridge_delay_seconds(), self.try_activate_bridge)
                    timer.daemon = True
                    self._timer = timer
            self._segment_publish_pending = False
            self._condition.notify_all()

        if timer is not None:
            timer.start()

    def publish_reflection(self, text: str, *, schedule_bridge: bool = True) -> None:
        """Publish the response writer's opening as the first visible segment."""
        self._publish_lead(
            text,
            segment="reflection",
            schedule_bridge=schedule_bridge,
        )

    def publish_aside(self, text: str) -> str | None:
        """Publish one analyzer-approved contextual aside after the opening."""
        normalized = " ".join(str(text or "").split()).strip()
        if not normalized:
            return None

        timer = None
        with self._condition:
            while self._segment_publish_pending:
                self._condition.wait()
            if (
                self._cancelled
                or self._continuation_ready
                or not self._reflection
                or self._semantic_aside
                or self._active_bridge
            ):
                return None
            elapsed_ms = round((time.perf_counter() - self._started) * 1000, 2)
            event = {
                "type": "segment",
                "turn_id": self.turn_id,
                "arm": "baseline",
                "sequence": self._sequence + 1,
                "segment": "aside",
                "text": normalized,
                "elapsed_ms": elapsed_ms,
            }
            self._segment_publish_pending = True
            timer = self._timer
            self._timer = None

        if timer is not None:
            timer.cancel()
        published = self._publish(event)

        with self._condition:
            if published and not self._cancelled and not self._active_bridge:
                self._sequence = event["sequence"]
                self._semantic_aside = normalized
                self._aside_ready_ms = elapsed_ms
            self._segment_publish_pending = False
            self._condition.notify_all()
            return self._semantic_aside or None

    def try_activate_bridge(self) -> str | None:
        with self._condition:
            if (
                self._cancelled
                or self._continuation_ready
                or not self._reflection
                or self._semantic_aside
                or self._active_bridge
                or self._segment_publish_pending
            ):
                return None
            bridge = self._bridge_text
            elapsed_ms = round((time.perf_counter() - self._started) * 1000, 2)
            event = {
                "type": "segment",
                "turn_id": self.turn_id,
                "arm": "baseline",
                "sequence": self._sequence + 1,
                "segment": "bridge",
                "text": bridge,
                "elapsed_ms": elapsed_ms,
            }
            self._segment_publish_pending = True

        published = self._publish(event)

        with self._condition:
            if published and not self._cancelled:
                self._sequence = event["sequence"]
                self._active_bridge = bridge
                self._bridge_ready_ms = elapsed_ms
            self._segment_publish_pending = False
            self._condition.notify_all()
            return self._active_bridge or None

    def mark_continuation_ready(self) -> None:
        timer = None
        with self._condition:
            # A timer may already have won the activation race.  Wait until its
            # sink call finishes so arm_result can never overtake that segment.
            while self._segment_publish_pending:
                self._condition.wait()
            if self._continuation_ready:
                return
            self._continuation_ready = True
            timer = self._timer
            self._timer = None
        if timer is not None:
            timer.cancel()

    def finalize_message(self, message: str) -> str:
        self.mark_continuation_ready()
        original = str(message or "").strip()
        with self._lock:
            reflection = self._reflection
            aside = self._semantic_aside
            bridge = self._active_bridge

        if not reflection:
            # Values and insight-report turns can contain meaningful Markdown
            # line breaks even though they have no early reflection.
            return original
        # The dynamic reflection is whitespace-normalized for one-line delivery.
        # Compare against the same representation so an LLM newline or doubled
        # space cannot make us prepend an already-delivered phrase twice.
        comparable_original = " ".join(original.split())
        if comparable_original.startswith(reflection):
            continuation = comparable_original[len(reflection) :].strip()
            if aside and continuation.startswith(aside):
                continuation = continuation[len(aside) :].strip()
        else:
            # A same-invoke gate transition can replace the speculative loop
            # question with the values prompt.  Keep the already shown early
            # segments in front of that authoritative final continuation.
            continuation = original
        prefix = " ".join(part for part in (reflection, aside or bridge) if part)
        if not continuation:
            return prefix
        separator = "\n\n" if "\n" in continuation else " "
        return f"{prefix}{separator}{continuation}"

    def unspoken_continuation(self, message: str) -> str:
        """Return only the canonical suffix not already published as segments.

        Browser TTS consumes each published segment once.  Returning the full
        canonical message here would make it repeat the opening and aside.
        """
        original = str(message or "").strip()
        with self._lock:
            prefix = " ".join(
                part
                for part in (
                    self._reflection,
                    self._semantic_aside or self._active_bridge,
                )
                if part
            )
        if not prefix:
            return original
        comparable = " ".join(original.split())
        if comparable.startswith(prefix):
            return comparable[len(prefix) :].strip()
        # Never repeat an already spoken opening when an unexpected formatting
        # change makes the suffix impossible to identify safely.
        return ""

    def cancel(self) -> None:
        timer = None
        with self._condition:
            # If cancellation follows a graph error, retain any segment the sink
            # already accepted so the error result reports truthful delivery
            # metrics and cannot overtake that segment either.
            while self._segment_publish_pending:
                self._condition.wait()
            self._cancelled = True
            self._continuation_ready = True
            timer = self._timer
            self._timer = None
        if timer is not None:
            timer.cancel()

    @property
    def active_bridge(self) -> str:
        with self._lock:
            return self._active_bridge

    @property
    def reflection(self) -> str:
        with self._lock:
            return self._reflection

    @property
    def semantic_aside(self) -> str:
        with self._lock:
            return self._semantic_aside

    def metrics(self) -> dict:
        with self._lock:
            return {
                "delivery_profile": self.profile,
                "reflection_ready_ms": self._reflection_ready_ms,
                "first_response_ms": self._reflection_ready_ms,
                "aside_emitted": bool(self._semantic_aside),
                "aside_ready_ms": self._aside_ready_ms,
                "bridge_emitted": bool(self._active_bridge),
                "bridge_ready_ms": self._bridge_ready_ms,
            }


_CURRENT_DELIVERY: ContextVar[BaselineTurnDelivery | None] = ContextVar(
    "baseline_turn_delivery", default=None
)


@contextmanager
def use_baseline_delivery(
    delivery: BaselineTurnDelivery | None,
) -> Iterator[None]:
    token = _CURRENT_DELIVERY.set(delivery)
    try:
        yield
    finally:
        _CURRENT_DELIVERY.reset(token)


def publish_baseline_reflection(
    text: str,
    *,
    schedule_bridge: bool = True,
) -> str | None:
    delivery = _CURRENT_DELIVERY.get()
    if delivery is not None:
        delivery.publish_reflection(text, schedule_bridge=schedule_bridge)
        return delivery.reflection or None
    return None


def publish_baseline_aside(text: str) -> str | None:
    delivery = _CURRENT_DELIVERY.get()
    if delivery is None:
        return None
    return delivery.publish_aside(text)


def baseline_waiting_bridge_active() -> bool:
    delivery = _CURRENT_DELIVERY.get()
    return bool(delivery and delivery.active_bridge)


def mark_baseline_continuation_ready() -> None:
    delivery = _CURRENT_DELIVERY.get()
    if delivery is not None:
        delivery.mark_continuation_ready()
