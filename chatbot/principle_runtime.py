"""Process-local principle runtime initialized once during server import."""

from __future__ import annotations

import os
from pathlib import Path

from .principle_retrieval import PrincipleRetriever, RetrievalContext
from .principle_store import (
    DEFAULT_PRINCIPLE_DB_PATH,
    PrincipleSnapshot,
    PrincipleStore,
)


_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _configured_db_path() -> Path:
    configured = os.getenv("PRINCIPLE_DB_PATH")
    if not configured:
        return DEFAULT_PRINCIPLE_DB_PATH
    path = Path(configured)
    return path if path.is_absolute() else _PROJECT_ROOT / path


def _minimum_score() -> float:
    try:
        return max(0.0, float(os.getenv("PRINCIPLE_MIN_SCORE", "2.0")))
    except ValueError:
        return 2.0


PRINCIPLE_STORE = PrincipleStore(_configured_db_path())
PRINCIPLE_SNAPSHOT: PrincipleSnapshot = PRINCIPLE_STORE.initialize()
PRINCIPLE_RETRIEVER = PrincipleRetriever(
    PRINCIPLE_SNAPSHOT,
    minimum_score=_minimum_score(),
)


def retrieve_principle_candidates(
    context: RetrievalContext,
    *,
    limit: int = 3,
):
    """Search the immutable snapshot without opening the database."""

    return PRINCIPLE_RETRIEVER.retrieve(context, limit=limit)


def principle_runtime_status() -> dict:
    """Return non-sensitive configuration for health/debug displays."""

    return {
        "enabled": PRINCIPLE_SNAPSHOT.enabled,
        "bank_version": PRINCIPLE_SNAPSHOT.bank_version,
        "checksum": PRINCIPLE_SNAPSHOT.checksum[:12],
        "source": PRINCIPLE_SNAPSHOT.source,
        "principle_count": len(PRINCIPLE_SNAPSHOT.principles),
        "load_error": bool(PRINCIPLE_SNAPSHOT.load_error),
    }
