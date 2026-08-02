"""Fast, deterministic retrieval over an in-memory principle snapshot."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Collection, Mapping, Sequence

from .principle_store import PrincipleSnapshot


_SPACE_RE = re.compile(r"\s+")
_NON_WORD_RE = re.compile(r"[^0-9a-z가-힣 ]+")
_LOW_INFORMATION_RE = re.compile(
    r"^(?:음+|어+|아+|글쎄|그냥|네|예|응|아니요?|잘\s*모르겠(?:어|어요)?|"
    r"모르겠(?:어|어요)?|생각\s*안\s*나(?:요)?)$"
)


def _normalize(text: str) -> str:
    lowered = str(text or "").lower()
    cleaned = _NON_WORD_RE.sub(" ", lowered)
    return _SPACE_RE.sub(" ", cleaned).strip()


def _is_low_information(text: str) -> bool:
    normalized = _normalize(text)
    if not normalized:
        return True
    if _LOW_INFORMATION_RE.fullmatch(normalized):
        return True
    return len(normalized) <= 18 and "모르겠" in normalized


def _slot_text(values: Mapping[str, Sequence[str] | str]) -> str:
    parts: list[str] = []
    for value in values.values():
        if isinstance(value, str):
            parts.append(value)
        else:
            parts.extend(str(item) for item in value)
    return _normalize(" ".join(parts))


@dataclass(frozen=True, slots=True)
class RetrievalContext:
    """Minimal context for local retrieval; all fields are already in memory."""

    user_text: str
    current_slot: str | None = None
    recent_user_texts: Sequence[str] = ()
    slot_values: Mapping[str, Sequence[str] | str] = field(
        default_factory=lambda: MappingProxyType({})
    )
    blocked_contexts: Collection[str] = frozenset()
    recent_principle_ids: Sequence[str] = ()
    allow_reference: bool = False


@dataclass(frozen=True, slots=True)
class PrincipleCandidate:
    """One ranked principle candidate for the existing judgment call."""

    principle_id: str
    score: float
    matched_terms: tuple[str, ...]
    available_modes: tuple[str, ...]
    principle: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class _IndexedPrinciple:
    order: int
    principle: Mapping[str, object]
    normalized_terms: tuple[tuple[str, str], ...]
    slots: frozenset[str]


class PrincipleRetriever:
    """Pre-index 30 principles once, then rank them without network or DB I/O."""

    def __init__(
        self,
        snapshot: PrincipleSnapshot,
        *,
        minimum_score: float = 2.0,
    ) -> None:
        self.snapshot = snapshot
        self.minimum_score = minimum_score
        indexed: list[_IndexedPrinciple] = []
        for order, principle in enumerate(snapshot.principles):
            retrieval = principle["retrieval"]
            terms = tuple(
                (str(term), _normalize(str(term)))
                for term in retrieval["terms"]
                if _normalize(str(term))
            )
            indexed.append(
                _IndexedPrinciple(
                    order=order,
                    principle=principle,
                    normalized_terms=terms,
                    slots=frozenset(str(slot) for slot in retrieval["slots"]),
                )
            )
        self._index = tuple(indexed)

    def retrieve(
        self,
        context: RetrievalContext,
        *,
        limit: int = 3,
    ) -> tuple[PrincipleCandidate, ...]:
        """Return up to ``limit`` candidates using only the frozen local index."""

        if not self.snapshot.enabled or limit <= 0:
            return ()
        if set(context.blocked_contexts) & self.snapshot.global_blocked_contexts:
            return ()
        if _is_low_information(context.user_text):
            return ()

        current = _normalize(context.user_text)
        recent = tuple(
            normalized
            for text in context.recent_user_texts[-2:]
            if (normalized := _normalize(text))
        )
        memory = _slot_text(context.slot_values)
        cooldown = set(context.recent_principle_ids)
        ranked: list[tuple[float, float, int, PrincipleCandidate]] = []

        for indexed in self._index:
            principle_id = str(indexed.principle["id"])
            if principle_id in cooldown:
                continue

            score = 0.0
            current_matches = 0
            matched: list[str] = []
            for original_term, term in indexed.normalized_terms:
                weight = 0.0
                if term in current:
                    # Longer phrases are more discriminating than generic words.
                    weight += 3.0 + min(len(term), 10) * 0.12
                    current_matches += 1
                if any(term in previous for previous in recent):
                    weight += 1.0
                if memory and term in memory:
                    weight += 0.45
                if weight:
                    score += weight
                    matched.append(original_term)

            # Slot is a tie-breaker, never enough to produce a candidate alone.
            if matched and context.current_slot in indexed.slots:
                score += 0.55

            if not matched or score < self.minimum_score:
                continue

            modes = ["named_pattern", "social_context"]
            if context.allow_reference and any(
                reference["policy"] == "direct"
                for reference in indexed.principle["references"]
            ):
                modes.append("reference")
            candidate = PrincipleCandidate(
                principle_id=principle_id,
                score=round(score, 3),
                matched_terms=tuple(dict.fromkeys(matched)),
                available_modes=tuple(modes),
                principle=indexed.principle,
            )
            # Prefer current-turn evidence, then weighted score, then bank order.
            ranked.append((float(current_matches), score, indexed.order, candidate))

        ranked.sort(
            key=lambda item: (
                -item[0],
                -item[1],
                item[2],
            )
        )
        return tuple(item[3] for item in ranked[:limit])


def retrieve_principles(
    snapshot: PrincipleSnapshot,
    context: RetrievalContext,
    *,
    limit: int = 3,
    minimum_score: float = 2.0,
) -> tuple[PrincipleCandidate, ...]:
    """Convenience API; prefer reusing ``PrincipleRetriever`` on hot paths."""

    return PrincipleRetriever(snapshot, minimum_score=minimum_score).retrieve(
        context,
        limit=limit,
    )
