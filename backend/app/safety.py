"""Small deterministic crisis gate shared by both experiment arms.

This is not a clinical classifier.  It only keeps obvious high-risk utterances out
of a model-quality experiment and routes them to the same fixed response so neither
model is allowed to improvise an emergency answer.
"""

from __future__ import annotations

import re


CRISIS_TERMS = (
    "죽고 싶",
    "죽고싶",
    "자살",
    "목숨을 끊",
    "사라지고 싶",
    "나를 해치",
    "자해",
    "해칠 계획",
    "죽일 계획",
)

# High-confidence variants that cannot be represented safely as one bare
# substring.  In particular, ``끝내다`` is ordinary Korean in contexts such as
# "일을 끝내다", so the overdose rule requires both a medication phrase and an
# immediately adjacent self-ending expression.
CRISIS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "살고 싶지 않",
        re.compile(
            r"살고싶지않(?:아(?:요)?|습니다|다|네요|다는(?:생각|마음)|[.!?。！？…]*$)"
        ),
    ),
    (
        "높은 곳에서 뛰어내리고 싶",
        re.compile(
            r"(?:옥상|건물|아파트|다리|절벽|창문)"
            r"(?:에서|밖으로|위에서)?.{0,12}뛰어내리(?:고)?싶"
        ),
    ),
    (
        "약물을 다 먹고 끝내",
        re.compile(
            r"(?:약|수면제|진통제|알약)(?:을|를)?"
            r"(?:다|모두|전부|한꺼번에)(?:먹고|삼키고)"
            r"[,\.。·…]*(?:(?:내)?삶을|생을)?끝내"
        ),
    ),
)

CRISIS_RESPONSE = (
    "지금 말씀은 혼자 감당하기에 매우 위급할 수 있어요. 이 서비스의 일반 상담은 여기서 멈추고, "
    "가능하면 지금 혼자 있지 말고 믿을 수 있는 사람이나 가까운 응급 의료기관·지역 긴급 서비스에 "
    "즉시 도움을 요청해 주세요. 당장 행동할 가능성이 있다면 위험한 물건과 거리를 두고 긴급 도움을 "
    "받는 것이 가장 중요합니다."
)


def detect_crisis(text: str) -> list[str]:
    compact = re.sub(r"\s+", "", text.lower())
    matches = [
        term
        for term in CRISIS_TERMS
        if re.sub(r"\s+", "", term.lower()) in compact
    ]
    matches.extend(
        label for label, pattern in CRISIS_PATTERNS if pattern.search(compact)
    )
    # A phrase may be covered by both a legacy substring and a contextual
    # pattern.  Preserve stable order while returning each reason only once.
    return list(dict.fromkeys(matches))
