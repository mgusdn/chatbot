from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app import memory_api
from app import server as server_module
from app.memories import (
    MEMORY_RELOCATION_ENTRY_BOUNDS,
    MEMORY_RELOCATION_FLOOR_FIXTURES,
    MEMORY_RELOCATION_SURFACE_SIZES,
    MEMORY_RELOCATION_WALL_FIXTURES,
    MemoryStore,
)


class MutableClock:
    def __init__(self, value: datetime) -> None:
        self.value = value

    def __call__(self) -> datetime:
        return self.value


@pytest.fixture
def memory_api_client(tmp_path, monkeypatch):
    clock = MutableClock(datetime(2026, 7, 22, 3, 0, tzinfo=timezone.utc))
    path = tmp_path / "memories.sqlite3"
    store = MemoryStore(path, clock=clock, auto_hide_reports=3)
    monkeypatch.setattr(memory_api, "memory_store", store)
    return TestClient(server_module.app), store, clock, path


VISITOR = {"X-Visitor-Token": "memory-visitor-token-1234567890"}
IDEMPOTENT_OWNER = "memory-owner-token-1234567890-abcdef"
IDEMPOTENT_REQUEST = "memory-request-1234567890"
RELOCATION_REQUEST = "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b4"


def design_v1(*, first_text: str = "함께 걸었던", second_text: str = "오늘을 기억해요"):
    return {
        "version": 1,
        "template_id": "warm-paper-v1",
        "layers": [
            {
                "id": "text-main",
                "type": "text",
                "text": first_text,
                "x": 0.5,
                "y": 0.34,
                "width": 0.72,
                "font_size": 0.18,
                "font": "display",
                "color": "berry",
                "align": "center",
                "rotation_deg": -4,
            },
            {
                "id": "sticker-heart",
                "type": "sticker",
                "sticker_id": "heart",
                "x": 0.78,
                "y": 0.72,
                "width": 0.16,
                "rotation_deg": 12,
            },
            {
                "id": "text-note",
                "type": "text",
                "text": second_text,
                "x": 0.5,
                "y": 0.65,
                "width": 0.68,
                "font_size": 0.1,
                "font": "round",
                "color": "ink",
                "align": "center",
                "rotation_deg": 2,
            },
        ],
    }


def design_v2(
    *,
    template_id: str = "warm-paper-v1",
    first_text: str = "함께 걸었던",
    second_text: str = "오늘을 기억해요",
    signature: str | None = None,
):
    design = design_v1(first_text=first_text, second_text=second_text)
    return {
        **design,
        "version": 2,
        "template_id": template_id,
        "signature": signature,
    }


def memory_payload(**overrides):
    payload = {
        "kind": "story",
        "body": "  프로메테우스에서 서로의 이야기를 천천히 들었던 밤  ",
        "emotion": "tender",
        "card_style": "sage",
        "placement": {
            "surface_id": "floor.center",
            "u": 0.25,
            "v": 0.75,
            "rotation_deg": -8,
            "scale": 1.1,
            "z_index": 4,
        },
    }
    payload.update(overrides)
    return payload


def create_memory(client: TestClient, **overrides):
    return client.post(
        "/api/memory-rooms/prometheus/memories",
        json=memory_payload(**overrides),
        headers=VISITOR,
    )


def relocate_memory(
    client: TestClient,
    created: dict,
    *,
    client_request_id: str = RELOCATION_REQUEST,
    expected_version: int = 1,
    surface_id: str = "floor.interior",
    u: float = 0.6,
    v: float = 0.4,
    rotation_deg: float = 18,
    scale: float = 1.1,
    ownership_token: str | None = None,
    visitor_headers: dict[str, str] | None = None,
    **extra,
):
    memory_id = created["memory"]["id"]
    headers = {
        "X-Ownership-Token": ownership_token or created["ownership_token"],
        **(visitor_headers or VISITOR),
    }
    return client.post(
        f"/api/memory-rooms/prometheus/memories/{memory_id}/relocations",
        json={
            "client_request_id": client_request_id,
            "expected_version": expected_version,
            "surface_id": surface_id,
            "u": u,
            "v": v,
            "rotation_deg": rotation_deg,
            "scale": scale,
            **extra,
        },
        headers=headers,
    )


def test_persistent_memory_contract_is_separate_and_uses_surface_local_coordinates(memory_api_client):
    client, _, _, path = memory_api_client

    room = client.get("/api/memory-rooms/prometheus")
    assert room.status_code == 200
    assert room.json() == {
        "slug": "prometheus",
        "title": "프로메테우스 추억방",
        "scene_version": 1,
        "theme_id": "prometheus-coast",
        "revision": 0,
        "memory_count": 0,
    }

    response = create_memory(client, author_alias="  밤 산책자  ")
    assert response.status_code == 201
    result = response.json()
    assert set(result) == {"memory", "ownership_token"}
    assert len(result["ownership_token"]) >= 20
    memory = result["memory"]
    assert memory["body"] == "프로메테우스에서 서로의 이야기를 천천히 들었던 밤"
    assert memory["author_alias"] == "밤 산책자"
    assert memory["placement"] == {
        "surface_id": "floor.center",
        "u": 0.25,
        "v": 0.75,
        "rotation_deg": -8.0,
        "scale": 1.1,
        "z_index": 4,
        "version": 1,
    }
    assert not ({"experiment_id", "session_id", "transcript", "counseling"} & set(memory))

    listed = client.get("/api/memory-rooms/prometheus/memories").json()
    assert listed["room"]["revision"] == 1
    assert listed["memories"] == [memory]
    assert listed["next_cursor"] is None
    assert client.get(f"/api/memory-rooms/prometheus/memories/{memory['id']}").json() == memory

    with sqlite3.connect(path) as connection:
        entry = connection.execute(
            "SELECT ownership_token_hash, moderation_status FROM memory_entries WHERE id = ?",
            (memory["id"],),
        ).fetchone()
        placement = connection.execute(
            "SELECT surface_id, u, v FROM memory_placements WHERE entry_id = ?",
            (memory["id"],),
        ).fetchone()
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        serialized = repr(connection.execute("SELECT * FROM memory_entries").fetchall())
    assert len(entry[0]) == 64
    assert entry[0] != result["ownership_token"]
    assert entry[1] == "visible"
    assert placement == ("floor.center", 0.25, 0.75)
    assert "commons_traces" not in tables
    assert "memory_schema_migrations" in tables
    assert VISITOR["X-Visitor-Token"] not in serialized


def test_relocation_geometry_matches_the_expanded_room_contract():
    assert MEMORY_RELOCATION_SURFACE_SIZES == {
        "floor.interior": (21.6, 18.0),
        "wall.interior.north": (21.0, 2.85),
        "wall.interior.west": (17.4, 2.85),
        "wall.interior.east": (17.4, 2.85),
    }
    assert MEMORY_RELOCATION_ENTRY_BOUNDS == (-1.8, 1.8, -9.0, -7.2)

    fixtures = {
        fixture_id: (min_u, max_u, min_v, max_v)
        for fixture_id, min_u, max_u, min_v, max_v
        in MEMORY_RELOCATION_FLOOR_FIXTURES
    }
    # Fixtures that no longer correspond to any rendered furniture (the old
    # cowork-cafe/installation-gallery/shared-library/recovery-lab pieces,
    # plus the removed archive bookcase and the never-rendered east pbao
    # chair) were dropped so their footprints stop blocking guestbook
    # placement and memory relocation.
    assert set(fixtures) == {
        "guestbook-worktable",
        "guestbook-chair-north",
        "guestbook-low-shelf",
        "guestbook-notice-board",
        "plant-lab-island",
        "pbao-desk",
        "pbao-chair-west",
    }
    assert fixtures["guestbook-worktable"] == (-6.85, -4.35, -5.92, -4.68)
    assert fixtures["guestbook-low-shelf"] == (-8.51, -7.79, -6.3, -3.7)
    assert fixtures["pbao-desk"] == (-1.65, 1.65, 4.6, 5.6)

    assert {fixture[0] for fixture in MEMORY_RELOCATION_WALL_FIXTURES} == {
        "today-wall",
    }


def test_room_expansion_keeps_existing_normalized_uvs_without_migration(
    memory_api_client,
):
    client, _, clock, path = memory_api_client
    created = create_memory(
        client,
        body="확장 전부터 있던 카드",
        placement={
            "surface_id": "floor.interior",
            "u": 0.23,
            "v": 0.77,
            "rotation_deg": 12,
            "scale": 1,
            "z_index": 4,
        },
    ).json()["memory"]

    reopened = MemoryStore(path, clock=clock).get("prometheus", created["id"])

    assert reopened["placement"] == created["placement"]
    assert reopened["placement"]["u"] == 0.23
    assert reopened["placement"]["v"] == 0.77


def test_design_v1_is_persisted_with_accessible_moderated_text_and_interior_floor(memory_api_client):
    client, _, _, path = memory_api_client
    payload = memory_payload(
        kind="note",
        design=design_v1(first_text="  함께   걸었던  ", second_text="오늘을 기억해요"),
        client_request_id=IDEMPOTENT_REQUEST,
        ownership_token=IDEMPOTENT_OWNER,
        placement={
            "surface_id": "floor.interior",
            "u": 0.6,
            "v": 0.5,
            "rotation_deg": 37,
            "scale": 1.2,
            "z_index": 8,
        },
    )
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 201
    result = response.json()
    assert result["ownership_token"] == IDEMPOTENT_OWNER
    memory = result["memory"]
    assert memory["body"] == "함께 걸었던 오늘을 기억해요"
    assert memory["placement"]["surface_id"] == "floor.interior"
    assert memory["design"] == {
        **design_v1(first_text="함께 걸었던", second_text="오늘을 기억해요"),
        "layers": [
            {
                **design_v1(first_text="함께 걸었던", second_text="오늘을 기억해요")["layers"][0],
                "rotation_deg": -4.0,
            },
            {
                **design_v1(first_text="함께 걸었던", second_text="오늘을 기억해요")["layers"][1],
                "rotation_deg": 12.0,
            },
            {
                **design_v1(first_text="함께 걸었던", second_text="오늘을 기억해요")["layers"][2],
                "rotation_deg": 2.0,
            },
        ],
    }

    listed = client.get("/api/memory-rooms/prometheus/memories").json()["memories"]
    assert listed == [memory]
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            """
            SELECT design_json, design_version, client_request_id, creator_hash,
                   request_fingerprint, ownership_token_hash
            FROM memory_entries WHERE id = ?
            """,
            (memory["id"],),
        ).fetchone()
        serialized = repr(connection.execute("SELECT * FROM memory_entries").fetchall())
    assert json.loads(row[0]) == memory["design"]
    assert row[1] == 1
    assert row[2] == IDEMPOTENT_REQUEST
    assert len(row[3]) == 64
    assert len(row[4]) == 64
    assert len(row[5]) == 64
    expected_fingerprint_payload = {
        "kind": "note",
        "body": None,
        "emotion": "tender",
        "card_style": "sage",
        "author_alias": None,
        "placement": {
            "surface_id": "floor.interior",
            "u": 0.6,
            "v": 0.5,
            "rotation_deg": 37.0,
            "scale": 1.2,
            "z_index": 8,
        },
        "design": memory["design"],
    }
    expected_fingerprint = hashlib.sha256(json.dumps(
        expected_fingerprint_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    assert row[0] == json.dumps(
        memory["design"],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert row[4] == expected_fingerprint
    assert IDEMPOTENT_OWNER not in serialized
    assert VISITOR["X-Visitor-Token"] not in serialized


@pytest.mark.parametrize(
    ("surface_id", "u"),
    [
        ("wall.interior.north", 0.75),
        ("wall.interior.west", 0.73),
        ("wall.interior.east", 0.59),
    ],
)
def test_designed_letter_can_be_created_directly_on_each_walk_up_wall(
    memory_api_client,
    surface_id,
    u,
):
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v2(signature="벽에 남긴 마음"),
        client_request_id=f"create-{surface_id}-request",
        ownership_token=f"create-{surface_id}-owner-token-1234567890",
        placement={
            "surface_id": surface_id,
            "u": u,
            "v": 0.708,
            "rotation_deg": 0,
            "scale": 1,
            "z_index": 999,
        },
    )
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 201
    assert response.json()["memory"]["placement"] == {
        "surface_id": surface_id,
        "u": u,
        "v": 0.708,
        "rotation_deg": 0.0,
        "scale": 1.0,
        "z_index": 1,
        "version": 1,
    }


@pytest.mark.parametrize(
    ("surface_id", "u", "expected_code"),
    [
        ("wall.interior.north", 0.0, "placement_bounds"),
        ("wall.interior.north", 0.5, "placement_collision"),
    ],
)
def test_designed_wall_create_uses_relocation_bounds_and_fixture_validation(
    memory_api_client,
    surface_id,
    u,
    expected_code,
):
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v2(),
        placement={
            "surface_id": surface_id,
            "u": u,
            "v": 0.708,
            "rotation_deg": 0,
            "scale": 1,
            "z_index": 0,
        },
    )
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == expected_code
    assert client.get("/api/memory-rooms/prometheus").json()["memory_count"] == 0


def test_designed_wall_create_opens_the_former_archive_bookcase_spot(
    memory_api_client,
):
    # The archive bookcase was removed along with its wall-fixture exclusion
    # zone, so a letter can now land where it used to sit.
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v2(),
        placement={
            "surface_id": "wall.interior.north",
            "u": 0.5 - 6.7 / MEMORY_RELOCATION_SURFACE_SIZES["wall.interior.north"][0],
            "v": 0.708,
            "rotation_deg": 0,
            "scale": 1,
            "z_index": 0,
        },
    )
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 201


def test_walk_up_wall_rejects_rotation_that_the_client_cannot_create(
    memory_api_client,
):
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v2(),
        placement={
            "surface_id": "wall.interior.north",
            "u": 0.75,
            "v": 0.708,
            "rotation_deg": 15,
            "scale": 1,
            "z_index": 0,
        },
    )
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "placement_rotation"


@pytest.mark.parametrize("sticker_id", ["thumbs-up", "prometheus-p"])
def test_guestbook_design_accepts_bundled_sticker_ids(memory_api_client, sticker_id):
    client, _, _, _ = memory_api_client
    design = design_v2()
    design["layers"][1] = {
        **design["layers"][1],
        "id": f"sticker-{sticker_id}",
        "sticker_id": sticker_id,
    }
    payload = memory_payload(design=design)
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 201
    assert response.json()["memory"]["design"]["layers"][1]["sticker_id"] == sticker_id


@pytest.mark.parametrize(
    "template_id",
    [
        "warm-paper-v1",
        "sage-grid-v1",
        "sky-postcard-v1",
        "rose-confetti-v1",
    ],
)
def test_design_v2_templates_and_normalized_signature_round_trip(
    memory_api_client,
    template_id,
):
    client, _, _, path = memory_api_client
    payload = memory_payload(
        design=design_v2(
            template_id=template_id,
            signature="  마음\u200b\r\n 산책자  ",
        ),
    )
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 201
    memory = response.json()["memory"]
    assert memory["design"]["version"] == 2
    assert memory["design"]["template_id"] == template_id
    assert memory["design"]["signature"] == "마음 산책자"
    # The signature has its own visual role and does not alter the accessible
    # body assembled from the text layers.
    assert memory["body"] == "함께 걸었던 오늘을 기억해요"
    with sqlite3.connect(path) as connection:
        stored = connection.execute(
            "SELECT design_version, design_json FROM memory_entries WHERE id = ?",
            (memory["id"],),
        ).fetchone()
    assert stored[0] == 2
    assert json.loads(stored[1]) == memory["design"]


@pytest.mark.parametrize(
    "design",
    [
        {**design_v1(), "signature": None},
        {
            key: value
            for key, value in design_v2().items()
            if key != "signature"
        },
        {**design_v1(), "template_id": "sage-grid-v1"},
        {**design_v2(), "template_id": "unknown-template-v1"},
        {**design_v2(), "version": 3},
    ],
)
def test_design_versions_are_strict_and_v1_shape_remains_exact(memory_api_client, design):
    client, _, _, _ = memory_api_client
    payload = memory_payload(design=design)
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 422
    assert client.get("/api/memory-rooms/prometheus").json()["memory_count"] == 0


@pytest.mark.parametrize(
    ("signature", "code"),
    [
        ("test@example.com", "personal_information"),
        ("자.살하고 싶어요", "crisis"),
        ("씨 발", "profanity"),
    ],
)
def test_design_v2_signature_uses_public_content_moderation(
    memory_api_client,
    signature,
    code,
):
    client, _, _, _ = memory_api_client
    payload = memory_payload(design=design_v2(signature=signature))
    payload.pop("body")

    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


def test_design_v2_requires_24_character_signature_and_180_character_public_budget(
    memory_api_client,
):
    client, _, _, _ = memory_api_client
    too_long_signature = memory_payload(
        design=design_v2(signature="가" * 25),
    )
    too_long_signature.pop("body")
    over_total_budget = memory_payload(
        design=design_v2(
            first_text="가" * 170,
            second_text="나" * 5,
            signature="다" * 6,
        ),
    )
    over_total_budget.pop("body")

    assert client.post(
        "/api/memory-rooms/prometheus/memories",
        json=too_long_signature,
        headers=VISITOR,
    ).status_code == 422
    assert client.post(
        "/api/memory-rooms/prometheus/memories",
        json=over_total_budget,
        headers=VISITOR,
    ).status_code == 422
    assert client.get("/api/memory-rooms/prometheus").json()["memory_count"] == 0


def test_designed_floor_z_assignment_spans_every_non_null_design_version(memory_api_client):
    client, _, _, path = memory_api_client

    def submit(design: dict, suffix: str):
        payload = memory_payload(
            design=design,
            client_request_id=f"cross-version-{suffix}-request",
            ownership_token=f"cross-version-{suffix}-owner-token-123456789",
            placement={
                **memory_payload()["placement"],
                "surface_id": "floor.interior",
                "z_index": 999,
            },
        )
        payload.pop("body")
        return client.post(
            "/api/memory-rooms/prometheus/memories",
            json=payload,
            headers=VISITOR,
        )

    first = submit(design_v1(), "v1")
    second = submit(design_v2(signature=None), "v2")

    assert first.status_code == second.status_code == 201
    assert first.json()["memory"]["placement"]["z_index"] == 1
    assert second.json()["memory"]["placement"]["z_index"] == 2
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            """
            SELECT e.design_version, p.z_index
            FROM memory_entries e
            JOIN memory_placements p ON p.entry_id = e.id
            WHERE e.design_version IS NOT NULL
            ORDER BY p.z_index
            """
        ).fetchall() == [(1, 1), (2, 2)]


def test_idempotent_create_recovers_same_memory_and_client_owned_token(memory_api_client):
    client, _, _, path = memory_api_client
    payload = memory_payload(
        design=design_v1(),
        client_request_id=IDEMPOTENT_REQUEST,
        ownership_token=IDEMPOTENT_OWNER,
        placement={**memory_payload()["placement"], "surface_id": "floor.interior"},
    )
    payload.pop("body")

    first = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )
    retry = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )

    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    assert retry.json()["ownership_token"] == IDEMPOTENT_OWNER
    assert retry.json()["memory"]["placement"]["z_index"] == 1
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'create'"
        ).fetchone()[0] == 1

    altered = {
        **payload,
        "design": design_v1(second_text="다른 내용이에요"),
    }
    conflict = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=altered,
        headers=VISITOR,
    )
    assert conflict.status_code == 409

    wrong_owner = {
        **payload,
        "ownership_token": "different-owner-token-1234567890-abcdef",
    }
    forbidden = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=wrong_owner,
        headers=VISITOR,
    )
    assert forbidden.status_code == 403
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0] == 1


def test_server_assigns_monotonic_z_index_to_new_designed_interior_floor_memories(memory_api_client):
    client, _, _, path = memory_api_client

    def submit(index: int, requested_z: int):
        payload = memory_payload(
            design=design_v1(second_text=f"{index}번째 편지"),
            client_request_id=f"floor-request-{index}-1234567890",
            ownership_token=f"floor-owner-{index}-1234567890-abcdefgh",
            placement={
                **memory_payload()["placement"],
                "surface_id": "floor.interior",
                "z_index": requested_z,
            },
        )
        payload.pop("body")
        return client.post(
            "/api/memory-rooms/prometheus/memories",
            json=payload,
            headers=VISITOR,
        )

    first = submit(1, 998)
    second = submit(2, 0)
    third = submit(3, 413)

    assert [first.status_code, second.status_code, third.status_code] == [201, 201, 201]
    assert [
        first.json()["memory"]["placement"]["z_index"],
        second.json()["memory"]["placement"]["z_index"],
        third.json()["memory"]["placement"]["z_index"],
    ] == [1, 2, 3]
    with sqlite3.connect(path) as connection:
        stored = connection.execute(
            """
            SELECT p.z_index
            FROM memory_placements p
            JOIN memory_entries e ON e.id = p.entry_id
            WHERE e.design_version = 1 AND p.surface_id = 'floor.interior'
            ORDER BY p.z_index
            """
        ).fetchall()
    assert stored == [(1,), (2,), (3,)]


def test_direct_wall_create_uses_surface_z_and_idempotent_retry_does_not_consume_it(
    memory_api_client,
):
    client, _, _, path = memory_api_client
    baseline = create_memory(client, body="먼저 벽으로 옮겨진 카드").json()
    moved = relocate_memory(
        client,
        baseline,
        surface_id="wall.interior.north",
        u=0.75,
        v=0.71,
        rotation_deg=0,
        scale=1,
    )
    assert moved.status_code == 200
    assert moved.json()["placement"]["z_index"] == 1

    def wall_payload(index: int):
        payload = memory_payload(
            design=design_v2(second_text=f"벽 편지 {index}"),
            client_request_id=f"direct-wall-request-{index}",
            ownership_token=f"direct-wall-owner-{index}-1234567890-abcd",
            placement={
                "surface_id": "wall.interior.north",
                "u": 0.75,
                "v": 0.708,
                "rotation_deg": 0,
                "scale": 1,
                "z_index": 999,
            },
        )
        payload.pop("body")
        return payload

    first_payload = wall_payload(1)
    first = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=first_payload,
        headers=VISITOR,
    )
    retry = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=first_payload,
        headers=VISITOR,
    )
    second = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=wall_payload(2),
        headers=VISITOR,
    )

    assert first.status_code == retry.status_code == second.status_code == 201
    assert retry.json() == first.json()
    assert first.json()["memory"]["placement"]["z_index"] == 2
    assert second.json()["memory"]["placement"]["z_index"] == 3
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            """
            SELECT z_index FROM memory_placements
            WHERE surface_id = 'wall.interior.north'
            ORDER BY z_index
            """
        ).fetchall() == [(1,), (2,), (3,)]
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'create'"
        ).fetchone()[0] == 3


def test_designed_floor_z_index_is_reclaimed_after_delete(memory_api_client):
    client, _, _, _ = memory_api_client

    def payload(index: int):
        value = memory_payload(
            design=design_v1(second_text=f"{index}번째 편지"),
            client_request_id=f"delete-floor-request-{index}",
            ownership_token=f"delete-floor-owner-{index}-1234567890-abcd",
            placement={
                **memory_payload()["placement"],
                "surface_id": "floor.interior",
                "z_index": 0,
            },
        )
        value.pop("body")
        return value

    first = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload(1),
        headers=VISITOR,
    ).json()
    assert client.delete(
        f"/api/memory-rooms/prometheus/memories/{first['memory']['id']}",
        headers={"X-Ownership-Token": first["ownership_token"]},
    ).status_code == 204
    second = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload(2),
        headers=VISITOR,
    )

    assert second.status_code == 201
    assert second.json()["memory"]["placement"]["z_index"] == 1


def test_server_z_assignment_preserves_legacy_and_non_floor_placement_values(memory_api_client):
    client, _, _, _ = memory_api_client
    legacy = create_memory(
        client,
        body="레거시 바닥 카드",
        placement={
            **memory_payload()["placement"],
            "surface_id": "floor.interior",
            "z_index": 77,
        },
    )
    designed_wall_payload = memory_payload(
        design=design_v1(),
        placement={
            **memory_payload()["placement"],
            "surface_id": "wall.west",
            "z_index": 55,
        },
    )
    designed_wall_payload.pop("body")
    designed_wall = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=designed_wall_payload,
        headers=VISITOR,
    )

    assert legacy.status_code == designed_wall.status_code == 201
    assert legacy.json()["memory"]["placement"]["z_index"] == 77
    assert designed_wall.json()["memory"]["placement"]["z_index"] == 55


def test_concurrent_idempotent_create_commits_only_one_memory(memory_api_client):
    client, _, _, path = memory_api_client
    payload = memory_payload(
        body="동시에 보내도 한 장",
        client_request_id=IDEMPOTENT_REQUEST,
        ownership_token=IDEMPOTENT_OWNER,
        placement={**memory_payload()["placement"], "surface_id": "floor.interior"},
    )

    def submit() -> tuple[int, dict]:
        response = client.post(
            "/api/memory-rooms/prometheus/memories",
            json=payload,
            headers=VISITOR,
        )
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))

    assert [status for status, _ in results] == [201, 201]
    assert results[0][1] == results[1][1]
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'create'"
        ).fetchone()[0] == 1


def test_concurrent_distinct_designed_floor_creates_receive_unique_z_indexes(memory_api_client):
    client, _, _, path = memory_api_client

    def submit(index: int) -> tuple[int, int]:
        payload = memory_payload(
            design=design_v1(second_text=f"동시 편지 {index}"),
            client_request_id=f"concurrent-floor-request-{index}",
            ownership_token=f"concurrent-floor-owner-{index}-1234567890-abcd",
            placement={
                **memory_payload()["placement"],
                "surface_id": "floor.interior",
                "z_index": 999,
            },
        )
        payload.pop("body")
        response = client.post(
            "/api/memory-rooms/prometheus/memories",
            json=payload,
            headers=VISITOR,
        )
        return response.status_code, response.json()["memory"]["placement"]["z_index"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, [1, 2]))

    assert [status for status, _ in results] == [201, 201]
    assert sorted(z_index for _, z_index in results) == [1, 2]
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            """
            SELECT COUNT(DISTINCT p.z_index)
            FROM memory_placements p
            JOIN memory_entries e ON e.id = p.entry_id
            WHERE e.design_version = 1 AND p.surface_id = 'floor.interior'
            """
        ).fetchone()[0] == 2


def test_client_request_id_is_scoped_to_the_anonymous_visitor(memory_api_client):
    client, _, _, path = memory_api_client
    first_payload = memory_payload(
        body="첫 방문자의 방명록",
        client_request_id=IDEMPOTENT_REQUEST,
        ownership_token=IDEMPOTENT_OWNER,
    )
    second_payload = {
        **first_payload,
        "body": "두 번째 방문자의 방명록",
        "ownership_token": "second-owner-token-1234567890-abcdef",
    }

    first = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=first_payload,
        headers=VISITOR,
    )
    second = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=second_payload,
        headers={"X-Visitor-Token": "another-memory-visitor-1234567890"},
    )

    assert first.status_code == second.status_code == 201
    assert first.json()["memory"]["id"] != second.json()["memory"]["id"]
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0] == 2


@pytest.mark.parametrize(
    "mutate",
    [
        lambda design: {**design, "unexpected": True},
        lambda design: {
            **design,
            "layers": [{**design["layers"][0], "html": "<img src=x>"}],
        },
        lambda design: {
            **design,
            "layers": [{**design["layers"][1], "sticker_id": "remote-image"}],
        },
        lambda design: {
            **design,
            "layers": [{**design["layers"][0], "x": 1.01}],
        },
        lambda design: {
            **design,
            "layers": [
                {**design["layers"][0], "id": f"text-{index}", "text": "가"}
                for index in range(7)
            ],
        },
        lambda design: {
            **design,
            "layers": [
                design["layers"][0],
                *[
                    {**design["layers"][1], "id": f"sticker-{index}"}
                    for index in range(13)
                ],
            ],
        },
        lambda design: {
            **design,
            "layers": [
                design["layers"][0],
                *[
                    {**design["layers"][1], "id": f"sticker-{index}"}
                    for index in range(20)
                ],
            ],
        },
        lambda design: {
            **design,
            "layers": [
                {**design["layers"][0], "id": f"text-{index}", "text": "가" * 31}
                for index in range(6)
            ],
        },
        lambda design: {
            **design,
            "layers": [
                {**design["layers"][0], "id": "duplicate"},
                {**design["layers"][1], "id": "duplicate"},
            ],
        },
    ],
)
def test_design_v1_rejects_non_whitelisted_or_over_budget_documents(memory_api_client, mutate):
    client, _, _, _ = memory_api_client
    payload = memory_payload(design=mutate(design_v1()))
    payload.pop("body")
    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )
    assert response.status_code == 422
    assert client.get("/api/memory-rooms/prometheus").json()["memory_count"] == 0


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("test@example.com 로 연락해요", "personal_information"),
        ("010-1234-5678", "personal_information"),
        ("자.살하고 싶어요", "crisis"),
        ("씨 발", "profanity"),
    ],
)
def test_design_text_uses_existing_public_content_moderation(memory_api_client, text, code):
    client, _, _, _ = memory_api_client
    payload = memory_payload(design=design_v1(first_text=text, second_text="기억"))
    payload.pop("body")
    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


def test_design_moderation_cannot_be_bypassed_by_splitting_text_between_layers(memory_api_client):
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v1(first_text="test@", second_text="example.com"),
    )
    payload.pop("body")
    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "personal_information"


def test_design_text_budget_is_rechecked_after_unicode_normalization(memory_api_client):
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v1(first_text="㍿" * 60, second_text="기억"),
    )
    payload.pop("body")
    response = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "design_text_too_long"


def test_idempotency_fields_are_optional_as_a_pair_for_legacy_compatibility(memory_api_client):
    client, _, _, _ = memory_api_client
    only_request_id = create_memory(
        client,
        client_request_id=IDEMPOTENT_REQUEST,
    )
    only_owner = create_memory(
        client,
        ownership_token=IDEMPOTENT_OWNER,
    )
    assert only_request_id.status_code == 422
    assert only_owner.status_code == 422
    assert create_memory(client, body="기존 방식은 그대로 동작해요").status_code == 201


@pytest.mark.parametrize(
    "surface_id",
    [
        "floor.interior",
        "wall.interior.north",
        "wall.interior.west",
        "wall.interior.east",
    ],
)
def test_relocation_supports_every_interior_surface_for_legacy_memories(
    memory_api_client,
    surface_id,
):
    client, _, _, _ = memory_api_client
    created = create_memory(client, body="교환권으로 옮길 예전 방식의 추억").json()
    safe_u = {
        "floor.interior": 0.73,
        "wall.interior.north": 0.75,
        "wall.interior.west": 0.73,
        "wall.interior.east": 0.65,
    }[surface_id]

    response = relocate_memory(
        client,
        created,
        surface_id=surface_id,
        u=safe_u,
        v=0.71,
        rotation_deg=0,
        scale=1,
    )

    assert response.status_code == 200
    memory = response.json()
    assert memory["body"] == "교환권으로 옮길 예전 방식의 추억"
    assert "design" not in memory
    assert memory["version"] == 2
    assert memory["placement"] == {
        "surface_id": surface_id,
        "u": safe_u,
        "v": 0.71,
        "rotation_deg": 0.0,
        "scale": 1.0,
        "z_index": 1,
        "version": 2,
    }


def test_relocation_preserves_v2_design_and_assigns_server_z(memory_api_client):
    client, _, _, _ = memory_api_client
    payload = memory_payload(
        design=design_v2(template_id="sage-grid-v1", signature="다정한 산책자"),
    )
    payload.pop("body")
    created = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    ).json()

    response = relocate_memory(
        client,
        created,
        surface_id="wall.interior.east",
        u=0.59,
        v=0.708,
        rotation_deg=0,
        scale=1,
    )

    assert response.status_code == 200
    assert response.json()["design"] == created["memory"]["design"]
    assert response.json()["placement"]["z_index"] == 1
    assert response.json()["placement"]["version"] == 2


@pytest.mark.parametrize(
    "overrides",
    [
        {"z_index": 4},
        {"unexpected": True},
        {"surface_id": "wall.north"},
        {"surface_id": "desk.main"},
        {"client_request_id": "not-a-uuid"},
    ],
)
def test_relocation_request_is_strict_and_never_accepts_client_z(
    memory_api_client,
    overrides,
):
    client, _, _, _ = memory_api_client
    created = create_memory(client).json()

    response = relocate_memory(client, created, **overrides)

    assert response.status_code == 422
    assert client.get(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}"
    ).json()["placement"]["version"] == 1


def test_relocation_rejects_a_card_that_would_cross_surface_edges(memory_api_client):
    client, _, _, _ = memory_api_client
    created = create_memory(client).json()

    response = relocate_memory(
        client,
        created,
        surface_id="wall.interior.north",
        u=0,
        v=0.5,
        rotation_deg=0,
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "placement_bounds"
    current = client.get(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}"
    ).json()
    assert current["placement"]["version"] == 1


def test_relocation_checks_ownership_and_optimistic_version(memory_api_client):
    client, _, _, path = memory_api_client
    created = create_memory(client).json()

    missing_owner = client.post(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}/relocations",
        json={
            "client_request_id": RELOCATION_REQUEST,
            "expected_version": 1,
            "surface_id": "floor.interior",
            "u": 0.5,
            "v": 0.5,
            "rotation_deg": 0,
            "scale": 1,
        },
        headers=VISITOR,
    )
    forbidden = relocate_memory(
        client,
        created,
        ownership_token="wrong-owner-token-1234567890",
    )

    assert missing_owner.status_code == 422
    assert forbidden.status_code == 403
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_relocation_requests"
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'move'"
        ).fetchone()[0] == 0

    moved = relocate_memory(client, created)
    stale = relocate_memory(
        client,
        created,
        client_request_id="018fc2a4-7b2d-7a31-90f8-0d9ca951c8b5",
        expected_version=1,
        surface_id="wall.interior.west",
    )

    assert moved.status_code == 200
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_version"] == 2


def test_relocation_retry_is_idempotent_without_extra_rate_or_revision(memory_api_client):
    client, _, _, path = memory_api_client
    created = create_memory(client).json()

    first = relocate_memory(client, created)
    retry = relocate_memory(client, created)

    assert first.status_code == retry.status_code == 200
    assert retry.json() == first.json()
    with sqlite3.connect(path) as connection:
        room_revision = connection.execute(
            "SELECT revision FROM memory_rooms WHERE slug = 'prometheus'"
        ).fetchone()[0]
        placement_version = connection.execute(
            "SELECT version FROM memory_placements WHERE entry_id = ?",
            (created["memory"]["id"],),
        ).fetchone()[0]
        relocation = connection.execute(
            """
            SELECT client_request_id, expected_version, result_version,
                   LENGTH(request_fingerprint), LENGTH(actor_hash)
            FROM memory_relocation_requests
            """
        ).fetchone()
        move_events = connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'move'"
        ).fetchone()[0]
    assert room_revision == 2
    assert placement_version == 2
    assert relocation == (RELOCATION_REQUEST, 1, 2, 64, 64)
    assert move_events == 1


def test_relocation_request_id_cannot_be_reused_for_another_target(memory_api_client):
    client, _, _, _ = memory_api_client
    created = create_memory(client).json()
    first = relocate_memory(client, created)

    changed = relocate_memory(client, created, u=0.2)
    wrong_owner_replay = relocate_memory(
        client,
        created,
        ownership_token="another-wrong-owner-token-123456789",
    )

    assert first.status_code == 200
    assert changed.status_code == 409
    assert changed.json()["detail"]["current_version"] == 2
    assert wrong_owner_replay.status_code == 403


def test_relocation_retry_after_a_later_move_reports_current_version(memory_api_client):
    client, _, _, _ = memory_api_client
    created = create_memory(client).json()
    first = relocate_memory(client, created)
    assert first.status_code == 200
    owner_headers = {
        "X-Ownership-Token": created["ownership_token"],
        **VISITOR,
    }
    later = client.patch(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}/placement",
        json={
            "surface_id": "desk.main",
            "u": 0.1,
            "v": 0.2,
            "rotation_deg": 0,
            "scale": 1,
            "z_index": 77,
            "expected_version": 2,
        },
        headers=owner_headers,
    )
    replay = relocate_memory(client, created)

    assert later.status_code == 200
    assert replay.status_code == 409
    assert replay.json()["detail"]["current_version"] == 3


def test_concurrent_identical_relocations_commit_once(memory_api_client):
    client, _, _, path = memory_api_client
    created = create_memory(client).json()

    def submit() -> tuple[int, dict]:
        response = relocate_memory(client, created)
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))

    assert [status for status, _ in results] == [200, 200]
    assert results[0][1] == results[1][1]
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_relocation_requests"
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'move'"
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT revision FROM memory_rooms WHERE slug = 'prometheus'"
        ).fetchone()[0] == 2


def test_concurrent_distinct_relocations_with_same_version_conflict(memory_api_client):
    client, _, _, path = memory_api_client
    created = create_memory(client).json()

    def submit(request_id: str) -> tuple[int, dict]:
        response = relocate_memory(
            client,
            created,
            client_request_id=request_id,
        )
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, [
            "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b5",
            "018fc2a4-7b2d-7a31-90f8-0d9ca951c8b6",
        ]))

    assert sorted(status for status, _ in results) == [200, 409]
    conflict = next(body for status, body in results if status == 409)
    assert conflict["detail"]["current_version"] == 2
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_relocation_requests"
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT version FROM memory_placements WHERE entry_id = ?",
            (created["memory"]["id"],),
        ).fetchone()[0] == 2


def test_relocation_z_is_monotonic_across_all_persistent_memories(memory_api_client):
    client, _, _, path = memory_api_client
    baseline = create_memory(client, body="먼저 벽으로 옮길 레거시 카드").json()
    first = create_memory(client, body="첫 번째 교환권").json()
    second = create_memory(client, body="두 번째 교환권").json()

    baseline_move = relocate_memory(
        client,
        baseline,
        surface_id="wall.interior.north",
        u=0.75,
        v=0.71,
        rotation_deg=0,
        scale=1,
    )
    first_move = relocate_memory(
        client,
        first,
        surface_id="wall.interior.north",
        u=0.75,
        v=0.71,
        rotation_deg=0,
        scale=1,
    )
    second_move = relocate_memory(
        client,
        second,
        client_request_id="018fc2a4-7b2d-7a31-90f8-0d9ca951c8b5",
        surface_id="wall.interior.north",
        u=0.75,
        v=0.71,
        rotation_deg=0,
        scale=1,
    )

    assert baseline_move.json()["placement"]["z_index"] == 1
    assert first_move.json()["placement"]["z_index"] == 2
    assert second_move.json()["placement"]["z_index"] == 3
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            """
            SELECT z_index FROM memory_placements
            WHERE surface_id = 'wall.interior.north'
            ORDER BY z_index
            """
        ).fetchall() == [(1,), (2,), (3,)]


def test_relocation_rejects_full_surface_without_consuming_state(memory_api_client):
    client, _, _, path = memory_api_client
    full = create_memory(client, body="맨 위에 있는 카드").json()
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            UPDATE memory_placements
            SET surface_id = 'wall.interior.east', z_index = 1000
            WHERE entry_id = ?
            """,
            (full["memory"]["id"],),
        )
    created = create_memory(client, body="옮기려는 카드").json()

    response = relocate_memory(
        client,
        created,
        surface_id="wall.interior.east",
        rotation_deg=0,
    )

    assert response.status_code == 409
    assert response.json()["detail"]["current_version"] == 1
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT revision FROM memory_rooms WHERE slug = 'prometheus'"
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_relocation_requests"
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_rate_events WHERE action = 'move'"
        ).fetchone()[0] == 0


def test_legacy_create_and_patch_cannot_write_relocation_only_walls(memory_api_client):
    client, _, _, _ = memory_api_client
    blocked_create = create_memory(
        client,
        placement={
            **memory_payload()["placement"],
            "surface_id": "wall.interior.north",
            "z_index": 1000,
        },
    )
    created = create_memory(client).json()
    blocked_patch = client.patch(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}/placement",
        json={
            "surface_id": "wall.interior.east",
            "u": 0.5,
            "v": 0.5,
            "rotation_deg": 0,
            "scale": 1,
            "z_index": 1000,
            "expected_version": 1,
        },
        headers={
            "X-Ownership-Token": created["ownership_token"],
            **VISITOR,
        },
    )

    assert blocked_create.status_code == 422
    assert blocked_patch.status_code == 422
    assert client.get(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}"
    ).json()["placement"]["version"] == 1


@pytest.mark.parametrize(
    ("surface_id", "u", "v", "expected_code"),
    [
        (
            "floor.interior",
            (-5.25 + 9.9) / 19.8,
            (8.25 - 5.25) / 16.5,
            "placement_collision",
        ),
        ("floor.interior", 0.5, (8.25 - 6.6) / 16.5, "placement_collision"),
        ("wall.interior.north", 0.5, 0.71, "placement_collision"),
    ],
)
def test_relocation_server_rejects_furniture_entry_and_wall_fixture_overlap(
    memory_api_client,
    surface_id,
    u,
    v,
    expected_code,
):
    client, _, _, _ = memory_api_client
    created = create_memory(client).json()

    response = relocate_memory(
        client,
        created,
        surface_id=surface_id,
        u=u,
        v=v,
        rotation_deg=0,
        scale=1,
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == expected_code
    assert client.get(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}"
    ).json()["placement"]["version"] == 1


def test_stale_relocation_returns_conflict_before_geometry_error(memory_api_client):
    client, _, _, _ = memory_api_client
    created = create_memory(client).json()
    assert relocate_memory(client, created).status_code == 200

    stale = relocate_memory(
        client,
        created,
        client_request_id="018fc2a4-7b2d-7a31-90f8-0d9ca951c8b7",
        expected_version=1,
        surface_id="wall.interior.north",
        u=0,
        v=0,
        rotation_deg=0,
        scale=1,
    )

    assert stale.status_code == 409
    assert stale.json()["detail"]["current_version"] == 2


def test_deleted_top_z_does_not_block_future_relocation(memory_api_client):
    client, _, _, path = memory_api_client
    deleted = create_memory(client, body="삭제할 높은 카드").json()
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            UPDATE memory_placements
            SET surface_id = 'wall.interior.east', z_index = 1000
            WHERE entry_id = ?
            """,
            (deleted["memory"]["id"],),
        )
    assert client.delete(
        f"/api/memory-rooms/prometheus/memories/{deleted['memory']['id']}",
        headers={"X-Ownership-Token": deleted["ownership_token"]},
    ).status_code == 204

    created = create_memory(client, body="새로 옮기는 카드").json()
    moved = relocate_memory(
        client,
        created,
        surface_id="wall.interior.east",
        u=0.6,
        v=0.71,
        rotation_deg=0,
        scale=1,
    )

    assert moved.status_code == 200
    assert moved.json()["placement"]["z_index"] == 1


def test_owner_delete_erases_v2_design_text_and_signature(memory_api_client):
    client, _, _, path = memory_api_client
    payload = memory_payload(
        design=design_v2(signature="지워질 서명"),
    )
    payload.pop("body")
    created = client.post(
        "/api/memory-rooms/prometheus/memories",
        json=payload,
        headers=VISITOR,
    ).json()

    assert client.delete(
        f"/api/memory-rooms/prometheus/memories/{created['memory']['id']}",
        headers={"X-Ownership-Token": created["ownership_token"]},
    ).status_code == 204
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            """
            SELECT body_plaintext, design_json, design_version
            FROM memory_entries WHERE id = ?
            """,
            (created["memory"]["id"],),
        ).fetchone()
    assert row == ("", None, None)


def test_owner_can_move_with_optimistic_version_and_soft_delete(memory_api_client):
    client, _, _, path = memory_api_client
    created = create_memory(client).json()
    memory_id = created["memory"]["id"]
    owner = {"X-Ownership-Token": created["ownership_token"], **VISITOR}
    move = {
        "surface_id": "desk.main",
        "u": 0.8,
        "v": 0.2,
        "rotation_deg": 12,
        "scale": 0.9,
        "z_index": 12,
        "expected_version": 1,
    }

    forbidden = client.patch(
        f"/api/memory-rooms/prometheus/memories/{memory_id}/placement",
        json=move,
        headers={"X-Ownership-Token": "wrong-owner-token-1234567890", **VISITOR},
    )
    assert forbidden.status_code == 403

    moved = client.patch(
        f"/api/memory-rooms/prometheus/memories/{memory_id}/placement",
        json=move,
        headers=owner,
    )
    assert moved.status_code == 200
    assert moved.json()["placement"] == {
        "surface_id": "desk.main",
        "u": 0.8,
        "v": 0.2,
        "rotation_deg": 12.0,
        "scale": 0.9,
        "z_index": 12,
        "version": 2,
    }
    assert moved.json()["version"] == 2

    conflict = client.patch(
        f"/api/memory-rooms/prometheus/memories/{memory_id}/placement",
        json=move,
        headers=owner,
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["current_version"] == 2

    assert client.delete(
        f"/api/memory-rooms/prometheus/memories/{memory_id}",
        headers={"X-Ownership-Token": created["ownership_token"]},
    ).status_code == 204
    assert client.get(f"/api/memory-rooms/prometheus/memories/{memory_id}").status_code == 404
    assert client.get("/api/memory-rooms/prometheus/memories").json()["memories"] == []
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            "SELECT body_plaintext, moderation_status, moderation_reason, deleted_at FROM memory_entries WHERE id = ?",
            (memory_id,),
        ).fetchone()
    assert row[0] == ""
    assert row[1:3] == ("deleted", "owner_deleted")
    assert row[3] is not None


def test_reactions_are_idempotent_and_distinct_reports_auto_hide(memory_api_client):
    client, _, _, path = memory_api_client
    created = create_memory(client).json()
    memory_id = created["memory"]["id"]
    first = client.post(
        f"/api/memory-rooms/prometheus/memories/{memory_id}/reactions",
        headers=VISITOR,
    )
    duplicate = client.post(
        f"/api/memory-rooms/prometheus/memories/{memory_id}/reactions",
        headers=VISITOR,
    )
    assert first.json() == {"memory_id": memory_id, "reaction_count": 1, "reacted": True}
    assert duplicate.json() == {"memory_id": memory_id, "reaction_count": 1, "reacted": False}

    report_path = f"/api/memory-rooms/prometheus/memories/{memory_id}/reports"
    reporter_headers = {"X-Visitor-Token": "reporter-one-token-1234567890"}
    report = client.post(report_path, json={"category": "spam"}, headers=reporter_headers)
    assert report.status_code == 202
    assert report.json()["moderation_status"] == "visible"
    duplicate_report = client.post(report_path, json={"category": "spam"}, headers=reporter_headers)
    assert duplicate_report.status_code == 409

    second = client.post(
        report_path,
        json={"category": "harassment"},
        headers={"X-Visitor-Token": "reporter-two-token-1234567890"},
    )
    third = client.post(
        report_path,
        json={"category": "personal_information"},
        headers={"X-Visitor-Token": "reporter-three-token-1234567890"},
    )
    assert second.json()["report_count"] == 2
    assert third.json()["report_count"] == 3
    assert third.json()["moderation_status"] == "hidden"
    assert client.get(f"/api/memory-rooms/prometheus/memories/{memory_id}").status_code == 404
    assert client.get("/api/memory-rooms/prometheus/memories").json()["memories"] == []

    with sqlite3.connect(path) as connection:
        row = connection.execute(
            "SELECT reaction_count, report_count, moderation_status, moderation_reason FROM memory_entries WHERE id = ?",
            (memory_id,),
        ).fetchone()
        reporters = connection.execute(
            "SELECT reporter_hash FROM memory_reports WHERE entry_id = ?", (memory_id,),
        ).fetchall()
    assert row == (1, 3, "hidden", "report_threshold")
    assert len(reporters) == 3
    assert all(len(item[0]) == 64 for item in reporters)

    deleted = client.delete(
        f"/api/memory-rooms/prometheus/memories/{memory_id}",
        headers={"X-Ownership-Token": created["ownership_token"]},
    )
    assert deleted.status_code == 204
    with sqlite3.connect(path) as connection:
        scrubbed = connection.execute(
            "SELECT body_plaintext, author_alias, moderation_status FROM memory_entries WHERE id = ?",
            (memory_id,),
        ).fetchone()
    assert scrubbed == ("", "떠난 방문자", "deleted")


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ("연락처는 test@example.com 입니다", "personal_information"),
        ("010-1234-5678로 전화해", "personal_information"),
        ("+82 10-1234-5678로 연락해", "personal_information"),
        ("010/1234/5678로 연락해", "personal_information"),
        ("자해하고 싶다는 생각이 들어요", "crisis"),
        ("자.살하고 싶어요", "crisis"),
        ("씨 발 진짜 짜증나", "profanity"),
    ],
)
def test_public_memory_moderation_blocks_sensitive_content(memory_api_client, body, code):
    client, _, _, _ = memory_api_client
    response = create_memory(client, body=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert response.json()["detail"]["safety_bypass"] is (code == "crisis")
    assert client.get("/api/memory-rooms/prometheus").json()["memory_count"] == 0


def test_alias_crisis_and_unknown_counseling_or_file_fields_are_rejected(memory_api_client):
    client, _, _, _ = memory_api_client
    alias = create_memory(client, author_alias="자.살하고 싶어요")
    assert alias.status_code == 422
    assert alias.json()["detail"]["code"] == "crisis"

    transcript = create_memory(client, transcript="상담 원문")
    assert transcript.status_code == 422
    nested_file = create_memory(
        client,
        placement={**memory_payload()["placement"], "photo_url": "https://example.test/photo.png"},
    )
    assert nested_file.status_code == 422


def test_concurrent_duplicate_report_is_conflict_not_integrity_error(memory_api_client):
    client, _, _, _ = memory_api_client
    memory_id = create_memory(client).json()["memory"]["id"]
    path = f"/api/memory-rooms/prometheus/memories/{memory_id}/reports"
    headers = {"X-Visitor-Token": "same-concurrent-reporter-token-1234567890"}

    def submit_report() -> int:
        return client.post(path, json={"category": "spam"}, headers=headers).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda _: submit_report(), range(2)))
    assert statuses == [202, 409]


def test_kind_lengths_coordinates_headers_and_rate_limit_are_enforced(tmp_path, monkeypatch):
    clock = MutableClock(datetime(2026, 7, 22, 3, 0, tzinfo=timezone.utc))
    store = MemoryStore(tmp_path / "rate.sqlite3", clock=clock, create_limit=2, create_window_seconds=60)
    monkeypatch.setattr(memory_api, "memory_store", store)
    client = TestClient(server_module.app)

    assert client.post("/api/memory-rooms/prometheus/memories", json=memory_payload()).status_code == 422
    assert create_memory(client, kind="note", body="가" * 121).status_code == 422
    assert create_memory(client, placement={**memory_payload()["placement"], "u": 1.01}).status_code == 422
    assert create_memory(client, body="첫 번째").status_code == 201
    assert create_memory(client, body="두 번째").status_code == 201
    limited = create_memory(client, body="세 번째")
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) == 60
    clock.value += timedelta(seconds=61)
    assert create_memory(client, body="잠시 쉰 뒤").status_code == 201


def test_cursor_pagination_and_reopening_keep_persistent_data(memory_api_client):
    client, _, clock, path = memory_api_client
    ids = []
    for index in range(3):
        response = create_memory(client, kind="note", body=f"기억 {index}")
        ids.append(response.json()["memory"]["id"])
        clock.value += timedelta(seconds=1)

    first = client.get("/api/memory-rooms/prometheus/memories?limit=2").json()
    assert [memory["id"] for memory in first["memories"]] == [ids[2], ids[1]]
    assert first["next_cursor"]
    second = client.get(
        "/api/memory-rooms/prometheus/memories",
        params={"limit": 2, "cursor": first["next_cursor"]},
    ).json()
    assert [memory["id"] for memory in second["memories"]] == [ids[0]]
    assert second["next_cursor"] is None

    reopened = MemoryStore(path, clock=clock)
    assert reopened.room("prometheus")["memory_count"] == 3
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT version FROM memory_schema_migrations ORDER BY version"
        ).fetchall() == [(1,), (2,), (3,)]


def test_v1_database_is_migrated_in_place_without_changing_legacy_memories(tmp_path):
    path = tmp_path / "legacy-v1.sqlite3"
    now_epoch = datetime(2026, 7, 22, 3, 0, tzinfo=timezone.utc).timestamp()
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            PRAGMA foreign_keys=ON;
            CREATE TABLE memory_schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at REAL NOT NULL
            );
            CREATE TABLE memory_rooms (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                scene_version INTEGER NOT NULL DEFAULT 1,
                theme_id TEXT NOT NULL DEFAULT 'prometheus-coast',
                visibility TEXT NOT NULL DEFAULT 'public',
                revision INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE memory_entries (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES memory_rooms(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('note', 'mood', 'story')),
                body_plaintext TEXT NOT NULL,
                emotion TEXT,
                card_style TEXT NOT NULL,
                author_alias TEXT NOT NULL,
                ownership_token_hash TEXT NOT NULL,
                visibility TEXT NOT NULL DEFAULT 'public',
                moderation_status TEXT NOT NULL DEFAULT 'visible',
                moderation_reason TEXT,
                reaction_count INTEGER NOT NULL DEFAULT 0,
                report_count INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                deleted_at REAL
            );
            CREATE TABLE memory_placements (
                entry_id TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
                surface_id TEXT NOT NULL,
                u REAL NOT NULL,
                v REAL NOT NULL,
                rotation_deg REAL NOT NULL,
                scale REAL NOT NULL,
                z_index INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at REAL NOT NULL
            );
            """
        )
        connection.execute(
            "INSERT INTO memory_schema_migrations(version, applied_at) VALUES (1, ?)",
            (now_epoch,),
        )
        connection.execute(
            """
            INSERT INTO memory_rooms(
                id, slug, title, scene_version, theme_id, visibility,
                revision, created_at, updated_at
            ) VALUES ('legacy-room', 'prometheus', '프로메테우스 추억방', 1,
                      'prometheus-coast', 'public', 1, ?, ?)
            """,
            (now_epoch, now_epoch),
        )
        connection.execute(
            """
            INSERT INTO memory_entries(
                id, room_id, kind, body_plaintext, emotion, card_style,
                author_alias, ownership_token_hash, visibility,
                moderation_status, created_at, updated_at
            ) VALUES ('legacy-memory', 'legacy-room', 'note', '예전 방명록',
                      NULL, 'cream', '고요한 여행자', ?, 'public', 'visible', ?, ?)
            """,
            ("a" * 64, now_epoch, now_epoch),
        )
        connection.execute(
            """
            INSERT INTO memory_placements(
                entry_id, surface_id, u, v, rotation_deg, scale,
                z_index, version, updated_at
            ) VALUES ('legacy-memory', 'floor.center', 0.25, 0.75, -4, 1, 2, 1, ?)
            """,
            (now_epoch,),
        )

    reopened = MemoryStore(path)
    memory = reopened.get("prometheus", "legacy-memory")
    assert memory["body"] == "예전 방명록"
    assert memory["placement"]["surface_id"] == "floor.center"
    assert "design" not in memory

    with sqlite3.connect(path) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(memory_entries)")
        }
        versions = connection.execute(
            "SELECT version FROM memory_schema_migrations ORDER BY version"
        ).fetchall()
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        legacy_v2_values = connection.execute(
            """
            SELECT design_json, design_version, client_request_id,
                   creator_hash, request_fingerprint
            FROM memory_entries WHERE id = 'legacy-memory'
            """
        ).fetchone()
    assert {
        "design_json",
        "design_version",
        "client_request_id",
        "creator_hash",
        "request_fingerprint",
    }.issubset(columns)
    assert versions == [(1,), (2,), (3,)]
    assert "memory_relocation_requests" in tables
    assert legacy_v2_values == (None, None, None, None, None)
