#!/usr/bin/env python3
"""Exercise A with real streaming, adaptive slot answers, and visible tone checks.

The script reads no credentials and prints no provider configuration secrets. It
follows the server's actual pending slot so incidental slot extraction cannot
make the synthetic conversation drift away from the question being asked.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from typing import Any

import httpx


RAPPORT_MESSAGES = (
    "안녕하세요.",
    "기분이 좋아요.",
    "네, 괜찮았어요.",
    "프메 멤버예요.",
)

SLOT_ANSWERS = {
    "situation": "자소서를 계속 미루다가 지원 마감 직전에야 겨우 손을 대게 돼요.",
    "emotion": "스스로한테 화도 나고 답답해요.",
    "thought": "이번에도 결국 서류를 못 낼 것 같다는 생각이 계속 들어요.",
    "cause": "음… 잘 모르겠어요.",
    "behavior": "자소서 항목도 헷갈리고 마감 일정도 자주 깜빡해요.",
    "duration": "두 달 정도 됐고 거의 매번 그래요.",
    "impact": "이번에도 지원한 곳 중 절반은 마감을 놓쳐버렸어요.",
    "relationship": "주변 사람들과 지원 이야기를 꺼내는 것도 피하게 돼요.",
    "coping": "캘린더 알람은 조금 도움이 됐지만 스터디 그룹은 별로 도움이 안 됐어요.",
    "goal": "미리미리 준비해서 마감 전에 여유 있게 제출하는 사람이 되고 싶어요.",
    "self_message": "한 번에 다 하려 하지 말고 오늘 할 수 있는 만큼 시작해도 된다고 말해주고 싶어요.",
}

FORBIDDEN_ASIDE_PHRASES = (
    "저희 애",
    "제가 상담",
    "저도 그랬",
    "병이에요",
    "장애예요",
    "반드시 잘될",
    "무조건 잘",
)


def _json_response(response: httpx.Response) -> dict[str, Any]:
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("JSON object 응답이 아닙니다.")
    return payload


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentile)))
    return round(ordered[index], 2)


def _stream_turn(
    client: httpx.Client,
    experiment_id: str,
    message: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], float, float | None]:
    started = time.perf_counter()
    events: list[dict[str, Any]] = []
    first_wall_ms: float | None = None
    with client.stream(
        "POST",
        f"/api/experiments/{experiment_id}/turns/stream",
        json={"message": message, "arms": ["baseline"]},
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            event = json.loads(line)
            events.append(event)
            if event.get("type") == "segment" and first_wall_ms is None:
                first_wall_ms = round((time.perf_counter() - started) * 1000, 2)
    wall_ms = round((time.perf_counter() - started) * 1000, 2)
    complete = next(
        (event for event in reversed(events) if event.get("type") == "complete"),
        None,
    )
    if not complete:
        raise RuntimeError("stream complete 이벤트가 없습니다.")
    result = (complete.get("results") or {}).get("baseline") or {}
    if result.get("status") != "ok":
        raise RuntimeError(str(result.get("error") or "baseline 실행 실패"))
    return events, result, wall_ms, first_wall_ms


def main() -> int:
    parser = argparse.ArgumentParser(
        description="A 원리 말투와 streaming latency를 실제 Gemini로 검증합니다."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()

    turns: list[dict[str, Any]] = []
    failures: list[str] = []
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        timeout=args.timeout,
    ) as client:
        health = _json_response(client.get("/api/health"))
        provider = (health.get("providers") or {}).get("gemini") or {}
        if ((health.get("providers") or {}).get("mock_mode") or {}).get("enabled"):
            raise RuntimeError("실제 검증에는 AB_MOCK_MODE=false가 필요합니다.")
        if not provider.get("configured"):
            raise RuntimeError("Gemini provider가 설정되지 않았습니다.")
        bank = health.get("principle_bank") or {}
        if not bank.get("enabled"):
            raise RuntimeError("principle bank가 활성화되지 않았습니다.")

        experiment = _json_response(client.post("/api/experiments", json={}))
        experiment_id = str(experiment["experiment_id"])
        state = (experiment.get("states") or {}).get("baseline") or {}

        for message in RAPPORT_MESSAGES:
            _, result, _, _ = _stream_turn(client, experiment_id, message)
            state = result.get("state") or {}

        seen_pending: set[str] = set()
        while state.get("stage") == "loop":
            pending = str(state.get("pending_slot") or "")
            if pending not in SLOT_ANSWERS:
                raise RuntimeError(f"예상하지 못한 pending slot: {pending!r}")
            if pending in seen_pending:
                # One detail re-ask is valid. A third visit indicates a loop.
                visits = sum(turn["pending_before"] == pending for turn in turns)
                if visits >= 2:
                    raise RuntimeError(f"{pending} 슬롯이 세 번 이상 반복됐습니다.")
            seen_pending.add(pending)

            events, result, wall_ms, first_wall_ms = _stream_turn(
                client,
                experiment_id,
                SLOT_ANSWERS[pending],
            )
            metrics = result.get("metrics") or {}
            segments = [
                {
                    "segment": event.get("segment"),
                    "text": event.get("text"),
                    "elapsed_ms": event.get("elapsed_ms"),
                }
                for event in events
                if event.get("type") == "segment"
            ]
            aside_texts = [
                str(segment["text"])
                for segment in segments
                if segment["segment"] == "aside"
            ]
            if [segment["segment"] for segment in segments[:2]] not in (
                ["reflection"],
                ["reflection", "aside"],
                ["reflection", "bridge"],
            ):
                failures.append(f"{pending}: segment 순서가 올바르지 않습니다.")
            if any(
                phrase in aside
                for aside in aside_texts
                for phrase in FORBIDDEN_ASIDE_PHRASES
            ):
                failures.append(f"{pending}: 금지된 aside 표현이 있습니다.")
            if any("?" in aside or "？" in aside for aside in aside_texts):
                failures.append(f"{pending}: aside가 질문을 침범했습니다.")
            if metrics.get("principle_lookup_ms") is not None and float(
                metrics["principle_lookup_ms"]
            ) > 20:
                failures.append(f"{pending}: 로컬 검색이 20ms를 넘었습니다.")

            turn = {
                "pending_before": pending,
                "user": SLOT_ANSWERS[pending],
                "segments": segments,
                "message": result.get("message"),
                "pending_after": (result.get("state") or {}).get("pending_slot"),
                "server_first_ms": metrics.get("first_response_ms"),
                "browser_like_first_ms": first_wall_ms,
                "total_ms": metrics.get("total_ms"),
                "wall_ms": wall_ms,
                "model_calls": metrics.get("model_calls"),
                "principle_lookup_ms": metrics.get("principle_lookup_ms"),
                "principle_used": metrics.get("principle_used"),
                "principle_id": metrics.get("principle_id"),
                "principle_mode": metrics.get("principle_mode"),
                "fallback_used": metrics.get("fallback_used"),
            }
            turns.append(turn)
            state = result.get("state") or {}

            if len(turns) > 18:
                raise RuntimeError("상담 loop가 18턴 안에 끝나지 않았습니다.")

    first_values = [
        float(turn["server_first_ms"])
        for turn in turns
        if turn["server_first_ms"] is not None
    ]
    total_values = [
        float(turn["total_ms"])
        for turn in turns
        if turn["total_ms"] is not None
    ]
    lookup_values = [
        float(turn["principle_lookup_ms"])
        for turn in turns
        if turn["principle_lookup_ms"] is not None
    ]
    report = {
        "status": "PASS" if not failures else "FAIL",
        "failures": failures,
        "principle_bank": {
            "source": bank.get("source"),
            "version": bank.get("bank_version"),
            "count": bank.get("principle_count"),
        },
        "summary": {
            "loop_turns": len(turns),
            "server_first_p50_ms": round(statistics.median(first_values), 2)
            if first_values
            else None,
            "server_first_p95_ms": _percentile(first_values, 0.95),
            "server_first_max_ms": max(first_values) if first_values else None,
            "total_p50_ms": round(statistics.median(total_values), 2)
            if total_values
            else None,
            "total_p95_ms": _percentile(total_values, 0.95),
            "principle_lookup_p95_ms": _percentile(lookup_values, 0.95),
            "principle_turns": sum(bool(turn["principle_used"]) for turn in turns),
            "fallback_turns": sum(bool(turn["fallback_used"]) for turn in turns),
            "model_calls": sum(int(turn["model_calls"] or 0) for turn in turns),
        },
        "turns": turns,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
