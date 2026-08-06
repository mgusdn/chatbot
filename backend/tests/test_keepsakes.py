from datetime import datetime, timezone
from pathlib import Path

from app.keepsakes import SQLiteKeepsakeStore, build_keepsake_draft


def test_draft_uses_name_closed_phrase_and_exactly_three_safe_hashtags():
    draft = build_keepsake_draft(
        {
            "name": "  구름  ",
            "report": "취업 준비를 하며 다른 사람과 비교하고 내가 늦었다고 느꼈어요.",
            "slots": {"goal": ["내 속도로 방향을 찾고 싶어요."]},
            "selected_values": ["자율성"],
        }
    )

    assert draft["recipient_name"] == "구름"
    assert draft["recipient_label"].endswith("구름에게")
    assert draft["phrase_id"] == "own_pace"
    assert draft["template_id"] == "starry_wish_v1"
    assert draft["sender_label"] == "푸바오가."
    assert len(draft["hashtags"]) == 3
    assert "나만의속도" in draft["hashtags"]


def test_sqlite_keepsake_store_never_returns_token_hash(tmp_path: Path):
    store = SQLiteKeepsakeStore(tmp_path / "keepsakes.sqlite3")
    letter, token = store.create(
        {
            "name": "하루",
            "report": "완벽해야 한다는 생각 때문에 스스로를 자책했어요.",
            "slots": {},
            "selected_values": [],
        }
    )

    loaded = store.get(token)
    assert loaded is not None
    assert loaded["id"] == letter["id"]
    assert loaded["recipient_name"] == "하루"
    assert "share_token_hash" not in loaded
    assert store.get("wrong-token") is None
    assert datetime.fromisoformat(loaded["expires_at"]) > datetime.now(timezone.utc)


def test_five_phrase_profiles_select_their_matching_letter_designs():
    cases = (
        ("요즘 너무 피곤해서 잠과 휴식이 필요해요.", "gentle_rest", "cream_rest_v1"),
        ("완벽하지 못한 나를 자책하고 실망했어요.", "self_growth", "purple_growth_v1"),
        ("취업 목표가 늦어진 것 같아 비교하게 돼요.", "own_pace", "starry_wish_v1"),
        ("실패해도 꾸준히 노력하며 다시 도전하고 싶어요.", "steady_effort", "black_effort_v1"),
        ("사람 관계 때문에 답답하고 스트레스가 커요.", "joyful_release", "red_release_v1"),
    )

    for report, phrase_id, template_id in cases:
        draft = build_keepsake_draft(
            {"name": "하루", "report": report, "slots": {}, "selected_values": []}
        )
        assert draft["phrase_id"] == phrase_id
        assert draft["template_id"] == template_id
        assert draft["recipient_label"].endswith("하루에게")
        assert len(draft["hashtags"]) == 3
