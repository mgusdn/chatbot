from time import perf_counter

import pytest

from counsel.principle_bank import PRINCIPLE_BANK_DATA
from counsel.principle_retrieval import (
    PrincipleRetriever,
    RetrievalContext,
    retrieve_principles,
)
from counsel.principle_store import build_principle_snapshot


@pytest.fixture(scope="module")
def snapshot():
    return build_principle_snapshot(PRINCIPLE_BANK_DATA, source="test")


@pytest.fixture(scope="module")
def retriever(snapshot):
    return PrincipleRetriever(snapshot)


@pytest.mark.parametrize(
    ("text", "slot", "expected"),
    [
        (
            "캘린더 알람도 맞춰보고 스터디 그룹도 들어가 봤는데 소용없었어요",
            "coping",
            "adapt_method_keep_value",
        ),
        (
            "스스로한테 화도 나고 저는 정말 게으른 사람 같아요",
            "thought",
            "mistake_not_identity",
        ),
        (
            "이번에도 결국 서류를 못 낼 것 같아요",
            "thought",
            "uncertainty_not_final",
        ),
        (
            "두 달 정도 됐고 거의 매번 그래요",
            "duration",
            "cumulative_load_matters",
        ),
        (
            "자소서 항목도 헷갈리고 마감 일정도 자주 깜빡해요",
            "behavior",
            "organize_information_roles",
        ),
    ],
)
def test_expected_principle_is_ranked_first(retriever, text, slot, expected):
    candidates = retriever.retrieve(
        RetrievalContext(user_text=text, current_slot=slot)
    )

    assert candidates
    assert candidates[0].principle_id == expected
    assert candidates[0].matched_terms
    assert candidates[0].available_modes == ("named_pattern", "social_context")


def test_low_information_unknown_answer_skips_explanation(retriever):
    assert retriever.retrieve(
        RetrievalContext(user_text="음…잘 모르겠어요", current_slot="cause")
    ) == ()


def test_global_blocked_context_skips_all_principles(retriever):
    candidates = retriever.retrieve(
        RetrievalContext(
            user_text="계속 실패해서 다 끝난 것 같아요",
            current_slot="thought",
            blocked_contexts={"self_harm_or_suicide"},
        )
    )
    assert candidates == ()


def test_recent_principle_cooldown_prevents_repetition(retriever):
    candidates = retriever.retrieve(
        RetrievalContext(
            user_text="알람도 스터디도 소용없어서 다른 방법을 찾고 있어요",
            current_slot="coping",
            recent_principle_ids=("adapt_method_keep_value",),
        )
    )
    assert all(
        candidate.principle_id != "adapt_method_keep_value"
        for candidate in candidates
    )


def test_job_application_word_does_not_trigger_support_network(retriever):
    candidates = retriever.retrieve(
        RetrievalContext(
            user_text="주변 사람들과 지원 이야기를 꺼내는 것도 피하게 돼요",
            current_slot="relationship",
            recent_user_texts=("지원한 곳 중 절반은 마감을 놓쳤어요",),
        )
    )

    assert all(
        candidate.principle_id != "accessible_support_network"
        for candidate in candidates
    )


def test_reference_mode_requires_explicit_opt_in(retriever):
    default = retriever.retrieve(
        RetrievalContext(user_text="자꾸 실수해서 제가 무능한 것 같아요")
    )[0]
    allowed = retriever.retrieve(
        RetrievalContext(
            user_text="자꾸 실수해서 제가 무능한 것 같아요",
            allow_reference=True,
        )
    )[0]

    assert "reference" not in default.available_modes
    assert "reference" in allowed.available_modes


def test_retrieval_uses_no_database_and_stays_well_below_turn_budget(
    monkeypatch,
    snapshot,
):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("hot-path retrieval must never open SQLite")

    monkeypatch.setattr("sqlite3.connect", fail_if_called)
    retriever = PrincipleRetriever(snapshot)
    context = RetrievalContext(
        user_text="알람과 스터디도 소용없어서 다른 방법을 찾고 있어요",
        current_slot="coping",
    )

    started = perf_counter()
    for _ in range(500):
        assert retriever.retrieve(context)
    average_ms = (perf_counter() - started) * 1000 / 500

    assert average_ms < 5


def test_convenience_api_returns_at_most_requested_limit(snapshot):
    candidates = retrieve_principles(
        snapshot,
        RetrievalContext(
            user_text="계속 비교하고 자책하면서 지치고 부담스러워요",
            current_slot="emotion",
        ),
        limit=2,
    )
    assert 0 < len(candidates) <= 2
