"""Interactive terminal client for the A-series counselor."""

from __future__ import annotations

import argparse
import os
import sys

from .debug import set_debug
from .llm import provider_status
from .session import ChatbotRuntimeError, ChatbotSession, TurnResult


def _print_debug(result: TurnResult) -> None:
    state = result.state
    filled = [slot for slot, values in state["slots"].items() if values]
    print(
        "  [debug] "
        f"stage={state['stage']} pending={(state.get('pending') or {}).get('target_slot')} "
        f"filled={filled} model_calls={len(result.model_calls)}"
    )
    for call in result.model_calls:
        print(
            "  [model] "
            f"task={call.get('task')} route={call.get('api_route')} "
            f"thinking={call.get('thinking_level')} duration_ms={call.get('duration_ms')} "
            f"success={call.get('success')}"
        )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="프메의 숲 A-series 상담 챗봇을 터미널에서 실행합니다."
    )
    parser.add_argument("--name", default="사용자", help="상담에서 부를 이름")
    parser.add_argument("--debug", action="store_true", help="노드와 모델 호출 정보 출력")
    parser.add_argument("--mock", action="store_true", help="Gemini 없이 로컬 모의 응답 사용")
    parser.add_argument(
        "--no-stream",
        action="store_true",
        help="공감 선출력 없이 완성된 답변을 한 번에 출력",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="시작할 때 Gemini endpoint 연결까지 확인",
    )
    return parser


def run(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.mock:
        os.environ["CHATBOT_MOCK_MODE"] = "true"
    set_debug(args.debug)

    status = provider_status(probe=args.probe)["gemini"]
    if not status["configured"]:
        print(
            "Gemini 설정이 없습니다. .env에 GEMINI_API_KEY를 입력하거나 "
            "Vertex ADC를 설정하세요. 기능 확인만 하려면 --mock을 사용하세요.",
            file=sys.stderr,
        )
        return 2
    if args.probe and status.get("connected") is False:
        print(f"Gemini 연결 실패: {status.get('error')}", file=sys.stderr)
        return 2

    session = ChatbotSession(name=args.name)
    initial = session.start()
    print("[프메의 숲 상담을 시작합니다. 종료: quit]\n")
    print(f"프바오: {initial.message}\n")
    if args.debug:
        _print_debug(initial)

    while session.state["stage"] != "done":
        try:
            user_input = input("나: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if user_input.lower() in {"quit", "exit", "종료"}:
            break
        if not user_input:
            continue

        line_open = False

        def show_segment(event: dict) -> None:
            nonlocal line_open
            if args.no_stream:
                return
            if not line_open:
                print("\n프바오: ", end="", flush=True)
                line_open = True
            print(f"{event['text']} ", end="", flush=True)

        try:
            result = session.turn(user_input, on_segment=show_segment)
        except (ChatbotRuntimeError, ValueError) as exc:
            if line_open:
                print()
            print(f"\n[응답 오류] {exc}\n", file=sys.stderr)
            continue

        if args.no_stream or not result.segments:
            print(f"\n프바오: {result.message}\n")
        else:
            if result.continuation:
                print(result.continuation, end="")
            print("\n")
        if args.debug:
            _print_debug(result)

    print("[상담을 종료합니다]")
    return 0


def main() -> None:
    raise SystemExit(run())
