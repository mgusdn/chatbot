from pathlib import Path

from chatbot.session import ChatbotSession
from chatbot.state import SLOT_ORDER


RAPPORT_REPLIES = [
    "안녕하세요.",
    "오늘은 괜찮아요.",
    "편하게 왔어요.",
    "친구에게 소개받았어요.",
]


def _advance_to_loop(session: ChatbotSession) -> None:
    session.start()
    result = session.turn("1, 2, 3, 4, 5")
    assert result.state["stage"] == "rapport"
    for reply in RAPPORT_REPLIES:
        result = session.turn(reply)
    assert result.state["stage"] == "loop"
    assert result.state["pending"]["target_slot"] == "situation"


def test_repository_contains_only_a_series_pipeline():
    assert not Path("chatbot/optimized_nodes.py").exists()
    assert "optimized" not in Path("chatbot/graph.py").read_text(encoding="utf-8")


def test_session_starts_with_value_selection():
    result = ChatbotSession(name="테스터").start()
    assert result.state["stage"] == "values"
    assert "5개" in result.message


def test_value_selection_advances_to_rapport_without_repeating_prompt():
    session = ChatbotSession(name="테스터")
    session.start()

    result = session.turn("1, 2, 3, 4, 5")

    assert result.state["stage"] == "rapport"
    assert "정확히 5개" not in result.message
    assert "테스터님, 만나서 반갑습니다" in result.message


def test_a_series_emits_empathy_before_analysis_continuation():
    session = ChatbotSession()
    _advance_to_loop(session)
    shown: list[dict] = []
    long_answer = (
        "자기소개서를 계속 미루다가 마감 직전에 시작해서 마음이 복잡하고, "
        "지원 일정을 생각할 때마다 해야 할 일들이 한꺼번에 떠올라 어디부터 "
        "손대야 할지 정하지 못한 채 시간을 보내는 일이 최근 계속 반복되고 있어요."
    )
    result = session.turn(long_answer, on_segment=shown.append)

    assert shown
    assert shown[0]["segment"] == "reflection"
    assert shown[0]["text"] == "말씀해 주신 마음이 느껴져요."
    assert {call["task"] for call in result.model_calls} == {
        "baseline_opening",
        "baseline_turn_analysis",
    }
    assert result.message.endswith("그 일로 요즘 어떤 감정이 드시나요?")


def test_mock_session_reaches_report():
    session = ChatbotSession()
    _advance_to_loop(session)

    result = None
    for index, slot in enumerate(SLOT_ORDER[:10]):
        result = session.turn(
            f"{slot}에 관한 충분히 구체적인 {index + 1}번째 답변입니다."
        )
        if result.state["stage"] == "done":
            break

    assert result is not None
    assert result.state["stage"] == "done"
    assert "빙산" in result.message


def test_crisis_message_bypasses_gemini():
    session = ChatbotSession()
    session.start()
    result = session.turn("자해하고 싶다는 생각이 들어요.")

    assert result.safety_bypass is True
    assert result.model_calls == ()
    assert result.state["stage"] == "done"
    assert "긴급" in result.message
