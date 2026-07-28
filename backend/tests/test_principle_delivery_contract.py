import json
import math
import re
import socket
import sqlite3
import time
from pathlib import Path

import pytest

from counsel import baseline_nodes
from counsel.baseline_nodes import (
    _blocked_principle_contexts,
    _prepare_early_principle,
)
from counsel.principle_bank import PRINCIPLE_BANK_DATA
from counsel.principle_retrieval import PrincipleRetriever, RetrievalContext
from counsel.principle_store import build_principle_snapshot


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "principle_scenarios.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
SCENARIOS = tuple(FIXTURE["scenarios"])


def _fail_external_io(*args, **kwargs):
    raise AssertionError("principle delivery contract must not use external I/O")


@pytest.fixture(autouse=True)
def local_only_contract(monkeypatch):
    monkeypatch.setenv("BASELINE_PRINCIPLE_MODE", "on")
    monkeypatch.setenv("BASELINE_PRINCIPLE_REFERENCE_ENABLED", "false")
    monkeypatch.setenv("PRINCIPLE_EARLY_MIN_SCORE", "4.5")
    monkeypatch.setattr(sqlite3, "connect", _fail_external_io)
    monkeypatch.setattr(socket, "create_connection", _fail_external_io)
    monkeypatch.setattr(baseline_nodes, "call_model_json", _fail_external_io)


@pytest.fixture(scope="module")
def snapshot():
    return build_principle_snapshot(PRINCIPLE_BANK_DATA, source="contract_test")


@pytest.fixture(scope="module")
def retriever(snapshot):
    return PrincipleRetriever(snapshot)


def _retrieval_context(scenario):
    return RetrievalContext(
        user_text=scenario["user_utterance"],
        current_slot=scenario["target_slot"],
        recent_user_texts=tuple(scenario["recent_user_utterances"]),
        blocked_contexts=_blocked_principle_contexts(
            scenario["user_utterance"]
        ),
        recent_principle_ids=tuple(scenario["recent_principle_ids"]),
        allow_reference=False,
    )


def _retrieve_and_prepare(retriever, scenario):
    candidates = retriever.retrieve(
        _retrieval_context(scenario),
        limit=FIXTURE["runtime_contract"]["retrieval_candidate_limit"],
    )
    line, metadata = _prepare_early_principle(
        state={
            "recent_principle_ids": list(scenario["recent_principle_ids"]),
        },
        current_turn=1,
        current_slot=scenario["target_slot"],
        user_utterance=scenario["user_utterance"],
        principle_candidates=candidates,
    )
    return candidates, line, metadata


def _normalized_characters(text):
    return re.sub(r"[^0-9A-Za-z가-힣]", "", text)


def _character_ngrams(text, size=4):
    normalized = _normalized_characters(text)
    return {
        normalized[index : index + size]
        for index in range(max(0, len(normalized) - size + 1))
    }


def _ngram_jaccard(left, right):
    left_grams = _character_ngrams(left)
    right_grams = _character_ngrams(right)
    union = left_grams | right_grams
    return len(left_grams & right_grams) / len(union) if union else 0.0


def _longest_common_substring_length(left, right):
    left = _normalized_characters(left)
    right = _normalized_characters(right)
    previous = [0] * (len(right) + 1)
    longest = 0
    for left_character in left:
        current = [0]
        for index, right_character in enumerate(right, start=1):
            length = (
                previous[index - 1] + 1
                if left_character == right_character
                else 0
            )
            current.append(length)
            longest = max(longest, length)
        previous = current
    return longest


def _assert_tone_contract(line, scenario, selected_principle):
    contract = FIXTURE["automatic_validation"]
    aside_contract = contract["aside_segment"]

    assert aside_contract["character_length_min"] <= len(line)
    assert len(line) <= aside_contract["character_length_max"]
    assert len(re.findall(r"[.!?。！？]+", line)) == aside_contract["sentence_count"]
    assert "?" not in line
    assert "？" not in line
    assert not re.search(
        aside_contract["interrogative_ending_regex_forbidden"],
        line,
    )
    assert not line.lstrip().startswith(
        tuple(aside_contract["question_lead_tokens_forbidden_at_start"])
    )
    assert not any(
        ending in line
        for ending in aside_contract["advice_or_command_endings_forbidden"]
    )
    assert (
        sum(line.count(marker) for marker in aside_contract["lecture_markers"])
        <= aside_contract["lecture_markers_max"]
    )
    assert not any(
        marker.lower() in line.lower()
        for marker in aside_contract["citation_markers_forbidden"]
    )

    for phrases in contract["forbidden_phrase_groups"].values():
        assert not any(phrase in line for phrase in phrases)

    named_pattern = selected_principle["named_pattern"]
    assert (
        line.count(str(named_pattern["name_ko"]))
        <= aside_contract["named_term_mentions_max"]
    )

    empathy = scenario["opening_empathy"]
    if empathy:
        repetition = contract["empathy_repetition"]
        assert line != empathy
        assert (
            _ngram_jaccard(line, empathy)
            <= repetition["normalized_character_4gram_jaccard_max"]
        )
        assert (
            _longest_common_substring_length(line, empathy)
            <= repetition["longest_common_substring_characters_max"]
        )


@pytest.mark.parametrize(
    "scenario",
    SCENARIOS,
    ids=[scenario["id"] for scenario in SCENARIOS],
)
def test_fixed_scenario_retrieval_selection_safety_and_assembly(
    retriever,
    snapshot,
    scenario,
):
    candidates, line, metadata = _retrieve_and_prepare(retriever, scenario)
    candidate_limit = FIXTURE["runtime_contract"]["retrieval_candidate_limit"]

    assert len(candidates) <= candidate_limit
    assert all(
        candidate.principle_id in snapshot.principles_by_id
        for candidate in candidates
    )
    assert all("reference" not in candidate.available_modes for candidate in candidates)
    assert all(
        candidate.principle_id not in scenario["recent_principle_ids"]
        for candidate in candidates
    )

    if scenario["action"] == "skip":
        assert line == ""
        assert metadata["principle_used"] is False
        assert metadata["principle_mode"] == "none"
        assert scenario["expected"]["aside_text"] == ""
        if scenario.get("risk_tags"):
            blocked = _blocked_principle_contexts(scenario["user_utterance"])
            assert blocked
            assert blocked & snapshot.global_blocked_contexts
            assert candidates == ()
    else:
        expected = scenario["expected"]
        expected_ids = set(expected["candidate_ids_any_of"])
        returned_ids = {candidate.principle_id for candidate in candidates}

        assert candidates
        assert returned_ids & expected_ids
        assert candidates[0].principle_id in expected_ids
        assert metadata["principle_selected"] is True
        assert metadata["principle_id"] in expected_ids
        assert metadata["principle_mode"] in expected["allowed_modes"]
        assert metadata["principle_mode"] in {
            "named_pattern",
            "social_context",
        }
        assert metadata["principle_skip_reason"] == "pending_delivery"
        assert line

        selected = snapshot.get(metadata["principle_id"])
        assert selected is not None
        expected_line = str(
            selected[metadata["principle_mode"]]["utterance"]
        ).strip()
        assert line == expected_line
        _assert_tone_contract(line, scenario, selected)

    parts = [
        scenario["opening_empathy"],
        line,
        scenario["next_question"],
    ]
    assembled = " ".join(part for part in parts if part).strip()
    expected_parts = (
        parts
        if scenario["action"] == "use"
        else [scenario["opening_empathy"], scenario["next_question"]]
    )
    expected_message = " ".join(
        part for part in expected_parts if part
    ).strip()
    assert assembled == expected_message

    for segment in expected_parts:
        if segment:
            assert assembled.count(segment) == 1
    if scenario["next_question"]:
        assert scenario["next_question"] not in line


def test_contract_exercises_both_reviewed_database_delivery_modes(retriever):
    modes = {
        metadata["principle_mode"]
        for scenario in SCENARIOS
        if scenario["action"] == "use"
        for _, line, metadata in [_retrieve_and_prepare(retriever, scenario)]
        if line
    }
    assert modes == {"named_pattern", "social_context"}


@pytest.mark.parametrize(
    "ordinary_text",
    (
        "지원 회사별 체크리스트를 만들었어요.",
        "회사별 마감 일정이 다 달라요.",
        "부서별 역할을 다시 정리했어요.",
    ),
)
def test_bereavement_guard_does_not_match_korean_suffix_inside_other_words(
    ordinary_text,
):
    assert "bereavement" not in _blocked_principle_contexts(ordinary_text)


@pytest.mark.parametrize(
    "bereavement_text",
    (
        "배우자와 사별한 뒤 마음이 무너졌어요.",
        "가족과 사별 후 혼자 지내고 있어요.",
        "부모님과 사별했어요.",
    ),
)
def test_bereavement_guard_keeps_real_noun_and_conjugation_matches(
    bereavement_text,
):
    assert "bereavement" in _blocked_principle_contexts(bereavement_text)


def _percentile(values, percentile):
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * percentile) - 1)
    return ordered[index]


def test_all_scenarios_stay_inside_local_retrieval_and_render_p95_budget(
    retriever,
):
    retrieval_samples = []
    render_samples = []

    for _ in range(25):
        for scenario in SCENARIOS:
            started = time.perf_counter()
            candidates = retriever.retrieve(
                _retrieval_context(scenario),
                limit=FIXTURE["runtime_contract"]["retrieval_candidate_limit"],
            )
            retrieval_samples.append((time.perf_counter() - started) * 1000)

            started = time.perf_counter()
            _prepare_early_principle(
                state={
                    "recent_principle_ids": list(
                        scenario["recent_principle_ids"]
                    )
                },
                current_turn=1,
                current_slot=scenario["target_slot"],
                user_utterance=scenario["user_utterance"],
                principle_candidates=candidates,
            )
            render_samples.append((time.perf_counter() - started) * 1000)

    assert _percentile(retrieval_samples, 0.95) <= FIXTURE[
        "runtime_contract"
    ]["memory_retrieval_p95_ms_max"]
    assert _percentile(render_samples, 0.95) <= FIXTURE[
        "runtime_contract"
    ]["render_p95_ms_max"]
