#!/usr/bin/env python3
"""Run a real, redacted upstream-rapport smoke flow through the web API.

The script never reads or prints provider credentials.  It verifies that Mock mode
is disabled, probes the configured providers, creates an experiment, and advances
through rapport plus the first intake answer. Only model IDs and telemetry are
printed; the prompt and model responses are deliberately omitted.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

import httpx


SMOKE_MESSAGES = [
    "안녕하세요.",
    "오늘은 조금 긴장되지만 괜찮아요.",
    "편하게 찾아왔어요.",
    "친구에게 소개받았어요.",
    "요즘 프로젝트 일정이 밀려서 마음이 답답하고 잠도 잘 못 자요.",
]
SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
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
)


def _redact(value: object) -> str:
    text = str(value)
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _safe_error(value: object) -> str:
    return _redact(value)[:300]


def _request_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"HTTP {response.status_code}: JSON 응답이 아닙니다.") from exc
    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise RuntimeError(f"HTTP {response.status_code}: {_safe_error(detail)}")
    if not isinstance(payload, dict):
        raise RuntimeError("API 응답 최상위 값이 JSON object가 아닙니다.")
    return payload


def _validate_result(
    arm: str,
    result: dict[str, Any],
    comparison_id: str,
    *,
    allow_fallback: bool = False,
) -> dict[str, Any]:
    if result.get("comparison_id") != comparison_id:
        raise RuntimeError(f"{arm}: comparison_id가 일치하지 않습니다.")
    if result.get("status") != "ok":
        raise RuntimeError(f"{arm}: {_safe_error(result.get('error') or '실행 실패')}")

    metrics = result.get("metrics") or {}
    calls = result.get("calls") or []
    state = result.get("state") or {}
    scripted_baseline_transition = (
        arm == "baseline"
        and state.get("stage") == "loop"
        and int(state.get("turn_count") or 0) == 0
    )
    if (
        int(metrics.get("model_calls", 0)) < 1 or not calls
    ) and not scripted_baseline_transition:
        raise RuntimeError(f"{arm}: 실제 모델 호출 기록이 없습니다.")
    if not allow_fallback and int(metrics.get("failed_calls", 0)) != 0:
        raise RuntimeError(f"{arm}: 실패한 모델 호출이 있습니다.")
    if not allow_fallback and any(not call.get("success") for call in calls):
        raise RuntimeError(f"{arm}: 성공하지 못한 task가 있습니다.")
    if any(str(call.get("model", "")).startswith("mock:") for call in calls):
        raise RuntimeError(f"{arm}: Mock 모델 응답이 감지됐습니다.")

    return {
        "status": "ok",
        "total_ms": metrics.get("total_ms"),
        "model_ms": metrics.get("model_ms"),
        "model_calls": metrics.get("model_calls"),
        "retries": metrics.get("retries"),
        "failed_calls": metrics.get("failed_calls"),
        "fallback_used": metrics.get("fallback_used"),
        "input_tokens": metrics.get("input_tokens"),
        "output_tokens": metrics.get("output_tokens"),
        "tasks": [
            {
                "task": call.get("task"),
                "model": call.get("model"),
                "duration_ms": call.get("duration_ms"),
                "attempts": call.get("attempts"),
            }
            for call in calls
        ],
    }


def _failed_result(result: dict[str, Any], error: object) -> dict[str, Any]:
    """Return redacted telemetry even when one arm fails validation."""
    metrics = result.get("metrics") or {}
    calls = result.get("calls") or []
    return {
        "status": result.get("status") or "error",
        "error": _safe_error(result.get("error") or error),
        "total_ms": metrics.get("total_ms"),
        "model_ms": metrics.get("model_ms"),
        "model_calls": metrics.get("model_calls"),
        "retries": metrics.get("retries"),
        "failed_calls": metrics.get("failed_calls"),
        "tasks": [
            {
                "task": call.get("task"),
                "model": call.get("model"),
                "duration_ms": call.get("duration_ms"),
                "attempts": call.get("attempts"),
                "success": call.get("success"),
            }
            for call in calls
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="실행 중인 Pume A/B 웹 API에 실제 모델 smoke 요청을 보냅니다."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--arms",
        nargs="+",
        choices=("baseline", "optimized"),
        default=["baseline", "optimized"],
    )
    parser.add_argument("--timeout", type=float, default=180.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")

    try:
        with httpx.Client(base_url=base_url, timeout=args.timeout) as client:
            health = _request_json(client.get("/api/health", params={"probe": "true"}))
            providers = health.get("providers") or {}
            if (providers.get("mock_mode") or {}).get("enabled"):
                raise RuntimeError("AB_MOCK_MODE가 활성화되어 있습니다.")

            provider_summary: dict[str, Any] = {}
            for arm in args.arms:
                provider = providers.get("gemini") or {}
                if not provider.get("configured"):
                    raise RuntimeError(f"{arm}: provider 설정이 없습니다.")
                if provider.get("connected") is not True:
                    raise RuntimeError(
                        f"{arm}: provider 연결 실패: {_redact(provider.get('error') or 'unknown')}"
                    )
                provider_summary[arm] = {
                    "configured": True,
                    "connected": True,
                    "model": provider.get("model"),
                    "resolved_model": provider.get("resolved_model"),
                }

            experiment = _request_json(client.post("/api/experiments", json={}))
            experiment_id = experiment.get("experiment_id")
            if not experiment_id:
                raise RuntimeError("experiment_id를 받지 못했습니다.")

            validated: dict[str, list[dict[str, Any]]] = {arm: [] for arm in args.arms}
            comparison_ids: list[str] = []
            validation_errors: list[str] = []
            failed_results: dict[str, dict[str, Any]] = {}
            for message in SMOKE_MESSAGES:
                turn = _request_json(
                    client.post(
                        f"/api/experiments/{experiment_id}/turns",
                        json={"message": message, "arms": args.arms},
                    )
                )
                comparison_id = str(turn.get("comparison_id") or "")
                if not comparison_id:
                    raise RuntimeError("comparison_id를 받지 못했습니다.")
                comparison_ids.append(comparison_id)
                raw_results = turn.get("results") or {}
                for arm in args.arms:
                    raw_result = raw_results.get(arm) or {}
                    try:
                        validated[arm].append(
                            _validate_result(arm, raw_result, comparison_id)
                        )
                    except Exception as exc:
                        validation_errors.append(_safe_error(exc))
                        failed_results[arm] = _failed_result(raw_result, exc)

            results: dict[str, Any] = {}
            for arm in args.arms:
                if arm in failed_results:
                    results[arm] = failed_results[arm]
                    continue
                turns = validated[arm]
                results[arm] = {
                    "status": "ok",
                    "turns": len(turns),
                    "total_ms": round(sum(float(item["total_ms"] or 0) for item in turns), 2),
                    "model_ms": round(sum(float(item["model_ms"] or 0) for item in turns), 2),
                    "model_calls": sum(int(item["model_calls"] or 0) for item in turns),
                    "retries": sum(int(item["retries"] or 0) for item in turns),
                    "tasks": [task for item in turns for task in item["tasks"]],
                }

        report = {
            "status": "FAIL" if validation_errors else "PASS",
            "mock_mode": False,
            "providers": provider_summary,
            "comparison_ids": comparison_ids,
            "results": results,
        }
        if validation_errors:
            report["errors"] = validation_errors
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if validation_errors else 0
    except Exception as exc:
        print(
            json.dumps(
                {"status": "FAIL", "error": _safe_error(exc)},
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
