from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app import server as server_module
from app.commons import CommonsStore


class MutableClock:
    def __init__(self, value: datetime) -> None:
        self.value = value

    def __call__(self) -> datetime:
        return self.value


@pytest.fixture
def commons_api(tmp_path, monkeypatch):
    clock = MutableClock(datetime(2026, 7, 20, 1, 0, tzinfo=timezone.utc))  # 10:00 KST
    path = tmp_path / "commons.sqlite3"
    store = CommonsStore(path, clock=clock, ttl_hours=30)
    monkeypatch.setattr(server_module, "commons_store", store)
    return TestClient(server_module.app), store, clock, path


def test_guestbook_and_installations_use_separate_public_contract(commons_api):
    client, _, _, _ = commons_api

    guestbook_response = client.post(
        "/api/commons/guestbook",
        json={"message": "  오늘도 천천히 걸어가요.  "},
    )
    assert guestbook_response.status_code == 201
    guestbook = guestbook_response.json()
    assert set(guestbook) == {"trace", "ownership_token"}
    assert len(guestbook["ownership_token"]) >= 20
    assert guestbook["trace"] == {
        **guestbook["trace"],
        "day_key": "2026-07-20",
        "kind": "guestbook",
        "anchor_key": "today-wall",
        "object_kind": None,
        "message": "오늘도 천천히 걸어가요.",
        "created_bucket": "morning",
        "reaction_count": 0,
    }
    assert guestbook["trace"]["alias"].startswith("오늘의 ")
    assert not ({"experiment_id", "session_id", "transcript", "slots"} & set(guestbook["trace"]))

    first = client.post("/api/commons/installations", json={"object_kind": "flower"})
    second = client.post("/api/commons/installations", json={"object_kind": "lantern", "message": "잠시 쉬어가도 괜찮아요."})
    assert first.status_code == second.status_code == 201
    assert first.json()["trace"]["anchor_key"] == "installation-01"
    assert second.json()["trace"]["anchor_key"] == "installation-02"
    assert second.json()["trace"]["object_kind"] == "lantern"

    today = client.get("/api/commons/today")
    assert today.status_code == 200
    body = today.json()
    assert body["day_key"] == "2026-07-20"
    assert body["counts"] == {"total": 3, "guestbook": 1, "installation": 2}
    assert len(body["traces"]) == 3
    assert all("ownership_token" not in trace for trace in body["traces"])


def test_explicit_fixed_anchor_and_object_kinds_are_validated(commons_api):
    client, _, _, _ = commons_api
    for object_kind in ["flower", "lantern", "book", "stone"]:
        response = client.post(
            "/api/commons/installations",
            json={"anchor_key": "installation-16", "object_kind": object_kind},
        )
        assert response.status_code == 201
        assert response.json()["trace"]["anchor_key"] == "installation-16"

    assert client.post(
        "/api/commons/installations",
        json={"anchor_key": "garden-01", "object_kind": "flower"},
    ).status_code == 422


def test_same_visitor_token_gets_same_daily_alias_without_being_stored(commons_api):
    client, _, _, path = commons_api
    headers = {"X-Visitor-Token": "visitor-token-opaque-1234567890"}
    guestbook = client.post(
        "/api/commons/guestbook",
        json={"message": "오늘의 방명록"},
        headers=headers,
    ).json()["trace"]
    installation = client.post(
        "/api/commons/installations",
        json={"object_kind": "stone"},
        headers=headers,
    ).json()["trace"]
    assert guestbook["alias"] == installation["alias"]

    with sqlite3.connect(path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(commons_traces)")}
        serialized_rows = repr(connection.execute("SELECT * FROM commons_traces").fetchall())
    assert "visitor_token" not in columns
    assert headers["X-Visitor-Token"] not in serialized_rows

    assert client.post(
        "/api/commons/guestbook",
        json={"message": "짧은 헤더"},
        headers={"X-Visitor-Token": "too-short"},
    ).status_code == 422
    assert client.post(
        "/api/commons/installations",
        json={"anchor_key": "installation-01", "object_kind": "chair"},
    ).status_code == 422
    assert client.post(
        "/api/commons/guestbook",
        json={"anchor_key": "waiting-board", "message": "안녕하세요"},
    ).status_code == 422


def test_reaction_report_and_owner_only_delete(commons_api):
    client, _, _, path = commons_api
    created = client.post(
        "/api/commons/guestbook",
        json={"message": "다른 방문자를 응원해요."},
    ).json()
    trace_id = created["trace"]["id"]
    token = created["ownership_token"]

    first_reactor = {"X-Visitor-Token": "reactor-token-opaque-1234567890"}
    second_reactor = {"X-Visitor-Token": "other-reactor-token-1234567890"}
    first_reaction = client.post(f"/api/commons/traces/{trace_id}/reactions", headers=first_reactor)
    duplicate_reaction = client.post(f"/api/commons/traces/{trace_id}/reactions", headers=first_reactor)
    second_reaction = client.post(f"/api/commons/traces/{trace_id}/reactions", headers=second_reactor)
    assert first_reaction.json()["reaction_count"] == 1
    assert duplicate_reaction.json()["reaction_count"] == 1
    assert second_reaction.json()["reaction_count"] == 2

    report = client.post(
        f"/api/commons/traces/{trace_id}/reports",
        json={"category": "personal_information"},
    )
    assert report.status_code == 202
    assert report.json() == {"trace_id": trace_id, "reported": True}

    with sqlite3.connect(path) as connection:
        stored_hash = connection.execute(
            "SELECT ownership_token_hash FROM commons_traces WHERE id = ?",
            (trace_id,),
        ).fetchone()[0]
        report_count = connection.execute(
            "SELECT COUNT(*) FROM commons_reports WHERE trace_id = ?",
            (trace_id,),
        ).fetchone()[0]
        stored_reactor_hashes = [
            row[0] for row in connection.execute(
                "SELECT reactor_hash FROM commons_reactions WHERE trace_id = ?",
                (trace_id,),
            ).fetchall()
        ]
    assert token != stored_hash
    assert len(stored_hash) == 64
    assert report_count == 1
    assert len(stored_reactor_hashes) == 2
    assert all(len(value) == 64 for value in stored_reactor_hashes)
    assert all(first_reactor["X-Visitor-Token"] != value for value in stored_reactor_hashes)

    assert client.delete(
        f"/api/commons/traces/{trace_id}",
        headers={"X-Ownership-Token": "wrong-token-that-is-long-enough"},
    ).status_code == 403
    assert client.delete(
        f"/api/commons/traces/{trace_id}",
        headers={"X-Ownership-Token": token},
    ).status_code == 204
    assert client.get("/api/commons/today").json()["counts"]["total"] == 0
    assert client.post(f"/api/commons/traces/{trace_id}/reactions", headers=first_reactor).status_code == 404


@pytest.mark.parametrize(
    ("message", "code"),
    [
        ("연락은 test@example.com 으로 주세요", "personal_information"),
        ("제 번호는 010-1234-5678이에요", "personal_information"),
        ("자해하고 싶다는 생각이 들어요", "crisis"),
        ("씨 발 진짜 짜증나", "profanity"),
    ],
)
def test_public_message_moderation_blocks_sensitive_content(commons_api, message, code):
    client, _, _, _ = commons_api
    response = client.post("/api/commons/guestbook", json={"message": message})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert response.json()["detail"]["safety_bypass"] is (code == "crisis")
    assert client.get("/api/commons/today").json()["counts"]["total"] == 0


def test_message_length_is_capped_at_sixty_characters(commons_api):
    client, _, _, _ = commons_api
    assert client.post("/api/commons/guestbook", json={"message": "가" * 60}).status_code == 201
    assert client.post("/api/commons/guestbook", json={"message": "가" * 61}).status_code == 422
    assert client.post(
        "/api/commons/installations",
        json={"object_kind": "book", "message": "나" * 61},
    ).status_code == 422


def test_day_key_uses_seoul_and_expired_rows_are_physically_removed(tmp_path):
    clock = MutableClock(datetime(2026, 7, 20, 15, 30, tzinfo=timezone.utc))  # 00:30 KST next day
    path = tmp_path / "expiring.sqlite3"
    store = CommonsStore(path, clock=clock, ttl_hours=24)
    trace, _ = store.create_guestbook(message="오늘의 첫 메시지")
    assert trace["day_key"] == "2026-07-21"

    clock.value += timedelta(hours=23)
    store.today()  # Old day traces are hidden, but retained until the TTL expires.
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM commons_traces").fetchone()[0] == 1

    clock.value += timedelta(hours=2)
    store.today()
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM commons_traces").fetchone()[0] == 0
