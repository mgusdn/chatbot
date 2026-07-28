"""Load and validate the principle-first counseling explanation bank."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any


BANK_PATH = Path(__file__).resolve().parent / "principle_bank.json"
REFERENCE_POLICIES = {"direct", "conditional", "reverse_only", "blocked"}
DELIVERY_MODES = {"reference", "named_pattern", "social_context"}
_REFERENCE_ID = re.compile(r"^(P|I)(0[1-9]|[1-4][0-9]|50)$")


def _expected_reference_ids() -> set[str]:
    return {
        f"{prefix}{number:02d}"
        for prefix in ("P", "I")
        for number in range(1, 51)
    }


def validate_principle_bank(data: dict[str, Any]) -> dict[str, Any]:
    """Validate a bank payload and return a detached mutable copy.

    Store-backed payloads use the same validation path as the bundled JSON seed,
    so a malformed database version can never become the in-process snapshot.
    """

    if not isinstance(data, dict):
        raise ValueError("principle bank payload must be an object")
    data = copy.deepcopy(data)
    if not str(data.get("schema_version") or "").strip():
        raise ValueError("principle bank requires a schema_version")
    if not str(data.get("bank_version") or "").strip():
        raise ValueError("principle bank requires a bank_version")
    if set(data.get("delivery_modes") or []) != DELIVERY_MODES:
        raise ValueError("principle bank delivery modes are incomplete")

    principles = data.get("principles")
    if not isinstance(principles, list) or len(principles) != 30:
        raise ValueError("principle bank must contain exactly 30 principles")

    principle_ids: list[str] = []
    reference_ids: list[str] = []
    for principle in principles:
        principle_id = principle.get("id")
        if not isinstance(principle_id, str) or not principle_id:
            raise ValueError("every principle requires a stable id")
        principle_ids.append(principle_id)

        if not str(principle.get("principle") or "").strip():
            raise ValueError(f"{principle_id} is missing its principle")

        retrieval = principle.get("retrieval")
        if not isinstance(retrieval, dict):
            raise ValueError(f"{principle_id} is missing retrieval metadata")
        terms = retrieval.get("terms")
        slots = retrieval.get("slots")
        if (
            not isinstance(terms, list)
            or not terms
            or any(not isinstance(term, str) or not term.strip() for term in terms)
        ):
            raise ValueError(f"{principle_id} requires non-empty retrieval terms")
        if (
            not isinstance(slots, list)
            or any(not isinstance(slot, str) or not slot.strip() for slot in slots)
        ):
            raise ValueError(f"{principle_id} has invalid retrieval slots")

        references = principle.get("references")
        if not isinstance(references, list) or not references:
            raise ValueError(f"{principle_id} requires at least one reference")
        for reference in references:
            reference_id = str(reference.get("candidate_id") or "")
            if not _REFERENCE_ID.fullmatch(reference_id):
                raise ValueError(f"invalid reference id: {reference_id}")
            expected_kind = "proverb" if reference_id.startswith("P") else "four_hanja_idiom"
            if reference.get("kind") != expected_kind:
                raise ValueError(f"{reference_id} has the wrong reference kind")
            if reference.get("policy") not in REFERENCE_POLICIES:
                raise ValueError(f"{reference_id} has an invalid delivery policy")
            if not str(reference.get("text") or "").strip():
                raise ValueError(f"{reference_id} is missing text")
            reference_ids.append(reference_id)

        named_pattern = principle.get("named_pattern")
        required_pattern_fields = {
            "name_ko",
            "name_en",
            "explanation",
            "utterance",
            "source_url",
            "confidence",
        }
        if not isinstance(named_pattern, dict) or not required_pattern_fields.issubset(
            named_pattern
        ):
            raise ValueError(f"{principle_id} has an incomplete named_pattern")
        if not str(named_pattern["source_url"]).startswith("https://"):
            raise ValueError(f"{principle_id} named_pattern requires an HTTPS source")
        if named_pattern["confidence"] not in {"high", "medium"}:
            raise ValueError(f"{principle_id} has an unsupported confidence level")

        social_context = principle.get("social_context")
        required_social_fields = {"utterance", "trigger", "avoid_when"}
        if not isinstance(social_context, dict) or not required_social_fields.issubset(
            social_context
        ):
            raise ValueError(f"{principle_id} has an incomplete social_context")

    if len(principle_ids) != len(set(principle_ids)):
        raise ValueError("principle ids must be unique")
    if len(reference_ids) != len(set(reference_ids)):
        raise ValueError("reference candidates must belong to exactly one principle")
    if set(reference_ids) != _expected_reference_ids():
        raise ValueError("principle bank must cover P01-P50 and I01-I50 exactly once")

    return data


def load_principle_bank(path: Path | str = BANK_PATH) -> dict[str, Any]:
    """Load and validate a principle bank from a JSON file."""

    with Path(path).open(encoding="utf-8") as bank_file:
        raw = json.load(bank_file)
    return validate_principle_bank(raw)


def _load_and_validate() -> dict[str, Any]:
    """Backward-compatible loader for callers that relied on the old helper."""

    return load_principle_bank(BANK_PATH)


PRINCIPLE_BANK_DATA = load_principle_bank()
PRINCIPLES: tuple[dict[str, Any], ...] = tuple(PRINCIPLE_BANK_DATA["principles"])
PRINCIPLES_BY_ID: dict[str, dict[str, Any]] = {
    principle["id"]: principle for principle in PRINCIPLES
}


def get_principle(principle_id: str) -> dict[str, Any]:
    """Return one principle record by its stable id."""

    return PRINCIPLES_BY_ID[principle_id]


def selectable_references(
    principle_id: str,
    *,
    include_conditional: bool = False,
) -> tuple[dict[str, Any], ...]:
    """Return references that may be rendered, excluding reverse-only and blocked items."""

    allowed = {"direct"}
    if include_conditional:
        allowed.add("conditional")
    return tuple(
        reference
        for reference in get_principle(principle_id)["references"]
        if reference["policy"] in allowed
    )
