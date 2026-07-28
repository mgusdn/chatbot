import os
import time
from types import SimpleNamespace

import pytest

os.environ["AB_MOCK_MODE"] = "true"

from counsel import llm
from counsel.llm import (
    ModelProviderError,
    _config,
    _max_tokens_for_task,
    _response_format,
    call_model_json,
    collect_model_metrics,
    provider_status,
)
from counsel.state import SLOT_ORDER


def test_gemini_trace_identifies_provider_not_pipeline_arm(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "0")
    with collect_model_metrics() as records:
        result = call_model_json(
            "gemini",
            task="next_question",
            system="JSON으로 답하세요.",
            user="다음으로 확인할 내용: 요즘 어떤 점이 가장 힘드신가요?",
        )
    assert result["question"]
    assert records[0]["provider"] == "gemini"
    assert "arm" not in records[0]
    assert records[0]["parse_success"] is True


def test_only_gemini_provider_is_exposed_and_qwen_is_rejected():
    status = provider_status()
    assert set(status) == {"gemini", "mock_mode"}
    assert "qwen" not in str(status).lower()
    with pytest.raises(ValueError, match="Unknown model provider"):
        _config("qwen")  # type: ignore[arg-type]


def test_provider_status_exposes_baseline_and_optimized_runtime_profiles(
    monkeypatch,
):
    monkeypatch.setenv("GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_BASE_URL", "https://primary.example/v1/")
    monkeypatch.setenv("GEMINI_REASONING_EFFORT", "low")
    monkeypatch.setenv("ANALYZER_API_ENABLED", "true")
    monkeypatch.setenv("ANALYZER_GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("ANALYZER_GEMINI_API_KEY", "analyzer-test-key")
    monkeypatch.setenv("ANALYZER_GEMINI_BASE_URL", "https://analyzer.example/v1/")
    monkeypatch.setenv("OPTIMIZED_RESPONSE_API_ROUTE", "primary")
    monkeypatch.setenv("OPTIMIZED_RESPONSE_THINKING", "minimal")
    monkeypatch.setenv("OPTIMIZED_ANALYZER_THINKING", "low")
    monkeypatch.setenv("BASELINE_RESPONSE_THINKING", "minimal")
    monkeypatch.setenv("BASELINE_ANALYZER_THINKING", "low")

    profiles = provider_status()["gemini"]["profiles"]

    assert profiles["baseline"] == {
        "api_route": "primary",
        "response_thinking_level": "minimal",
        "analyzer_thinking_level": "low",
        "analyzer_api_route": "analyzer",
        "loop_profile": "principle_cache_speaking_v5",
        "delivery_profile": "dynamic_principle_aside_v4",
        "opening_lead_timeout_ms": 1800.0,
        "bridge_delay_ms": 2200.0,
        "aside_cooldown_turns": 3,
    }
    assert profiles["optimized"]["response_api_route"] == "primary"
    assert profiles["optimized"]["response_thinking_level"] == "minimal"
    assert profiles["optimized"]["analyzer_api_route"] == "analyzer"
    assert profiles["optimized"]["analyzer_thinking_level"] == "low"
    assert profiles["optimized"]["analyzer_api_separate"] is True


def test_analyzer_route_inherits_primary_until_explicitly_enabled(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_BASE_URL", "https://primary.example/v1/")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-primary")
    monkeypatch.setenv("ANALYZER_API_ENABLED", "false")
    monkeypatch.setenv("ANALYZER_GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("ANALYZER_GEMINI_API_KEY", "analyzer-test-key")
    monkeypatch.setenv("ANALYZER_GEMINI_BASE_URL", "https://analyzer.example/v1/")
    monkeypatch.setenv("ANALYZER_GEMINI_MODEL", "gemini-analyzer")

    primary = _config("gemini", api_route="primary")
    analyzer = _config("gemini", api_route="analyzer")

    assert analyzer == primary
    assert llm._route_is_separate() is False


def test_enabled_analyzer_route_uses_its_own_endpoint_configuration(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_BASE_URL", "https://primary.example/v1/")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-primary")
    monkeypatch.setenv("ANALYZER_API_ENABLED", "true")
    monkeypatch.setenv("ANALYZER_GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("ANALYZER_GEMINI_API_KEY", "analyzer-test-key")
    monkeypatch.setenv("ANALYZER_GEMINI_BASE_URL", "https://analyzer.example/v1/")
    monkeypatch.setenv("ANALYZER_GEMINI_MODEL", "gemini-analyzer")

    primary = _config("gemini", api_route="primary")
    analyzer = _config("gemini", api_route="analyzer")

    assert primary.base_url == "https://primary.example/v1/"
    assert primary.model == "gemini-primary"
    assert analyzer.base_url == "https://analyzer.example/v1/"
    assert analyzer.model == "gemini-analyzer"
    assert analyzer.api_key == "analyzer-test-key"
    assert llm._route_is_separate() is True


def test_vertex_adc_ignores_api_key_base_url_and_builds_vertex_endpoint(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTH_MODE", "vertex_adc")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "vertex-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    monkeypatch.setenv(
        "GEMINI_BASE_URL",
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    )
    monkeypatch.delenv("GEMINI_VERTEX_BASE_URL", raising=False)

    config = _config("gemini")

    assert config.base_url == (
        "https://aiplatform.googleapis.com/v1/projects/vertex-project/"
        "locations/global/endpoints/openapi"
    )


def test_enabled_analyzer_route_inherits_primary_when_overrides_are_absent(
    monkeypatch,
):
    monkeypatch.setenv("GEMINI_AUTH_MODE", "api_key")
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_BASE_URL", "https://primary.example/v1/")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-primary")
    monkeypatch.setenv("ANALYZER_API_ENABLED", "true")
    for name in {
        "ANALYZER_GEMINI_AUTH_MODE",
        "ANALYZER_GEMINI_API_KEY",
        "ANALYZER_GOOGLE_API_KEY",
        "ANALYZER_GEMINI_BASE_URL",
        "ANALYZER_GEMINI_MODEL",
        "ANALYZER_GOOGLE_CLOUD_PROJECT",
        "ANALYZER_GOOGLE_CLOUD_LOCATION",
    }:
        monkeypatch.delenv(name, raising=False)

    primary = _config("gemini", api_route="primary")
    analyzer = _config("gemini", api_route="analyzer")

    assert analyzer == primary
    assert llm._route_is_separate() is False


def test_insight_report_has_larger_token_budget(monkeypatch):
    monkeypatch.setenv("MODEL_MAX_TOKENS", "600")
    monkeypatch.delenv("MODEL_INSIGHT_MAX_TOKENS", raising=False)
    assert _max_tokens_for_task("extract_slots") == 600
    assert _max_tokens_for_task("insight_report") == 4096


def test_latest_upstream_eleven_slot_schemas_are_strict():
    for task in {
        "reflect",
        "next_question",
        "detail_question",
        "extract_slots",
        "sufficiency_check",
        "consolidate_slots",
        "insight_report",
        "target_slot_analysis",
        "response_candidates",
        "baseline_turn_analysis",
        "baseline_opening",
    }:
        assert _response_format(task)["type"] == "json_schema"

    extraction = _response_format("extract_slots")["json_schema"]["schema"]
    assert extraction["required"] == SLOT_ORDER
    assert {"relationship", "self_message"} <= set(extraction["properties"])


def test_optimized_analyzer_and_response_contracts():
    analyzer = _response_format("target_slot_analysis")["json_schema"]["schema"]
    assert analyzer["properties"]["decision"]["enum"] == [
        "sufficient",
        "detail",
        "explicit_unknown",
        "off_target",
        "no_answer",
        "uncertain",
    ]
    incidental = analyzer["properties"]["incidental_updates"]
    assert incidental["maxItems"] == 2
    assert incidental["items"]["properties"]["slot"]["enum"] == SLOT_ORDER
    assert incidental["items"]["required"] == [
        "slot",
        "value",
        "sufficient",
        "confidence",
    ]
    response = _response_format("response_candidates")["json_schema"]["schema"]
    assert response["required"] == [
        "reflection",
        "if_sufficient",
        "if_insufficient",
    ]


def test_baseline_speaking_while_thinking_contracts():
    analyzer = _response_format("baseline_turn_analysis")["json_schema"]["schema"]
    assert analyzer["properties"]["incidental_updates"]["maxItems"] == 2
    assert "aside_mode" not in analyzer["properties"]
    assert analyzer["required"] == [
        "target_slot",
        "value",
        "decision",
        "incidental_updates",
    ]
    assert analyzer["properties"]["incidental_updates"]["items"]["required"] == [
        "slot",
        "value",
        "sufficient",
    ]

    opening = _response_format("baseline_opening")["json_schema"]["schema"]
    assert opening["required"] == ["empathy"]
    assert "question" not in opening["properties"]


def test_per_call_timeout_is_passed_to_provider_and_traced(monkeypatch):
    class SlowCompletions:
        def create(self, **kwargs):
            timeout = float(kwargs["timeout"])
            time.sleep(timeout)
            raise TimeoutError("simulated provider timeout")

    class FakeClient:
        class Chat:
            completions = SlowCompletions()

        chat = Chat()

    monkeypatch.setenv("AB_MOCK_MODE", "false")
    monkeypatch.setattr(llm, "_configured", lambda config: True)
    monkeypatch.setattr(llm, "_client", lambda config: FakeClient())

    started = time.perf_counter()
    with collect_model_metrics() as records:
        with pytest.raises(ModelProviderError):
            call_model_json(
                "gemini",
                task="target_slot_analysis",
                system="JSON",
                user="분석",
                timeout_seconds=0.05,
            )
    elapsed = time.perf_counter() - started

    assert elapsed < 0.15
    assert records[0]["timed_out"] is True
    assert records[0]["timeout_seconds"] == pytest.approx(0.05)


def test_minimal_thinking_uses_gemini_extra_body_without_reasoning_effort(
    monkeypatch,
):
    observed = {}

    class CapturingCompletions:
        def create(self, **kwargs):
            observed.update(kwargs)
            return SimpleNamespace(
                model="google/gemini-3.5-flash",
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content='{"question":"요즘 마음은 어떠신가요?"}'
                        )
                    )
                ],
                usage=SimpleNamespace(prompt_tokens=10, completion_tokens=8),
            )

    class FakeClient:
        class Chat:
            completions = CapturingCompletions()

        chat = Chat()

    monkeypatch.setenv("AB_MOCK_MODE", "false")
    monkeypatch.setenv("MODEL_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("GEMINI_REASONING_EFFORT", "low")
    monkeypatch.setattr(llm, "_configured", lambda config: True)
    monkeypatch.setattr(llm, "_client", lambda config: FakeClient())

    with collect_model_metrics() as records:
        result = call_model_json(
            "gemini",
            task="next_question",
            system="JSON으로 답하세요.",
            user="질문을 하나 생성하세요.",
            api_route="primary",
            # Even an explicitly supplied legacy effort must not be put on the
            # wire together with Gemini's native thinking configuration.
            reasoning_effort="low",
            thinking_level="minimal",
        )

    assert result["question"] == "요즘 마음은 어떠신가요?"
    assert "reasoning_effort" not in observed
    assert observed["extra_body"] == {
        "extra_body": {
            "google": {
                "thinking_config": {
                    "thinking_level": "minimal",
                    "include_thoughts": False,
                }
            }
        }
    }
    assert records[0]["api_route"] == "primary"
    assert records[0]["thinking_level"] == "minimal"


def test_mock_analyzer_recognizes_non_situation_target(monkeypatch):
    monkeypatch.setenv("AB_MOCK_MODE", "true")
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "0")
    result = call_model_json(
        "gemini",
        task="target_slot_analysis",
        system="JSON",
        user="현재 질문 대상 슬롯: emotion\n사용자의 답변: 불안하고 답답해요.",
    )

    assert result["target_slot"] == "emotion"
    assert result["value"] == "불안하고 답답해요."
    assert result["incidental_updates"] == []
