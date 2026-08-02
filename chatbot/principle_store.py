"""Versioned SQLite storage with an immutable in-process principle snapshot.

SQLite is the source of truth after the first successful seed. Counseling turns
must use :class:`PrincipleSnapshot`; they must never call back into this store.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from .principle_bank import BANK_PATH, load_principle_bank, validate_principle_bank


DEFAULT_PRINCIPLE_DB_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "principle_bank.sqlite3"
)


def canonical_principle_bank_json(payload: Mapping[str, Any]) -> str:
    """Return the stable JSON representation used for storage and checksums."""

    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def principle_bank_checksum(payload: Mapping[str, Any]) -> str:
    """Return a SHA-256 checksum for a validated bank payload."""

    canonical = canonical_principle_bank_json(payload)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _deep_freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType(
            {str(key): _deep_freeze(item) for key, item in value.items()}
        )
    if isinstance(value, list):
        return tuple(_deep_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_deep_freeze(item) for item in value)
    return value


@dataclass(frozen=True, slots=True)
class PrincipleSnapshot:
    """A complete, immutable bank view safe to reuse on every counseling turn."""

    enabled: bool
    bank_version: str
    schema_version: str
    checksum: str
    source: str
    payload: Mapping[str, Any]
    principles: tuple[Mapping[str, Any], ...]
    principles_by_id: Mapping[str, Mapping[str, Any]]
    global_blocked_contexts: frozenset[str]
    load_error: str | None = None

    def get(self, principle_id: str) -> Mapping[str, Any] | None:
        return self.principles_by_id.get(principle_id)


def _empty_snapshot(error: str | None = None) -> PrincipleSnapshot:
    empty_payload = MappingProxyType(
        {
            "delivery_modes": (),
            "global_blocked_contexts": (),
            "principles": (),
        }
    )
    return PrincipleSnapshot(
        enabled=False,
        bank_version="",
        schema_version="",
        checksum="",
        source="disabled",
        payload=empty_payload,
        principles=(),
        principles_by_id=MappingProxyType({}),
        global_blocked_contexts=frozenset(),
        load_error=error,
    )


def build_principle_snapshot(
    payload: dict[str, Any],
    *,
    source: str,
    checksum: str | None = None,
    load_error: str | None = None,
) -> PrincipleSnapshot:
    """Validate and freeze a payload into the only object used on hot paths."""

    validated = validate_principle_bank(payload)
    expected_checksum = principle_bank_checksum(validated)
    if checksum is not None and checksum != expected_checksum:
        raise ValueError("principle bank checksum mismatch")

    frozen_payload = _deep_freeze(validated)
    principles = tuple(frozen_payload["principles"])
    by_id = MappingProxyType(
        {str(principle["id"]): principle for principle in principles}
    )
    return PrincipleSnapshot(
        enabled=True,
        bank_version=str(validated.get("bank_version") or validated["schema_version"]),
        schema_version=str(validated["schema_version"]),
        checksum=expected_checksum,
        source=source,
        payload=frozen_payload,
        principles=principles,
        principles_by_id=by_id,
        global_blocked_contexts=frozenset(validated["global_blocked_contexts"]),
        load_error=load_error,
    )


class PrincipleStore:
    """Manage bank versions outside the per-turn response path.

    ``initialize`` is intended for application startup. Once it returns,
    ``snapshot`` is an atomic in-memory read and performs no SQLite I/O.
    """

    def __init__(
        self,
        db_path: Path | str = DEFAULT_PRINCIPLE_DB_PATH,
        *,
        seed_path: Path | str = BANK_PATH,
    ) -> None:
        self.db_path = Path(db_path)
        self.seed_path = Path(seed_path)
        self._lock = threading.RLock()
        self._snapshot = _empty_snapshot("principle store has not been initialized")

    @property
    def snapshot(self) -> PrincipleSnapshot:
        """Return the current immutable snapshot without touching SQLite."""

        return self._snapshot

    def initialize(self) -> PrincipleSnapshot:
        """Load the active DB version, seed an empty DB, or fall back gracefully."""

        with self._lock:
            seed_payload, seed_error = self._read_seed()
            try:
                snapshot = self._initialize_database(seed_payload)
            except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
                database_error = f"{type(exc).__name__}: {exc}"
                if seed_payload is not None:
                    snapshot = build_principle_snapshot(
                        seed_payload,
                        source="seed_fallback",
                        load_error=database_error,
                    )
                else:
                    combined = "; ".join(
                        part for part in (database_error, seed_error) if part
                    )
                    snapshot = _empty_snapshot(combined)
            self._snapshot = snapshot
            return snapshot

    def refresh_from_database(self) -> PrincipleSnapshot:
        """Explicitly reload the active DB version; never call this per turn."""

        with self._lock:
            try:
                with self._connect() as connection:
                    self._create_schema(connection)
                    snapshot = self._read_active_snapshot(connection)
                    if snapshot is None:
                        raise ValueError("principle database has no active version")
            except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
                # Keep the last good in-process snapshot when a refresh fails.
                return self._snapshot
            self._snapshot = snapshot
            return snapshot

    def activate_payload(self, payload: dict[str, Any]) -> PrincipleSnapshot:
        """Validate, store, and activate a bank version during admin/startup work."""

        validated = validate_principle_bank(payload)
        checksum = principle_bank_checksum(validated)
        with self._lock:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with self._connect() as connection:
                self._create_schema(connection)
                self._insert_version(connection, validated, checksum)
                self._activate_checksum(connection, checksum)
                connection.commit()
            snapshot = build_principle_snapshot(
                validated,
                source="database",
                checksum=checksum,
            )
            self._snapshot = snapshot
            return snapshot

    def _read_seed(self) -> tuple[dict[str, Any] | None, str | None]:
        try:
            return load_principle_bank(self.seed_path), None
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            return None, f"{type(exc).__name__}: {exc}"

    def _initialize_database(
        self,
        seed_payload: dict[str, Any] | None,
    ) -> PrincipleSnapshot:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            self._create_schema(connection)

            # Stage a valid bundled seed, but never replace an existing active
            # version. This keeps SQLite authoritative after first startup.
            seed_checksum = ""
            if seed_payload is not None:
                seed_checksum = principle_bank_checksum(seed_payload)
                self._insert_version(connection, seed_payload, seed_checksum)

            active = self._read_active_snapshot(connection)
            if active is None:
                if seed_payload is None:
                    raise ValueError("no active DB version and no valid JSON seed")
                self._activate_checksum(connection, seed_checksum)
                connection.commit()
                active = build_principle_snapshot(
                    seed_payload,
                    source="database",
                    checksum=seed_checksum,
                )
            else:
                connection.commit()
            return active

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.db_path), timeout=0.5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @staticmethod
    def _create_schema(connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS principle_bank_versions (
                checksum TEXT PRIMARY KEY,
                bank_version TEXT NOT NULL,
                schema_version TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS principle_bank_state (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                active_checksum TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(active_checksum)
                    REFERENCES principle_bank_versions(checksum)
            );
            """
        )

    @staticmethod
    def _insert_version(
        connection: sqlite3.Connection,
        payload: dict[str, Any],
        checksum: str,
    ) -> None:
        connection.execute(
            """
            INSERT OR IGNORE INTO principle_bank_versions
                (checksum, bank_version, schema_version, payload_json)
            VALUES (?, ?, ?, ?)
            """,
            (
                checksum,
                str(payload.get("bank_version") or payload["schema_version"]),
                str(payload["schema_version"]),
                canonical_principle_bank_json(payload),
            ),
        )

    @staticmethod
    def _activate_checksum(
        connection: sqlite3.Connection,
        checksum: str,
    ) -> None:
        connection.execute(
            """
            INSERT INTO principle_bank_state
                (singleton, active_checksum, updated_at)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(singleton) DO UPDATE SET
                active_checksum = excluded.active_checksum,
                updated_at = CURRENT_TIMESTAMP
            """,
            (checksum,),
        )

    @staticmethod
    def _read_active_snapshot(
        connection: sqlite3.Connection,
    ) -> PrincipleSnapshot | None:
        row = connection.execute(
            """
            SELECT versions.checksum, versions.payload_json
            FROM principle_bank_state AS state
            JOIN principle_bank_versions AS versions
              ON versions.checksum = state.active_checksum
            WHERE state.singleton = 1
            """
        ).fetchone()
        if row is None:
            return None
        payload = json.loads(str(row["payload_json"]))
        return build_principle_snapshot(
            payload,
            source="database",
            checksum=str(row["checksum"]),
        )
