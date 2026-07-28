#!/usr/bin/env python3
"""Run one Gemini pipeline through rapport, 11 slots, values, and report.

Synthetic inputs and model responses are never printed. The report contains only
provider IDs, public state, and aggregate task telemetry.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import httpx

from smoke_live import _request_json, _safe_error, _validate_result


RAPPORT_MESSAGES = [
    "안녕하세요.",
    "오늘은 조금 긴장되지만 괜찮아요.",
    "편하게 찾아왔어요.",
    "친구에게 소개받았어요.",
]
SLOT_ANSWERS = {
    "situation": "최근 팀 프로젝트에서 맡은 발표 자료가 계속 늦어져 팀원들에게 미안함을 느끼고 있습니다.",
    "emotion": "그럴 때 불안하고 답답하며 많이 지칩니다.",
    "thought": "나는 일을 제대로 해내지 못하고 결국 팀에 피해를 줄 것 같다는 생각이 듭니다.",
    "cause": "기대에 못 미치면 실망시킬 것 같다는 부담 때문에 그런 감정과 생각이 드는 것 같습니다.",
    "behavior": "자료를 열어보다가 부담을 느껴 다른 영상만 보며 계속 미루게 됩니다.",
    "duration": "약 두 달 전부터 일주일에 서너 번 정도 반복됩니다.",
    "impact": "잠드는 시간이 늦어지고 수업에 집중하기 어려우며 팀원과 연락도 피하게 됩니다.",
    "relationship": "팀원들과 연락을 피하면서 관계가 멀어질까 걱정됩니다.",
    "coping": "일정을 작게 나눠 적고 친구와 함께 작업해 봤지만 며칠만 도움이 됐습니다.",
    "goal": "과제를 미루지 않고 정한 시간에 조금씩 진행하며 편안하게 잠들고 싶습니다.",
    "self_message": "지금까지 버틴 것만으로도 잘했고 작은 한 걸음부터 시작해도 된다고 말하고 싶습니다.",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="실제 모델의 전체 상담 세션을 redacted 검증합니다.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--arm", choices=("baseline", "optimized"), required=True)
    parser.add_argument("--timeout", type=float, default=240.0)
    parser.add_argument("--max-turns", type=int, default=24)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    arm = args.arm
    reports: list[dict[str, Any]] = []
    comparison_ids: list[str] = []

    try:
        with httpx.Client(base_url=args.base_url.rstrip("/"), timeout=args.timeout) as client:
            health = _request_json(client.get("/api/health", params={"probe": "true"}))
            providers = health.get("providers") or {}
            if (providers.get("mock_mode") or {}).get("enabled"):
                raise RuntimeError("AB_MOCK_MODE가 활성화되어 있습니다.")
            provider = providers.get("gemini") or {}
            if not provider.get("configured") or provider.get("connected") is not True:
                raise RuntimeError(f"{arm}: provider가 준비되지 않았습니다: {_safe_error(provider.get('error'))}")

            experiment = _request_json(
                client.post("/api/experiments", json={"name": "검증용"})
            )
            experiment_id = experiment.get("experiment_id")
            state = (experiment.get("states") or {}).get(arm) or {}

            def send(message: str) -> None:
                nonlocal state
                turn = _request_json(
                    client.post(
                        f"/api/experiments/{experiment_id}/turns",
                        json={"message": message, "arms": [arm]},
                    )
                )
                comparison_id = str(turn.get("comparison_id") or "")
                if not comparison_id:
                    raise RuntimeError("comparison_id를 받지 못했습니다.")
                comparison_ids.append(comparison_id)
                raw_result = (turn.get("results") or {}).get(arm) or {}
                reports.append(
                    _validate_result(
                        arm,
                        raw_result,
                        comparison_id,
                        allow_fallback=True,
                    )
                )
                state = raw_result.get("state") or {}

            for message in RAPPORT_MESSAGES:
                send(message)

            while state.get("stage") != "done" and len(reports) < args.max_turns:
                if state.get("stage") == "values":
                    send("1, 2, 3, 4, 5")
                else:
                    pending = state.get("pending_slot")
                    if pending not in SLOT_ANSWERS:
                        raise RuntimeError(f"예상하지 못한 pending_slot: {pending!r}")
                    send(SLOT_ANSWERS[pending])

            if state.get("stage") != "done":
                raise RuntimeError(f"{args.max_turns}턴 안에 상담이 종료되지 않았습니다.")
            if set(state.get("filled_slots") or []) != set(SLOT_ANSWERS):
                raise RuntimeError("11개 슬롯이 모두 채워지지 않았습니다.")
            if not (state.get("gate") or {}).get("coverage_ok"):
                raise RuntimeError("최종 gate가 coverage_ok가 아닙니다.")
            tasks = [task for report in reports for task in report["tasks"]]
            task_names = {task.get("task") for task in tasks}
            required_final_tasks = {"consolidate_slots", "insight_report"}
            if not required_final_tasks <= task_names:
                raise RuntimeError(
                    f"최종 task가 누락되었습니다: {sorted(required_final_tasks - task_names)}"
                )

            result = {
                "status": "PASS",
                "mock_mode": False,
                "provider": {
                    "arm": arm,
                    "model": provider.get("resolved_model") or provider.get("model"),
                },
                "turns": len(reports),
                "model_calls": sum(int(report["model_calls"] or 0) for report in reports),
                "retries": sum(int(report["retries"] or 0) for report in reports),
                "failed_calls": sum(
                    int(report.get("failed_calls") or 0) for report in reports
                ),
                "fallback_turns": sum(
                    bool(report.get("fallback_used")) for report in reports
                ),
                "tasks": sorted(task_names),
                "final_state": {
                    "stage": state.get("stage"),
                    "filled_slot_count": len(state.get("filled_slots") or []),
                    "coverage_ok": (state.get("gate") or {}).get("coverage_ok"),
                },
                "comparison_id_count": len(comparison_ids),
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
    except Exception as exc:
        print(
            json.dumps({"status": "FAIL", "error": _safe_error(exc)}, ensure_ascii=False, indent=2),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
