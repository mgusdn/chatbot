"""Interactive CLI to exercise the counseling pipeline turn by turn.

Run from repo root: `python -m counsel.cli [--debug]`
"""
import argparse
from uuid import uuid4

from .debug import set_debug
from .graph import get_graph
from .state import new_session


def _print_debug(state: dict) -> None:
    filled = [slot for slot, values in state["slots"].items() if values]
    print(
        f"  [stage={state['stage']} rapport_step={state['rapport_step']} "
        f"turn_count={state['turn_count']} "
        f"filled={filled} switches={state['slot_switches']} gate={state['gate']}]"
    )
    print(f"  [pending(target_slot/question_intent)={state.get('pending')}]")
    print(f"  [asked_slots={state.get('asked_slots')} retry_count={state.get('retry_count')}]")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    parser.add_argument(
        "--arm", choices=("baseline", "optimized"), default="optimized"
    )
    parser.add_argument("--name", default="사용자")
    args = parser.parse_args()
    set_debug(args.debug)

    graph = get_graph(args.arm)
    state = new_session(args.arm, f"cli-{uuid4().hex[:10]}", name=args.name.strip() or "사용자")

    print("[상담을 시작합니다 - 종료하려면 'quit' 입력]\n")
    state = graph.invoke(state)
    print(f"상담사: {state['bot_message']}\n")
    if args.debug:
        _print_debug(state)

    while state["stage"] != "done":
        try:
            user_input = input("나: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if user_input.lower() in ("quit", "exit"):
            break

        state["user_input"] = user_input
        state = graph.invoke(state)
        print(f"\n상담사: {state['bot_message']}\n")
        if args.debug:
            _print_debug(state)

    if state["stage"] == "done":
        print("[상담이 마무리되었습니다. 대화를 종료합니다]")


if __name__ == "__main__":
    main()
