import json
import sqlite3

import pytest

from counsel.principle_bank import PRINCIPLE_BANK_DATA
from counsel.principle_store import (
    PrincipleStore,
    build_principle_snapshot,
    principle_bank_checksum,
)


def _write_seed(path, payload):
    path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def test_empty_database_is_seeded_and_snapshot_is_deeply_immutable(tmp_path):
    db_path = tmp_path / "principles.sqlite3"
    seed_path = tmp_path / "seed.json"
    _write_seed(seed_path, PRINCIPLE_BANK_DATA)

    store = PrincipleStore(db_path, seed_path=seed_path)
    snapshot = store.initialize()

    assert snapshot.enabled is True
    assert snapshot.source == "database"
    assert snapshot.bank_version == PRINCIPLE_BANK_DATA["bank_version"]
    assert snapshot.checksum == principle_bank_checksum(PRINCIPLE_BANK_DATA)
    assert len(snapshot.principles) == 30
    assert snapshot.get("mistake_not_identity") is not None
    with pytest.raises(TypeError):
        snapshot.payload["bank_version"] = "mutated"
    with pytest.raises(TypeError):
        snapshot.principles[0]["named_pattern"]["utterance"] = "mutated"

    with sqlite3.connect(db_path) as connection:
        versions = connection.execute(
            "SELECT COUNT(*) FROM principle_bank_versions"
        ).fetchone()[0]
        active = connection.execute(
            "SELECT active_checksum FROM principle_bank_state WHERE singleton = 1"
        ).fetchone()[0]
    assert versions == 1
    assert active == snapshot.checksum


def test_existing_active_database_version_wins_over_a_changed_json_seed(tmp_path):
    db_path = tmp_path / "principles.sqlite3"
    first_seed = tmp_path / "first.json"
    second_seed = tmp_path / "second.json"
    _write_seed(first_seed, PRINCIPLE_BANK_DATA)
    first = PrincipleStore(db_path, seed_path=first_seed).initialize()

    changed = json.loads(json.dumps(PRINCIPLE_BANK_DATA, ensure_ascii=False))
    changed["bank_version"] = "2099-01-01.1"
    changed["principles"][0]["principle"] += " 변경된 시드"
    _write_seed(second_seed, changed)
    second = PrincipleStore(db_path, seed_path=second_seed).initialize()

    assert second.source == "database"
    assert second.checksum == first.checksum
    assert second.bank_version == first.bank_version
    with sqlite3.connect(db_path) as connection:
        # The new seed is staged for explicit activation, but cannot silently
        # replace the DB's active source-of-truth version.
        versions = connection.execute(
            "SELECT COUNT(*) FROM principle_bank_versions"
        ).fetchone()[0]
    assert versions == 2


def test_database_cold_failure_falls_back_to_valid_seed(tmp_path):
    db_path = tmp_path / "not-a-database"
    db_path.mkdir()
    seed_path = tmp_path / "seed.json"
    _write_seed(seed_path, PRINCIPLE_BANK_DATA)

    snapshot = PrincipleStore(db_path, seed_path=seed_path).initialize()

    assert snapshot.enabled is True
    assert snapshot.source == "seed_fallback"
    assert snapshot.load_error
    assert len(snapshot.principles) == 30


def test_database_and_seed_failure_disables_principles_without_raising(tmp_path):
    db_path = tmp_path / "not-a-database"
    db_path.mkdir()

    snapshot = PrincipleStore(
        db_path,
        seed_path=tmp_path / "missing.json",
    ).initialize()

    assert snapshot.enabled is False
    assert snapshot.source == "disabled"
    assert snapshot.principles == ()
    assert snapshot.load_error


def test_invalid_or_tampered_active_payload_never_replaces_last_good_snapshot(
    tmp_path,
):
    db_path = tmp_path / "principles.sqlite3"
    seed_path = tmp_path / "seed.json"
    _write_seed(seed_path, PRINCIPLE_BANK_DATA)
    store = PrincipleStore(db_path, seed_path=seed_path)
    original = store.initialize()

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE principle_bank_versions SET payload_json = '{}' "
            "WHERE checksum = ?",
            (original.checksum,),
        )
        connection.commit()

    refreshed = store.refresh_from_database()
    assert refreshed is original
    assert refreshed.enabled is True


def test_build_snapshot_rejects_a_checksum_mismatch():
    with pytest.raises(ValueError, match="checksum mismatch"):
        build_principle_snapshot(
            PRINCIPLE_BANK_DATA,
            source="test",
            checksum="0" * 64,
        )
