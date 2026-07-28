import unicodedata

from counsel.principle_bank import (
    DELIVERY_MODES,
    PRINCIPLE_BANK_DATA,
    PRINCIPLES,
    PRINCIPLES_BY_ID,
    get_principle,
    selectable_references,
)


def test_principle_bank_has_three_modes_and_thirty_unique_principles():
    assert DELIVERY_MODES == {"reference", "named_pattern", "social_context"}
    assert set(PRINCIPLE_BANK_DATA["delivery_modes"]) == DELIVERY_MODES
    assert len(PRINCIPLES) == 30
    assert len(PRINCIPLES_BY_ID) == 30


def test_principle_bank_covers_each_reviewed_reference_exactly_once():
    reference_ids = [
        reference["candidate_id"]
        for principle in PRINCIPLES
        for reference in principle["references"]
    ]
    expected = {
        f"{prefix}{number:02d}"
        for prefix in ("P", "I")
        for number in range(1, 51)
    }

    assert len(reference_ids) == 100
    assert len(set(reference_ids)) == 100
    assert set(reference_ids) == expected


def test_every_principle_has_sourced_named_pattern_and_social_context():
    fabricated_experience_phrases = {
        "저희 애",
        "제가 상담했던",
        "제 내담자",
        "저도 그랬",
    }
    for principle in PRINCIPLES:
        pattern = principle["named_pattern"]
        social = principle["social_context"]

        assert pattern["source_url"].startswith("https://")
        assert pattern["confidence"] in {"high", "medium"}
        assert pattern["utterance"].strip()
        assert social["utterance"].strip()
        assert social["trigger"].strip()
        assert social["avoid_when"].strip()
        combined_utterances = f"{pattern['utterance']} {social['utterance']}"
        assert 20 <= len(pattern["utterance"]) <= 60
        assert 20 <= len(social["utterance"]) <= 60
        assert not any(
            phrase in combined_utterances
            for phrase in fabricated_experience_phrases
        )
        assert "?" not in combined_utterances


def test_every_idiom_reference_contains_exactly_four_hanja_characters():
    idioms = [
        reference
        for principle in PRINCIPLES
        for reference in principle["references"]
        if reference["kind"] == "four_hanja_idiom"
    ]

    assert len(idioms) == 50
    for idiom in idioms:
        hanja = [
            character
            for character in idiom["text"]
            if unicodedata.name(character, "").startswith("CJK UNIFIED IDEOGRAPH")
        ]
        assert len(hanja) == 4, idiom["candidate_id"]


def test_reverse_and_blocked_references_are_never_selectable():
    retry = get_principle("retry_rest_or_redirect")
    assert any(reference["policy"] == "blocked" for reference in retry["references"])
    assert all(
        reference["policy"] == "direct"
        for reference in selectable_references("retry_rest_or_redirect")
    )

    responsibility = get_principle("responsibility_without_self_blame")
    assert selectable_references("responsibility_without_self_blame") == ()
    assert all(
        reference["policy"] == "reverse_only"
        for reference in responsibility["references"]
    )


def test_conditional_references_require_explicit_opt_in():
    direct_only = selectable_references("hope_without_guarantee")
    with_conditional = selectable_references(
        "hope_without_guarantee",
        include_conditional=True,
    )

    assert direct_only == ()
    assert len(with_conditional) == 3
    assert all(reference["policy"] == "conditional" for reference in with_conditional)
