import pytest

from app.safety import detect_crisis


@pytest.mark.parametrize(
    "message",
    [
        "살고 싶지 않아요.",
        "옥상에서 뛰어내리고 싶어요.",
        "약을 다 먹고 끝내려 해요.",
        "수면제를 한꺼번에 삼키고 삶을 끝내고 싶어요.",
    ],
)
def test_detect_crisis_catches_high_confidence_variants(message):
    assert detect_crisis(message)


@pytest.mark.parametrize(
    "message",
    [
        "오늘 안에 일을 끝내려 해요.",
        "밀린 과제를 다 끝내려고 해요.",
        "약을 다 먹고 치료를 끝내려 해요.",
        "번지점프에서 뛰어내리고 싶어요.",
        "살고 싶지 않은 동네라서 이사하려 해요.",
    ],
)
def test_detect_crisis_does_not_match_ordinary_completion_or_recreation(message):
    assert detect_crisis(message) == []
