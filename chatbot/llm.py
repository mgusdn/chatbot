"""Gemini model calls for the A-series counseling pipeline."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from threading import Lock
import time
from typing import Iterator, Literal

from dotenv import load_dotenv

from .state import ModelProvider


ApiRoute = Literal["primary", "analyzer"]
ThinkingLevel = Literal["minimal", "low", "medium", "high"]


load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


class ModelProviderError(RuntimeError):
    """A model endpoint was missing, unreachable, or returned unusable JSON."""


@dataclass(frozen=True)
class ProviderConfig:
    provider: ModelProvider
    model: str
    base_url: str | None
    api_key: str
    json_mode: bool
    auth_mode: str = "api_key"
    project: str | None = None
    location: str | None = None


_TRACE: ContextVar[list[dict] | None] = ContextVar("model_trace", default=None)
_CLIENTS: dict[tuple, object] = {}
_CLIENTS_LOCK = Lock()
_VERTEX_CREDENTIALS: dict[str, object] = {}
_VERTEX_CREDENTIALS_LOCK = Lock()
_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL | re.IGNORECASE)
_HAN_RE = re.compile(r"[一-鿿]")
_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE), "Bearer [redacted]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"), "[redacted]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b", re.IGNORECASE), "[redacted]"),
    (
        re.compile(r"(x-goog-api-key\s*[:=]\s*)[^\s,;]+", re.IGNORECASE),
        r"\1[redacted]",
    ),
    (
        re.compile(r"([?&](?:key|api_key)=)[^&\s]+", re.IGNORECASE),
        r"\1[redacted]",
    ),
    (
        re.compile(
            r"((?:GEMINI|GOOGLE|OPENAI)_API_KEY\s*[:=]\s*)[^\s,;]+",
            re.IGNORECASE,
        ),
        r"\1[redacted]",
    ),
)


_NULLABLE_STRING = {"type": ["string", "null"]}
_SLOT_KEYS = [
    "situation",
    "emotion",
    "thought",
    "cause",
    "behavior",
    "duration",
    "impact",
    "relationship",
    "coping",
    "goal",
    "self_message",
]
_TASK_JSON_SCHEMAS: dict[str, dict] = {
    "reflect": {
        "type": "object",
        "properties": {"reflection": {"type": "string"}},
        "required": ["reflection"],
        "additionalProperties": False,
    },
    "baseline_opening": {
        "type": "object",
        "properties": {
            "empathy": {"type": "string"},
        },
        "required": ["empathy"],
        "additionalProperties": False,
    },
    "baseline_turn_analysis": {
        "type": "object",
        "properties": {
            "target_slot": {"type": "string", "enum": _SLOT_KEYS},
            "value": _NULLABLE_STRING,
            "decision": {
                "type": "string",
                "enum": [
                    "sufficient",
                    "detail",
                    "explicit_unknown",
                    "off_target",
                    "no_answer",
                    "uncertain",
                ],
            },
            "incidental_updates": {
                "type": "array",
                "maxItems": 2,
                "items": {
                    "type": "object",
                    "properties": {
                        "slot": {"type": "string", "enum": _SLOT_KEYS},
                        "value": {"type": "string"},
                        "sufficient": {"type": "boolean"},
                    },
                    "required": ["slot", "value", "sufficient"],
                    "additionalProperties": False,
                },
            },
        },
        "required": [
            "target_slot",
            "value",
            "decision",
            "incidental_updates",
        ],
        "additionalProperties": False,
    },
    "consolidate_slots": {
        "type": "object",
        "properties": {key: {"type": "string"} for key in _SLOT_KEYS},
        "required": _SLOT_KEYS,
        "additionalProperties": False,
    },
    "insight_report": {
        "type": "object",
        "properties": {"report": {"type": "string"}},
        "required": ["report"],
        "additionalProperties": False,
    },
}


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _max_tokens_for_task(task: str) -> int:
    """Give the long upstream insight report enough room to close its JSON object."""
    base = max(1, int(os.getenv("MODEL_MAX_TOKENS", "600")))
    if task == "insight_report":
        report_minimum = max(
            1, int(os.getenv("MODEL_INSIGHT_MAX_TOKENS", "4096"))
        )
        return max(base, report_minimum)
    return base


def redact_secrets(value: object) -> str:
    """Remove provider credentials before errors reach APIs, logs, or terminals."""
    text = str(value)
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _config(
    provider: ModelProvider = "gemini",
    api_route: ApiRoute | str = "primary",
) -> ProviderConfig:
    if provider == "gemini":
        route = _api_route(api_route)
        analyzer_enabled = route == "analyzer" and _env_bool(
            "ANALYZER_API_ENABLED", False
        )

        def route_value(name: str, default: str = "") -> str:
            if analyzer_enabled:
                override = os.getenv(f"ANALYZER_{name}")
                if override is not None:
                    return override
            return os.getenv(name, default)

        auth_mode = route_value("GEMINI_AUTH_MODE", "api_key").strip().lower()
        if auth_mode not in {"api_key", "vertex_adc"}:
            raise ModelProviderError(
                "GEMINI_AUTH_MODE는 'api_key' 또는 'vertex_adc'여야 합니다."
            )
        project = route_value("GOOGLE_CLOUD_PROJECT", "").strip() or None
        location = route_value("GOOGLE_CLOUD_LOCATION", "global").strip() or "global"
        if auth_mode == "vertex_adc":
            # Keep the API-key compatibility URL out of the Vertex ADC lane.
            # A shared .env commonly contains GEMINI_BASE_URL for fallback;
            # sending an OAuth access token there produces a misleading 401.
            base_url = route_value("GEMINI_VERTEX_BASE_URL", "").strip() or (
                "https://aiplatform.googleapis.com/v1/"
                f"projects/{project or '[missing-project]'}/locations/{location}"
                "/endpoints/openapi"
            )
            api_key = ""
        else:
            base_url = route_value(
                "GEMINI_BASE_URL",
                "https://generativelanguage.googleapis.com/v1beta/openai/",
            )
            api_key = route_value("GEMINI_API_KEY") or route_value(
                "GOOGLE_API_KEY"
            )
        return ProviderConfig(
            provider=provider,
            model=route_value("GEMINI_MODEL", "gemini-3.5-flash"),
            base_url=base_url,
            api_key=api_key,
            json_mode=True,
            auth_mode=auth_mode,
            project=project,
            location=location,
        )
    raise ValueError(f"Unknown model provider: {provider}")


def _route_is_separate() -> bool:
    """Return true only when the opt-in analyzer route uses different capacity."""
    if not _env_bool("ANALYZER_API_ENABLED", False):
        return False
    primary = _config("gemini", "primary")
    analyzer = _config("gemini", "analyzer")
    return (
        primary.auth_mode,
        primary.base_url,
        primary.project,
        primary.location,
        primary.api_key,
    ) != (
        analyzer.auth_mode,
        analyzer.base_url,
        analyzer.project,
        analyzer.location,
        analyzer.api_key,
    )


def analyzer_api_is_separate() -> bool:
    """Public scheduling signal; never implies the analyzer is healthy."""
    return _route_is_separate()


def _configured(config: ProviderConfig) -> bool:
    if config.auth_mode == "vertex_adc":
        return bool(config.project and config.location and config.model)
    return bool(config.api_key)


def _request_model(config: ProviderConfig) -> str:
    if config.provider == "gemini" and config.auth_mode == "vertex_adc":
        model = config.model.removeprefix("models/")
        return model if model.startswith("google/") else f"google/{model}"
    return config.model


def _vertex_access_token(config: ProviderConfig) -> str:
    if not config.project:
        raise ModelProviderError(
            "Vertex ADC 모드에는 GOOGLE_CLOUD_PROJECT가 필요합니다."
        )
    try:
        import google.auth
        import google.auth.transport.requests
    except ImportError as exc:  # pragma: no cover - installation guidance path
        raise ModelProviderError(
            "Vertex ADC 인증에 google-auth와 requests 패키지가 필요합니다."
        ) from exc

    with _VERTEX_CREDENTIALS_LOCK:
        credentials = _VERTEX_CREDENTIALS.get(config.project)
        if credentials is None:
            try:
                credentials, _ = google.auth.default(
                    scopes=["https://www.googleapis.com/auth/cloud-platform"],
                    quota_project_id=config.project,
                )
            except Exception as exc:
                raise ModelProviderError(
                    "ADC 자격증명을 읽지 못했습니다. "
                    "'gcloud auth application-default login'을 실행해 주세요."
                ) from exc
            _VERTEX_CREDENTIALS[config.project] = credentials

        if not getattr(credentials, "valid", False):
            try:
                credentials.refresh(google.auth.transport.requests.Request())
            except Exception as exc:
                raise ModelProviderError(
                    "Vertex ADC access token을 갱신하지 못했습니다."
                ) from exc
        token = getattr(credentials, "token", None)
        if not token:
            raise ModelProviderError("Vertex ADC access token이 비어 있습니다.")
        return str(token)


def _client(config: ProviderConfig):
    if config.provider == "gemini" and not _configured(config):
        if config.auth_mode == "vertex_adc":
            raise ModelProviderError(
                "Vertex ADC 모드에는 GOOGLE_CLOUD_PROJECT가 필요합니다."
            )
        raise ModelProviderError("GEMINI_API_KEY가 설정되지 않았습니다.")

    api_key = (
        _vertex_access_token(config)
        if config.provider == "gemini" and config.auth_mode == "vertex_adc"
        else config.api_key
    )
    key = (
        config.provider,
        config.base_url,
        config.auth_mode,
        "adc" if config.auth_mode == "vertex_adc" else config.api_key,
        os.getenv("MODEL_TIMEOUT_SECONDS", "60"),
    )
    with _CLIENTS_LOCK:
        client = _CLIENTS.get(key)
        if client is not None:
            if config.auth_mode == "vertex_adc":
                client.api_key = api_key
            return client
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - installation guidance path
            raise ModelProviderError("openai 패키지가 없습니다. requirements.txt를 설치해 주세요.") from exc

        kwargs = {
            "api_key": api_key,
            "timeout": float(os.getenv("MODEL_TIMEOUT_SECONDS", "60")),
            "max_retries": 0,
        }
        if config.base_url:
            kwargs["base_url"] = config.base_url
        client = OpenAI(**kwargs)
        _CLIENTS[key] = client
        return client


def _thinking_level(value: str | None, default: str = "low") -> ThinkingLevel:
    normalized = (value or default).strip().lower()
    if normalized not in {"minimal", "low", "medium", "high"}:
        raise ModelProviderError(
            "thinking level은 minimal, low, medium, high 중 하나여야 합니다."
        )
    return normalized  # type: ignore[return-value]


def _api_route(value: str | None) -> ApiRoute:
    normalized = (value or "primary").strip().lower()
    if normalized not in {"primary", "analyzer"}:
        raise ModelProviderError("api route는 primary 또는 analyzer여야 합니다.")
    return normalized  # type: ignore[return-value]


def _strip_think(text: str) -> str:
    return _THINK_RE.sub("", text or "").strip()


def _parse_json(text: str) -> dict:
    cleaned = _strip_think(text)
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            return {}
        try:
            value = json.loads(match.group())
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            return {}


def _missing_keys(parsed: dict, required_keys: list[str] | None) -> list[str]:
    if not required_keys:
        return []
    return [key for key in required_keys if key not in parsed or parsed[key] in (None, "", [], {})]


def _response_format(task: str) -> dict:
    """Build the strict JSON schema used by Gemini for this task.

    Gemini's compatibility endpoint accepts OpenAI-compatible
    ``json_schema`` response formats. Constrained decoding matters for the
    fine-tuned 4B model: JSON mode alone guarantees syntax, but it does not
    guarantee the task-specific keys.
    """
    schema = _TASK_JSON_SCHEMAS.get(task)
    if schema is None:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": task,
            "strict": True,
            "schema": schema,
        },
    }


def _matching_model_id(configured: str, returned_ids: list[str]) -> str | None:
    """Match Gemini's optional model namespace prefixes."""
    configured_normalized = configured.removeprefix("models/").removeprefix("google/")
    for model_id in returned_ids:
        normalized = model_id.removeprefix("models/").removeprefix("google/")
        if normalized == configured_normalized:
            return model_id
    return None


@contextmanager
def collect_model_metrics() -> Iterator[list[dict]]:
    """Collect model-call timings for one graph invocation."""
    records: list[dict] = []
    token = _TRACE.set(records)
    try:
        yield records
    finally:
        _TRACE.reset(token)


def _append_trace(record: dict) -> None:
    records = _TRACE.get()
    if records is not None:
        records.append(record)


def _mock_json(
    provider: ModelProvider,
    task: str,
    user: str,
    timeout_seconds: float | None = None,
) -> dict:
    delay_ms = float(os.getenv("MOCK_GEMINI_DELAY_MS", "5"))
    delay_seconds = delay_ms / 1000
    if timeout_seconds is not None and delay_seconds > timeout_seconds:
        time.sleep(max(0.0, timeout_seconds))
        raise TimeoutError("mock provider timeout")
    time.sleep(delay_seconds)

    if task == "reflect":
        return {"reflection": "말씀해 주신 마음이 느껴져요."}
    if task == "baseline_opening":
        return {"empathy": "말씀해 주신 마음이 느껴져요."}
    if task == "baseline_turn_analysis":
        target_match = re.search(r"현재 질문 대상 슬롯:\s*([a-z_]+)", user)
        target = (
            target_match.group(1)
            if target_match and target_match.group(1) in _SLOT_KEYS
            else "situation"
        )
        answer_match = re.search(
            r"사용자의 답변:\s*(.*?)(?:\n\n|$)", user, re.DOTALL
        )
        value = (answer_match.group(1).strip() if answer_match else "")[:200]
        return {
            "target_slot": target,
            "value": value or None,
            "decision": "sufficient" if value else "no_answer",
            "incidental_updates": [],
        }
    if task == "consolidate_slots":
        result: dict[str, str] = {}
        for key in _SLOT_KEYS:
            match = re.search(rf"^{key}:\s*(.*)$", user, flags=re.MULTILINE)
            result[key] = match.group(1).strip() if match else ""
        return result
    if task == "insight_report":
        return {
            "report": "## 🧊 사티어 빙산 기반 내면 분석 리포트\\n\\n"
            "말씀해 주신 내용을 바탕으로 마음의 흐름을 정리했어요."
        }
    return {}


def call_model_json(
    provider: ModelProvider,
    *,
    task: str,
    system: str,
    user: str,
    required_keys: list[str] | None = None,
    reasoning_effort: str | None = None,
    api_route: ApiRoute | str = "primary",
    thinking_level: ThinkingLevel | str | None = None,
    timeout_seconds: float | None = None,
) -> dict:
    """Call Gemini and return one JSON object.

    The same function is used by every LLM-backed node. A logical retry is allowed
    for invalid JSON or missing required fields, and every attempt is traceable.
    """
    started = time.perf_counter()
    route = _api_route(api_route)
    config = _config(provider, route)
    attempts = 0
    parsed: dict = {}
    raw = ""
    last_error: Exception | None = None
    input_tokens = 0
    output_tokens = 0
    reasoning_tokens = 0
    effective_thinking = (
        _thinking_level(thinking_level)
        if thinking_level is not None
        else (reasoning_effort or os.getenv("GEMINI_REASONING_EFFORT", "low")).strip()
    )
    request_model = _request_model(config)
    resolved_model = request_model
    timeout_budget = (
        max(0.05, float(timeout_seconds))
        if timeout_seconds is not None
        else None
    )
    deadline = started + timeout_budget if timeout_budget is not None else None
    timed_out = False

    mock_mode = _env_bool(
        "CHATBOT_MOCK_MODE", _env_bool("AB_MOCK_MODE", False)
    )
    max_attempts = max(1, int(os.getenv("MODEL_MAX_ATTEMPTS", "2")))
    if task == "insight_report":
        max_attempts = max(max_attempts, 3)
    if not mock_mode and not _configured(config):
        max_attempts = 1

    for attempt in range(1, max_attempts + 1):
        remaining_seconds = None
        if deadline is not None:
            remaining_seconds = deadline - time.perf_counter()
            if remaining_seconds <= 0:
                timed_out = True
                last_error = TimeoutError(
                    f"{task}: {timeout_budget:.2f}초 제한 시간을 초과했습니다"
                )
                break
        attempts = attempt
        try:
            if mock_mode:
                parsed = _mock_json(
                    provider,
                    task,
                    user,
                    timeout_seconds=remaining_seconds,
                )
                raw = json.dumps(parsed, ensure_ascii=False)
            else:
                request: dict = {
                    "model": request_model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": (
                        float(os.getenv("MODEL_TEMPERATURE", "0.3"))
                        if attempt == 1
                        else 0.0
                    ),
                    "max_tokens": _max_tokens_for_task(task),
                }
                if config.json_mode:
                    request["response_format"] = _response_format(task)
                if thinking_level is not None:
                    # Gemini 3.5 Flash exposes ``minimal`` through its native
                    # thinking_config. Never send reasoning_effort alongside it.
                    level = _thinking_level(thinking_level)
                    request["extra_body"] = {
                        "extra_body": {
                            "google": {
                                "thinking_config": {
                                    "thinking_level": level,
                                    "include_thoughts": False,
                                }
                            }
                        }
                    }
                else:
                    effort = reasoning_effort or os.getenv(
                        "GEMINI_REASONING_EFFORT", "low"
                    ).strip()
                    if task == "insight_report" and attempt > 1:
                        effort = "low"
                        effective_thinking = effort
                    if effort:
                        request["reasoning_effort"] = effort

                client = _client(config)
                if deadline is not None:
                    remaining_seconds = deadline - time.perf_counter()
                    if remaining_seconds <= 0:
                        raise TimeoutError(
                            f"{task}: {timeout_budget:.2f}초 제한 시간을 초과했습니다"
                        )
                    request["timeout"] = min(
                        float(os.getenv("MODEL_TIMEOUT_SECONDS", "60")),
                        max(0.05, remaining_seconds),
                    )
                response = client.chat.completions.create(**request)
                resolved_model = getattr(response, "model", None) or request_model
                raw = _strip_think(response.choices[0].message.content or "")
                parsed = _parse_json(raw)
                usage = getattr(response, "usage", None)
                if usage:
                    input_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
                    output_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
                    details = getattr(usage, "completion_tokens_details", None)
                    reasoning_tokens += int(
                        getattr(details, "reasoning_tokens", 0) or 0
                    )

            missing = _missing_keys(parsed, required_keys)
            if parsed and not missing:
                last_error = None
                break
            last_error = ModelProviderError(
                f"{task}: JSON 응답이 불완전합니다"
                + (f" (누락: {', '.join(missing)})" if missing else "")
            )
        except Exception as exc:  # provider SDK errors are normalized below
            last_error = exc
            if deadline is not None and (
                time.perf_counter() >= deadline
                or "timeout" in type(exc).__name__.lower()
            ):
                timed_out = True
                break

    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    success = last_error is None
    error_text = None if success else redact_secrets(
        f"{type(last_error).__name__}: {last_error}"
    )[:240]
    _append_trace(
        {
            "task": task,
            "provider": provider,
            "api_route": route,
            "thinking_level": effective_thinking,
            "model": f"mock:{config.model}" if mock_mode else resolved_model,
            "requested_model": config.model,
            "duration_ms": duration_ms,
            "attempts": attempts,
            "parse_success": bool(parsed),
            "success": success,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "reasoning_tokens": reasoning_tokens,
            "input_chars": len(system) + len(user),
            "output_chars": len(raw),
            "timeout_seconds": timeout_budget,
            "timed_out": timed_out,
            # Language leakage is a quality signal, not a retry condition.
            "hanja_detected": bool(_HAN_RE.search(raw)),
            "error": error_text,
        }
    )

    if last_error is not None:
        if isinstance(last_error, ModelProviderError):
            raise last_error
        raise ModelProviderError(error_text or "모델 호출에 실패했습니다.") from last_error
    return parsed


def provider_status(probe: bool = False) -> dict[str, dict]:
    """Return non-secret Gemini configuration and optional connectivity probe."""
    mock_mode = _env_bool(
        "CHATBOT_MOCK_MODE", _env_bool("AB_MOCK_MODE", False)
    )
    config = _config("gemini", "primary")
    configured = _configured(config)
    analyzer_separate = _route_is_separate()
    try:
        baseline_bridge_delay_ms = max(
            0.0, float(os.getenv("BASELINE_BRIDGE_DELAY_MS", "2200"))
        )
    except ValueError:
        baseline_bridge_delay_ms = 2200.0
    try:
        baseline_opening_lead_timeout_ms = max(
            50.0,
            float(os.getenv("BASELINE_OPENING_LEAD_TIMEOUT_SECONDS", "1.8"))
            * 1000,
        )
    except ValueError:
        baseline_opening_lead_timeout_ms = 1800.0
    try:
        baseline_aside_cooldown_turns = max(
            1, int(os.getenv("BASELINE_ASIDE_COOLDOWN_TURNS", "3"))
        )
    except ValueError:
        baseline_aside_cooldown_turns = 3
    entry = {
        "configured": configured or mock_mode,
        "connected": True if mock_mode else None,
        "model": f"mock:{config.model}" if mock_mode else config.model,
        "base_url": redact_secrets(config.base_url or ""),
        "auth_mode": config.auth_mode,
        "error": None,
        "profile": {
                "api_route": "primary",
                "response_thinking_level": os.getenv(
                    "BASELINE_RESPONSE_THINKING_LEVEL"
                )
                or os.getenv("BASELINE_RESPONSE_THINKING", "minimal").strip(),
                "analyzer_thinking_level": os.getenv(
                    "BASELINE_ANALYZER_REASONING_EFFORT"
                )
                or os.getenv("BASELINE_ANALYZER_THINKING", "low").strip(),
                "analyzer_api_route": "analyzer" if analyzer_separate else "primary",
                "loop_profile": "principle_cache_speaking_v5",
                "delivery_profile": "dynamic_principle_aside_v4",
                "opening_lead_timeout_ms": baseline_opening_lead_timeout_ms,
                "bridge_delay_ms": baseline_bridge_delay_ms,
                "aside_cooldown_turns": baseline_aside_cooldown_turns,
        },
    }
    if config.auth_mode == "vertex_adc":
        entry["project"] = config.project
        entry["location"] = config.location
    if probe and configured and not mock_mode:
        try:
            if config.auth_mode == "vertex_adc":
                _client(config)
                matched = _request_model(config)
            else:
                models = _client(config).models.list()
                returned_ids = [str(item.id) for item in getattr(models, "data", [])]
                matched = _matching_model_id(_request_model(config), returned_ids)
                if matched is None:
                    raise ModelProviderError(
                        f"설정한 모델 '{config.model}'을 endpoint의 모델 목록에서 찾지 못했습니다."
                    )
            entry["connected"] = True
            entry["resolved_model"] = matched
        except Exception as exc:
            entry["connected"] = False
            entry["error"] = redact_secrets(f"{type(exc).__name__}: {exc}")[:180]
    return {"gemini": entry, "mock_mode": {"enabled": mock_mode}}
