import json
import os
import time
from threading import Event, Thread

os.environ["AB_MOCK_MODE"] = "true"
os.environ["MOCK_GEMINI_DELAY_MS"] = "0"
os.environ["AB_RESULTS_PATH"] = "/private/tmp/pume-delivery-test-results.jsonl"

from fastapi.testclient import TestClient

from app.server import app
from app.experiments import store
from counsel import baseline_nodes
from counsel.delivery import BaselineTurnDelivery
from counsel.llm import ModelProviderError
from counsel.prompts import BASELINE_LEAD_EMPATHY, WAITING_BRIDGE_LINES
from counsel.state import SLOT_ORDER, SLOT_QUESTION_TEMPLATES


client = TestClient(app)
RAPPORT_REPLIES = ["안녕하세요.", "좋아요.", "괜찮았어요.", "프메 멤버예요."]


def _create_loop_session() -> str:
    experiment_id = client.post("/api/experiments", json={}).json()["experiment_id"]
    result = client.post(
        f"/api/experiments/{experiment_id}/turns",
        json={"message": "1, 2, 3, 4, 5", "arms": ["baseline"]},
    ).json()["results"]["baseline"]
    assert result["status"] == "ok"
    assert result["state"]["stage"] == "rapport"

    for message in RAPPORT_REPLIES:
        result = client.post(
            f"/api/experiments/{experiment_id}/turns",
            json={"message": message, "arms": ["baseline"]},
        ).json()["results"]["baseline"]
        assert result["status"] == "ok"

    assert result["state"]["stage"] == "loop"
    return experiment_id


def _stream(experiment_id: str, message: str, arms=None) -> list[dict]:
    response = client.post(
        f"/api/experiments/{experiment_id}/turns/stream",
        json={"message": message, "arms": arms or ["baseline"]},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_delivery_activates_bridge_once_before_continuation(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    events = []
    delivery = BaselineTurnDelivery("turn-one", events.append)
    delivery.configure_bridge(seed="one", recent=[])

    delivery.publish_reflection("마음이 많이 답답하셨겠어요.")
    bridge = delivery.try_activate_bridge()
    assert bridge in WAITING_BRIDGE_LINES
    assert delivery.try_activate_bridge() is None

    delivery.mark_continuation_ready()
    final = delivery.finalize_message(
        "마음이 많이 답답하셨겠어요. 그때 어떤 감정이 드셨나요?"
    )
    assert [event["segment"] for event in events] == ["reflection", "bridge"]
    assert final.count(bridge) == 1
    assert final.endswith("그때 어떤 감정이 드셨나요?")


def test_contextual_aside_replaces_waiting_bridge_without_duplication(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    events = []
    delivery = BaselineTurnDelivery("turn-aside", events.append)
    reflection = "마감이 다가올수록 마음이 급해지셨겠어요."
    aside = "해야 한다는 마음이 클수록 첫걸음이 무거울 때가 있지요."

    delivery.publish_reflection(reflection)
    assert delivery.publish_aside(aside) == aside
    assert delivery.try_activate_bridge() is None

    final = delivery.finalize_message(
        f"{reflection} {aside} 그 일로 요즘 어떤 감정이 드시나요?"
    )
    assert [event["segment"] for event in events] == ["reflection", "aside"]
    assert final.count(reflection) == 1
    assert final.count(aside) == 1
    assert delivery.metrics()["aside_emitted"] is True
    assert delivery.metrics()["bridge_emitted"] is False


def test_delivery_never_bridges_after_continuation_is_ready(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    events = []
    delivery = BaselineTurnDelivery("turn-two", events.append)
    delivery.publish_reflection("잘 들었어요.")
    delivery.mark_continuation_ready()

    assert delivery.try_activate_bridge() is None
    assert delivery.finalize_message("잘 들었어요. 다음 이야기를 들려주세요.") == (
        "잘 들었어요. 다음 이야기를 들려주세요."
    )
    assert [event["segment"] for event in events] == ["reflection"]


def test_finalize_waits_for_inflight_bridge_publish(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    bridge_publish_started = Event()
    release_bridge_publish = Event()
    final_ready = Event()
    events = []

    def blocking_sink(event):
        if event["segment"] == "bridge":
            bridge_publish_started.set()
            if not release_bridge_publish.wait(1):
                raise TimeoutError("test did not release bridge sink")
        events.append(event)

    delivery = BaselineTurnDelivery("turn-race", blocking_sink)
    delivery.publish_reflection("마음이 많이 답답하셨겠어요.")
    bridge_thread = Thread(target=delivery.try_activate_bridge)
    bridge_thread.start()
    assert bridge_publish_started.wait(1)

    finalized = {}

    def finalize():
        finalized["message"] = delivery.finalize_message(
            "마음이 많이 답답하셨겠어요. 어떤 감정이 드셨나요?"
        )
        final_ready.set()

    final_thread = Thread(target=finalize)
    final_thread.start()
    was_blocked = not final_ready.wait(0.05)
    release_bridge_publish.set()
    assert final_ready.wait(1)
    bridge_thread.join(timeout=1)
    final_thread.join(timeout=1)

    assert was_blocked
    assert [event["segment"] for event in events] == ["reflection", "bridge"]
    assert delivery.active_bridge in finalized["message"]


def test_finalize_waits_for_inflight_reflection_publish(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    reflection_publish_started = Event()
    release_reflection_publish = Event()
    final_ready = Event()
    events = []

    def blocking_sink(event):
        reflection_publish_started.set()
        if not release_reflection_publish.wait(1):
            raise TimeoutError("test did not release reflection sink")
        events.append(event)

    delivery = BaselineTurnDelivery("turn-reflection-race", blocking_sink)
    reflection_thread = Thread(
        target=delivery.publish_reflection,
        args=("마음이 많이 답답하셨겠어요.",),
    )
    reflection_thread.start()
    assert reflection_publish_started.wait(1)

    finalized = {}

    def finalize():
        finalized["message"] = delivery.finalize_message(
            "마음이 많이 답답하셨겠어요. 어떤 감정이 드셨나요?"
        )
        final_ready.set()

    final_thread = Thread(target=finalize)
    final_thread.start()
    was_blocked = not final_ready.wait(0.05)
    release_reflection_publish.set()
    assert final_ready.wait(1)
    reflection_thread.join(timeout=1)
    final_thread.join(timeout=1)

    assert was_blocked
    assert [event["segment"] for event in events] == ["reflection"]
    assert delivery.metrics()["reflection_ready_ms"] is not None
    assert finalized["message"].count("마음이 많이 답답하셨겠어요.") == 1


def test_failed_bridge_sink_does_not_claim_or_persist_bridge(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    events = []

    def bridge_failing_sink(event):
        if event["segment"] == "bridge":
            raise RuntimeError("stream disconnected")
        events.append(event)

    delivery = BaselineTurnDelivery("turn-sink-failure", bridge_failing_sink)
    reflection = "마음이 많이 답답하셨겠어요."
    delivery.publish_reflection(reflection)

    assert delivery.try_activate_bridge() is None
    assert delivery.metrics()["bridge_emitted"] is False
    assert delivery.metrics()["bridge_ready_ms"] is None
    assert delivery.finalize_message(f"{reflection} 어떤 감정이 드셨나요?") == (
        f"{reflection} 어떤 감정이 드셨나요?"
    )
    assert [event["segment"] for event in events] == ["reflection"]


def test_reflection_whitespace_is_normalized_without_duplication(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    events = []
    delivery = BaselineTurnDelivery("turn-whitespace", events.append)
    delivery.publish_reflection("마음이\n  많이 답답하셨겠어요.")

    final = delivery.finalize_message(
        "마음이\n  많이 답답하셨겠어요.   어떤 감정이 드셨나요?"
    )

    assert final == "마음이 많이 답답하셨겠어요. 어떤 감정이 드셨나요?"
    assert final.count("마음이 많이 답답하셨겠어요.") == 1


def test_empty_reflection_cannot_start_bridge():
    events = []
    delivery = BaselineTurnDelivery("turn-empty", events.append)
    delivery.publish_reflection("   ")
    assert delivery.try_activate_bridge() is None
    assert events == []


def test_delivery_preserves_markdown_when_no_reflection_was_streamed():
    delivery = BaselineTurnDelivery("turn-report")
    report = "## 마음 정리\n\n### 첫 번째 단서\n- 천천히 이어가기"
    assert delivery.finalize_message(report) == report


def test_reviewed_bridge_bank_obeys_persona_safety_constraints():
    forbidden = ("저희 애", "제 아이", "제가 상담", "내담자", "환자", "진단")
    assert len(set(WAITING_BRIDGE_LINES)) == len(WAITING_BRIDGE_LINES)
    for line in WAITING_BRIDGE_LINES:
        assert len(line) <= 25
        assert "\n" not in line
        assert "?" not in line and "？" not in line
        assert line.endswith(".")
        assert not any(token in line for token in forbidden)
    assert set(BASELINE_LEAD_EMPATHY) == set(SLOT_ORDER)
    for line in BASELINE_LEAD_EMPATHY.values():
        assert len(line) <= 45
        assert "\n" not in line
        assert "?" not in line and "？" not in line
        assert line.endswith(".")
        assert not any(token in line for token in forbidden)


def test_dynamic_reflection_streams_while_other_model_calls_are_blocked(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    experiment_id = _create_loop_session()
    events = []
    reflection_published = Event()
    release_other_calls = Event()

    def sink(event):
        events.append(event)
        if event["segment"] == "reflection":
            reflection_published.set()

    def blocked_call(label, _system, _user, **_kwargs):
        if label == "OPENING":
            return {"empathy": "마음이 많이 답답하셨겠어요."}
        if label == "TURN_ANALYSIS":
            if not release_other_calls.wait(1):
                raise TimeoutError("test did not release analyzer")
            return {
                "target_slot": "situation",
                "value": "해야 할 일을 자꾸 미루게 됨",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [],
                "aside_mode": "none",
            }
        raise AssertionError(f"unexpected call: {label}")

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", blocked_call)
    delivery = BaselineTurnDelivery("turn-dynamic-reflection", sink)
    result_box = {}

    worker = Thread(
        target=lambda: result_box.setdefault(
            "result",
            store.run_turn(
                experiment_id,
                "baseline",
                "해야 할 일을 자꾸 미루게 돼요.",
                delivery=delivery,
            ),
        )
    )
    worker.start()

    assert reflection_published.wait(1)
    assert [event["segment"] for event in events] == ["reflection"]
    assert events[0]["text"] == "마음이 많이 답답하셨겠어요."
    release_other_calls.set()
    worker.join(timeout=2)
    assert not worker.is_alive()

    result = result_box["result"]
    state = store._get(experiment_id).arms["baseline"].state
    assert result["status"] == "ok"
    assert result["message"].startswith("마음이 많이 답답하셨겠어요.")
    assert state["bot_message"] == result["message"]
    assert state["conversation_log"][-1]["content"] == result["message"]


def test_slow_opening_publishes_bounded_reviewed_lead(monkeypatch):
    monkeypatch.setenv("BASELINE_OPENING_LEAD_TIMEOUT_SECONDS", "0.05")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    experiment_id = _create_loop_session()
    events = []
    lead_published = Event()
    release_opening = Event()

    def sink(event):
        events.append(event)
        if event["segment"] == "reflection":
            lead_published.set()

    def slow_call(label, _system, _user, **_kwargs):
        if label == "OPENING":
            if not release_opening.wait(1):
                raise TimeoutError("test did not release opening")
            return {"empathy": "모델이 뒤늦게 만든 공감이에요."}
        if label == "TURN_ANALYSIS":
            return {
                "target_slot": "situation",
                "value": "해야 할 일을 자꾸 미루게 됨",
                "decision": "sufficient",
                "incidental_updates": [],
                "aside_mode": "none",
            }
        raise AssertionError(f"unexpected call: {label}")

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", slow_call)
    delivery = BaselineTurnDelivery("turn-bounded-lead", sink)
    result_box = {}
    worker = Thread(
        target=lambda: result_box.setdefault(
            "result",
            store.run_turn(
                experiment_id,
                "baseline",
                "자소서를 계속 미루게 돼요.",
                delivery=delivery,
            ),
        )
    )
    worker.start()

    assert lead_published.wait(0.5)
    assert events[0]["text"] == "어떤 이야기인지 편하게 들려주셨네요."
    release_opening.set()
    worker.join(timeout=2)
    assert not worker.is_alive()

    result = result_box["result"]
    assert result["message"].startswith(
        "어떤 이야기인지 편하게 들려주셨네요."
    )
    assert "모델이 뒤늦게 만든 공감" not in result["message"]
    state = store._get(experiment_id).arms["baseline"].state
    assert state["last_analysis"]["response_fallback_used"] is True


def test_empty_opening_uses_reviewed_lead_instead_of_streaming_silence(monkeypatch):
    monkeypatch.setenv("BASELINE_PRINCIPLE_MODE", "off")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    experiment_id = _create_loop_session()
    events = []

    def empty_opening_call(label, _system, _user, **_kwargs):
        if label == "OPENING":
            return {"empathy": ""}
        if label == "TURN_ANALYSIS":
            return {
                "target_slot": "situation",
                "value": "자소서를 계속 미루게 됨",
                "decision": "sufficient",
                "incidental_updates": [],
            }
        raise AssertionError(f"unexpected call: {label}")

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", empty_opening_call)
    delivery = BaselineTurnDelivery("turn-empty-opening", events.append)
    result = store.run_turn(
        experiment_id,
        "baseline",
        "자소서를 계속 미루게 돼요.",
        delivery=delivery,
    )

    expected = BASELINE_LEAD_EMPATHY["situation"]
    assert [event["segment"] for event in events] == ["reflection"]
    assert events[0]["text"] == expected
    assert result["message"].startswith(expected)


def test_slow_baseline_streams_reflection_bridge_and_canonical_final(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "30")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "1")
    experiment_id = _create_loop_session()
    original_analyzer = baseline_nodes._analyze_baseline_turn

    def slow_analyzer(**kwargs):
        time.sleep(0.05)
        return original_analyzer(**kwargs)

    monkeypatch.setattr(baseline_nodes, "_analyze_baseline_turn", slow_analyzer)

    events = _stream(experiment_id, "자소서를 계속 미루다가 마감 직전에 시작해요.")
    assert [event["type"] for event in events] == [
        "segment",
        "segment",
        "arm_result",
        "complete",
    ]
    segments = [event for event in events if event["type"] == "segment"]
    assert [event["segment"] for event in segments] == ["reflection", "aside"]
    assert [event["sequence"] for event in events[:-1]] == [1, 2, 3]
    assert len({event["comparison_id"] for event in events}) == 1

    result = events[-1]["results"]["baseline"]
    aside = segments[1]["text"]
    assert result["status"] == "ok"
    assert result["message"].startswith(segments[0]["text"])
    assert result["message"].count(aside) == 1
    assert result["metrics"]["bridge_emitted"] is False
    assert result["metrics"]["principle_used"] is True
    assert result["metrics"]["model_calls"] == 2
    assert result["metrics"]["first_response_ms"] < result["metrics"]["total_ms"]
    assert result["state"]["turn_count"] == 1

    state = store._get(experiment_id).arms["baseline"].state
    assert state["bot_message"] == result["message"]
    assert aside in state["bot_message"]
    assert state["conversation_log"][-1]["content"] == result["message"]
    assert state["conversation_log"][-1]["content"].count(aside) == 1


def test_final_slot_gate_removes_undelivered_speculative_bot_log(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "0")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "1000")
    experiment_id = _create_loop_session()
    session = store._get(experiment_id).arms["baseline"]
    with session.lock:
        for slot in SLOT_ORDER:
            session.state["slots"][slot] = [f"{slot}에 관한 기존 답변"]
        session.state["slots"]["self_message"] = []
        session.state["asked_slots"] = list(SLOT_ORDER)
        session.state["pending"] = {
            "target_slot": "self_message",
            "question_intent": SLOT_QUESTION_TEMPLATES["self_message"],
        }
        session.state["bot_message"] = "스스로에게 어떤 말을 건네고 싶으신가요?"
        session.state["turn_count"] = len(SLOT_ORDER) - 1
        before_log_length = len(session.state["conversation_log"])

    events = _stream(experiment_id, "그동안 애쓴 나에게 고맙다고 말하고 싶어요.")
    result = events[-1]["results"]["baseline"]
    state = session.state
    turn_entries = state["conversation_log"][before_log_length:]

    assert result["state"]["stage"] == "done"
    assert [entry["role"] for entry in turn_entries] == ["user", "bot"]
    assert turn_entries[-1]["content"] == result["message"]
    assert state["bot_message"] != result["message"]
    assert "빙산" in state["bot_message"]


def test_analyzer_failure_after_reflection_uses_bounded_fallback(monkeypatch):
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "60000")
    experiment_id = _create_loop_session()
    reflection_published = Event()
    events = []

    def sink(event):
        events.append(event)
        if event["segment"] == "reflection":
            reflection_published.set()

    def failing_call(label, _system, _user, **_kwargs):
        if label == "OPENING":
            return {"empathy": "많이 답답하셨겠어요."}
        if label == "TURN_ANALYSIS":
            if not reflection_published.wait(1):
                raise TimeoutError("reflection was not published")
            raise ModelProviderError("forced analyzer failure")
        raise AssertionError(f"unexpected call: {label}")

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", failing_call)
    delivery = BaselineTurnDelivery("turn-error-metrics", sink)
    result = store.run_turn(
        experiment_id,
        "baseline",
        "자소서를 계속 미루게 돼요.",
        delivery=delivery,
    )

    assert result["status"] == "ok"
    assert [event["segment"] for event in events] == ["reflection", "aside"]
    assert result["metrics"]["first_response_ms"] is not None
    assert result["metrics"]["reflection_ready_ms"] is not None
    assert result["metrics"]["bridge_emitted"] is False
    assert result["metrics"]["principle_used"] is True
    state = store._get(experiment_id).arms["baseline"].state
    assert state["last_analysis"]["fallback_used"] is True
    assert state["last_analysis"]["decision"] == "uncertain"


def test_fast_baseline_can_stream_contextual_aside_without_waiting_bridge(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "0")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "1000")
    experiment_id = _create_loop_session()

    events = _stream(
        experiment_id,
        "자소서 항목이 너무 많아서 어디서부터 손대야 할지 모르겠어요.",
    )
    segments = [event["segment"] for event in events if event["type"] == "segment"]
    result = events[-1]["results"]["baseline"]
    assert segments == ["reflection", "aside"]
    first_segment = next(event for event in events if event.get("type") == "segment")
    assert result["message"].startswith(first_segment["text"])
    assert result["metrics"]["bridge_emitted"] is False
    assert result["metrics"]["aside_emitted"] is True
    assert all(line not in result["message"] for line in WAITING_BRIDGE_LINES)


def test_crisis_stream_is_final_only_and_calls_no_model(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "30")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "1")
    experiment_id = client.post("/api/experiments", json={}).json()["experiment_id"]

    events = _stream(experiment_id, "지금 자해하고 싶다는 생각이 들어요.")
    assert [event["type"] for event in events] == ["arm_result", "complete"]
    result = events[-1]["results"]["baseline"]
    assert result["safety_bypass"] is True
    assert result["metrics"]["model_calls"] == 0
    assert result["metrics"]["bridge_emitted"] is False


def test_rapport_to_loop_intentionally_streams_no_waiting_bridge(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "30")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "1")
    experiment_id = client.post("/api/experiments", json={}).json()["experiment_id"]

    events = _stream(experiment_id, "1, 2, 3, 4, 5")
    segments = [event for event in events if event["type"] == "segment"]

    assert [event["segment"] for event in segments] == []
    assert not any(event.get("segment") == "bridge" for event in events)
    assert events[-1]["results"]["baseline"]["state"]["stage"] == "rapport"


def test_stream_multiplexes_both_ab_arms_without_changing_optimized(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "0")
    monkeypatch.setenv("BASELINE_BRIDGE_DELAY_MS", "1000")
    experiment_id = client.post("/api/experiments", json={}).json()["experiment_id"]

    events = _stream(experiment_id, "1, 2, 3, 4, 5", ["baseline", "optimized"])
    complete = events[-1]
    assert set(complete["results"]) == {"baseline", "optimized"}
    assert {
        event["arm"] for event in events if event["type"] == "arm_result"
    } == {"baseline", "optimized"}
    assert not any(
        event.get("segment") == "bridge" for event in events if event["type"] == "segment"
    )
    baseline_segments = [
        event for event in events
        if event.get("type") == "segment" and event.get("arm") == "baseline"
    ]
    assert [event["segment"] for event in baseline_segments] == []
    assert complete["results"]["optimized"]["metrics"]["delivery_profile"] == (
        "complete_response"
    )
    assert complete["results"]["baseline"]["state"]["stage"] == "rapport"
    assert complete["results"]["optimized"]["state"]["stage"] == "rapport"


def test_optimized_only_stream_request_has_no_delivery_segments(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "0")
    experiment_id = client.post("/api/experiments", json={}).json()["experiment_id"]

    events = _stream(experiment_id, "1, 2, 3, 4, 5", ["optimized"])
    assert [event["type"] for event in events] == ["arm_result", "complete"]
    result = events[-1]["results"]["optimized"]
    assert result["metrics"]["delivery_profile"] == "complete_response"
    assert result["state"]["stage"] == "rapport"
