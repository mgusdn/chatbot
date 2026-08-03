"""Persistent, anonymous memories for the Prometheus memory room.

This module owns its own SQLite database and schema.  It never reads from or
writes to counseling experiments, sessions, transcripts, or today's commons.
Public bodies are plain text only; photo/file inputs are intentionally absent.
"""

from __future__ import annotations

import base64
from collections.abc import Callable
from datetime import datetime, timezone
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
from threading import Lock
from typing import Any
import unicodedata
from uuid import UUID, uuid4

from dotenv import load_dotenv
from pydantic import ValidationError

from .memory_schemas import (
    MEMORY_DESIGN_MAX_BYTES,
    MEMORY_DESIGN_MAX_TOTAL_TEXT,
    MEMORY_SIGNATURE_MAX_LENGTH,
    MemoryDesignV1,
    MemoryDesignV2,
)
from .safety import detect_crisis


load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


DEFAULT_ROOM_SLUG = "prometheus"
MEMORY_KINDS = {"note", "mood", "story"}
MEMORY_BODY_LIMITS = {"note": 120, "mood": 80, "story": 500}
MEMORY_EMOTIONS = {"calm", "joy", "tender", "sad", "hope", "tired", None}
MEMORY_CARD_STYLES = {"cream", "sage", "sky", "rose", "lilac"}
MEMORY_SURFACES = {
    "wall.north",
    "wall.west",
    "wall.interior.north",
    "wall.interior.west",
    "wall.interior.east",
    "floor.center",
    "floor.interior",
    "desk.main",
}
MEMORY_RELOCATION_SURFACES = {
    "floor.interior",
    "wall.interior.north",
    "wall.interior.west",
    "wall.interior.east",
}
MEMORY_LEGACY_WRITE_SURFACES = MEMORY_SURFACES - {
    "wall.interior.north",
    "wall.interior.west",
    "wall.interior.east",
}
# Placements remain normalized UV coordinates across the scene expansion.
# Existing cards therefore spread with the larger surfaces; no coordinate
# migration is intentionally performed for this scene revision.
MEMORY_INTERIOR_SIZE = (21.6, 18.0)
MEMORY_RELOCATION_SURFACE_SIZES = {
    "floor.interior": MEMORY_INTERIOR_SIZE,
    "wall.interior.north": (MEMORY_INTERIOR_SIZE[0] - 0.6, 2.85),
    "wall.interior.west": (MEMORY_INTERIOR_SIZE[1] - 0.6, 2.85),
    "wall.interior.east": (MEMORY_INTERIOR_SIZE[1] - 0.6, 2.85),
}
MEMORY_RELOCATION_KIND_SIZES = {
    "note": (0.34, 0.25),
    "mood": (0.3, 0.3),
    "story": (0.44, 0.31),
}
MEMORY_RELOCATION_DESIGN_SIZE = (2.4, 1.5)
MEMORY_RELOCATION_EDGE_CLEARANCE = 0.08
MEMORY_RELOCATION_FLOOR_EDGE_MARGIN = 0.19
MEMORY_RELOCATION_WALL_FIXTURE_CLEARANCE = 0.015
MEMORY_RELOCATION_ENTRY_BOUNDS = (-1.8, 1.8, -9.0, -7.2)


def _floor_fixture(
    fixture_id: str,
    center_x: float,
    center_z: float,
    half_x: float,
    half_z: float,
) -> tuple[str, float, float, float, float]:
    """Convert the scene's X/Z footprint into floor-surface U/-Z bounds."""

    return (
        fixture_id,
        center_x - half_x,
        center_x + half_x,
        -center_z - half_z,
        -center_z + half_z,
    )


MEMORY_RELOCATION_FLOOR_FIXTURES = (
    _floor_fixture("guestbook-worktable", -5.6, 5.3, 1.25, 0.62),
    _floor_fixture("guestbook-chair-north", -5.6, 4.15, 0.36, 0.38),
    _floor_fixture("guestbook-low-shelf", -8.15, 5.0, 0.36, 1.3),
    _floor_fixture("guestbook-notice-board", -7.5, 7.15, 0.58, 0.1),
    _floor_fixture("cowork-table", 4.75, 5.55, 1.3, 0.68),
    _floor_fixture("cowork-chair-north-west", 4.05, 4.48, 0.38, 0.38),
    _floor_fixture("cowork-chair-north-east", 5.45, 4.48, 0.38, 0.38),
    _floor_fixture("cowork-chair-south", 4.75, 6.65, 0.38, 0.38),
    _floor_fixture("cowork-sofa", 8.05, 5.55, 0.5, 1.15),
    _floor_fixture("cowork-floor-lamp", 8.1, 7.15, 0.32, 0.32),
    _floor_fixture("installation-console", 8.1, 3.1, 0.42, 0.42),
    _floor_fixture("library-bookcase-west", -8.0, -0.3, 0.32, 1.7),
    _floor_fixture("library-low-bookcase-west", -8.0, -4.0, 0.34, 1.25),
    _floor_fixture("archive-bookcase", -6.7, -8.52, 1.35, 0.3),
    _floor_fixture("library-worktable", -4.95, -0.15, 1.3, 0.68),
    _floor_fixture("library-chair-south", -4.95, 0.95, 0.36, 0.38),
    _floor_fixture("recovery-bench", 8.05, -1.2, 0.48, 1.05),
    _floor_fixture("recovery-project-table", 5.15, -1.3, 0.8, 0.8),
    _floor_fixture("recovery-chair-north", 5.15, -2.45, 0.38, 0.38),
    _floor_fixture("plant-lab-island", 6.6, -5.5, 1.0, 0.72),
    _floor_fixture("pbao-desk", 0.0, -5.1, 1.65, 0.5),
    _floor_fixture("pbao-chair-west", -2.75, -4.0, 0.4, 0.4),
    _floor_fixture("pbao-chair-east", 2.75, -4.0, 0.4, 0.4),
)
MEMORY_RELOCATION_WALL_FIXTURES = (
    ("today-wall", "wall.interior.north", -2.75, 2.75, -0.84, 1.09),
    ("archive-bookcase", "wall.interior.north", -8.05, -5.35, -1.425, 0.675),
)
MEMORY_REPORT_CATEGORIES = {
    "personal_information", "crisis", "harassment", "spam", "copyright", "other",
}

_ALIAS_ADJECTIVES = (
    "고요한", "다정한", "포근한", "용감한", "느긋한", "반짝이는",
    "푸른", "따뜻한", "산뜻한", "차분한", "수줍은", "든든한",
)
_ALIAS_NOUNS = (
    "여행자", "산책자", "기록자", "별빛", "바람", "파도",
    "구름", "새싹", "조약돌", "등불", "나뭇잎", "우체부",
)
_PROFANITY_TERMS = ("씨발", "시발", "병신", "개새끼", "좆", "꺼져", "지랄")
_PII_PATTERNS = (
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"(?<!\d)(?:(?:\+?82[\s./-]*(?:0)?10)|01[016789]|0\d{1,2})[\s./-]*\d{3,4}[\s./-]*\d{4}(?!\d)"),
    re.compile(r"(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)"),
)
_INVISIBLE_TEXT = re.compile(r"[\u200B-\u200D\u2060\uFEFF]")


def _relocation_rect_intersects_bounds(
    *,
    center_u: float,
    center_v: float,
    half_width: float,
    half_height: float,
    rotation_deg: float,
    bounds: tuple[float, float, float, float],
    clearance: float,
) -> bool:
    """SAT parity with the client-side oriented-rectangle collision check."""

    min_u, max_u, min_v, max_v = bounds
    min_u -= clearance
    max_u += clearance
    min_v -= clearance
    max_v += clearance
    bounds_center_u = (min_u + max_u) / 2
    bounds_center_v = (min_v + max_v) / 2
    bounds_half_u = (max_u - min_u) / 2
    bounds_half_v = (max_v - min_v) / 2
    radians = math.radians(rotation_deg)
    width_axis = (math.cos(radians), math.sin(radians))
    height_axis = (-math.sin(radians), math.cos(radians))
    delta_u = center_u - bounds_center_u
    delta_v = center_v - bounds_center_v
    axes = ((1.0, 0.0), (0.0, 1.0), width_axis, height_axis)

    for axis_u, axis_v in axes:
        center_distance = abs(delta_u * axis_u + delta_v * axis_v)
        rect_radius = (
            half_width * abs(width_axis[0] * axis_u + width_axis[1] * axis_v)
            + half_height * abs(height_axis[0] * axis_u + height_axis[1] * axis_v)
        )
        bounds_radius = bounds_half_u * abs(axis_u) + bounds_half_v * abs(axis_v)
        if center_distance > rect_radius + bounds_radius + 1e-9:
            return False
    return True


class MemoryError(Exception):
    pass


class MemoryRoomNotFound(MemoryError):
    pass


class MemoryNotFound(MemoryError):
    pass


class MemoryOwnershipError(MemoryError):
    pass


class MemoryConflictError(MemoryError):
    def __init__(self, message: str, *, current_version: int | None = None) -> None:
        super().__init__(message)
        self.current_version = current_version


class MemoryRateLimitError(MemoryError):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate limit exceeded")
        self.retry_after = max(1, retry_after)


class MemoryContentRejected(MemoryError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _normalize_public_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = _INVISIBLE_TEXT.sub("", normalized)
    return " ".join(normalized.split()).strip()


def _compact_safety_text(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]", "", value.lower())


def moderate_memory_body(kind: str, body: str) -> str:
    if kind not in MEMORY_KINDS:
        raise ValueError("unknown memory kind")
    normalized = _normalize_public_text(body)
    if not normalized:
        raise MemoryContentRejected("empty", "한 글자 이상 추억을 남겨주세요.")
    limit = MEMORY_BODY_LIMITS[kind]
    if len(normalized) > limit:
        raise MemoryContentRejected("too_long", f"이 추억은 {limit}자 이내로 적어주세요.")
    compact = _compact_safety_text(normalized)
    if detect_crisis(normalized) or detect_crisis(compact):
        raise MemoryContentRejected(
            "crisis",
            "이 내용은 공개하지 않았어요. 지금 위험할 수 있다면 112·119 또는 가까운 응급실에 즉시 도움을 요청해 주세요.",
        )
    if any(pattern.search(normalized) for pattern in _PII_PATTERNS):
        raise MemoryContentRejected(
            "personal_information",
            "전화번호, 이메일, 주민등록번호 등 개인정보는 추억방에 남길 수 없어요.",
        )
    if any(term in compact for term in _PROFANITY_TERMS):
        raise MemoryContentRejected("profanity", "다른 방문자에게 상처가 될 수 있는 표현은 공개할 수 없어요.")
    return normalized


def moderate_memory_alias(alias: str | None) -> str | None:
    if alias is None:
        return None
    normalized = _normalize_public_text(alias)
    if not normalized:
        return None
    if len(normalized) > 24:
        raise MemoryContentRejected("alias_too_long", "별명은 24자 이내로 적어주세요.")
    if any(pattern.search(normalized) for pattern in _PII_PATTERNS):
        raise MemoryContentRejected("personal_information", "별명에는 개인정보를 넣을 수 없어요.")
    compact = _compact_safety_text(normalized)
    if detect_crisis(normalized) or detect_crisis(compact):
        raise MemoryContentRejected("crisis", "위기 내용은 공개 별명으로 사용할 수 없어요.")
    if any(term in compact for term in _PROFANITY_TERMS):
        raise MemoryContentRejected("profanity", "다른 방문자에게 상처가 될 수 있는 별명은 사용할 수 없어요.")
    return normalized


def normalize_memory_design(design: dict) -> tuple[dict, str, str]:
    """Validate and canonicalize a supported design without arbitrary assets.

    The JSON document is the render source of truth, while ``body_plaintext``
    remains a moderated, accessible representation of all visible text.
    """

    try:
        version = design.get("version") if isinstance(design, dict) else None
        design_model = MemoryDesignV1 if version == 1 else MemoryDesignV2
        normalized_design = design_model.model_validate(design).model_dump(mode="json")
    except ValidationError as exc:
        raise MemoryContentRejected("invalid_design", "방명록 디자인 형식이 올바르지 않아요.") from exc

    text_layers = [layer for layer in normalized_design["layers"] if layer["type"] == "text"]
    normalized_texts: list[str] = []
    for layer in text_layers:
        text = moderate_memory_body("story", str(layer["text"]))
        layer["text"] = text
        normalized_texts.append(text)
    signature: str | None = None
    if normalized_design["version"] == 2:
        signature = moderate_memory_alias(normalized_design["signature"])
        normalized_design["signature"] = signature
        if signature is not None and len(signature) > MEMORY_SIGNATURE_MAX_LENGTH:
            raise MemoryContentRejected(
                "signature_too_long",
                f"서명은 {MEMORY_SIGNATURE_MAX_LENGTH}자 이내로 적어주세요.",
            )
    if sum(len(text) for text in normalized_texts) + len(signature or "") > MEMORY_DESIGN_MAX_TOTAL_TEXT:
        raise MemoryContentRejected(
            "design_text_too_long",
            f"방명록 글씨는 모두 합쳐 {MEMORY_DESIGN_MAX_TOTAL_TEXT}자 이내로 적어주세요.",
        )

    # Every supported design requires a text layer. Joining in visual layer
    # order gives the album and assistive technology a deterministic reading.
    body_plaintext = moderate_memory_body("story", " ".join(normalized_texts))
    # Also inspect adjacent layers without separators so distributing an email,
    # phone number, crisis phrase, or profanity across layers cannot bypass the
    # same public-content checks.
    public_texts = [*normalized_texts, *([signature] if signature else [])]
    moderate_memory_body("story", "".join(public_texts))
    design_json = json.dumps(
        normalized_design,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(design_json.encode("utf-8")) > MEMORY_DESIGN_MAX_BYTES:
        raise MemoryContentRejected(
            "design_too_large",
            f"방명록 디자인은 {MEMORY_DESIGN_MAX_BYTES}바이트 이내로 만들어주세요.",
        )
    return normalized_design, design_json, body_plaintext


def _request_fingerprint(payload: dict) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class MemoryStore:
    """SQLite store for one persistent shared room, ready for more rooms later."""

    def __init__(
        self,
        path: str | Path | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
        create_limit: int = 6,
        create_window_seconds: int = 600,
        move_limit: int = 30,
        move_window_seconds: int = 600,
        report_limit: int = 10,
        report_window_seconds: int = 3600,
        reaction_limit: int = 60,
        reaction_window_seconds: int = 3600,
        auto_hide_reports: int | None = None,
    ) -> None:
        configured = path or os.getenv("MEMORY_DB_PATH")
        self.path = Path(configured) if configured else Path(__file__).resolve().parents[1] / "data" / "memories.sqlite3"
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.create_limit = max(1, create_limit)
        self.create_window_seconds = max(1, create_window_seconds)
        self.move_limit = max(1, move_limit)
        self.move_window_seconds = max(1, move_window_seconds)
        self.report_limit = max(1, report_limit)
        self.report_window_seconds = max(1, report_window_seconds)
        self.reaction_limit = max(1, reaction_limit)
        self.reaction_window_seconds = max(1, reaction_window_seconds)
        self.auto_hide_reports = max(3, auto_hide_reports) if auto_hide_reports is not None else None
        self._init_lock = Lock()
        self._initialized = False

    def _now(self) -> datetime:
        value = self.clock()
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            now_epoch = self._now().timestamp()
            with sqlite3.connect(self.path, timeout=5) as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA foreign_keys=ON")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS memory_schema_migrations (
                        version INTEGER PRIMARY KEY,
                        applied_at REAL NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS memory_rooms (
                        id TEXT PRIMARY KEY,
                        slug TEXT NOT NULL UNIQUE,
                        title TEXT NOT NULL,
                        scene_version INTEGER NOT NULL DEFAULT 1,
                        theme_id TEXT NOT NULL DEFAULT 'prometheus-coast',
                        visibility TEXT NOT NULL DEFAULT 'public'
                            CHECK(visibility IN ('public', 'private')),
                        revision INTEGER NOT NULL DEFAULT 0,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS memory_entries (
                        id TEXT PRIMARY KEY,
                        room_id TEXT NOT NULL REFERENCES memory_rooms(id) ON DELETE CASCADE,
                        kind TEXT NOT NULL CHECK(kind IN ('note', 'mood', 'story')),
                        body_plaintext TEXT NOT NULL,
                        emotion TEXT,
                        card_style TEXT NOT NULL,
                        author_alias TEXT NOT NULL,
                        ownership_token_hash TEXT NOT NULL,
                        visibility TEXT NOT NULL DEFAULT 'public'
                            CHECK(visibility IN ('public', 'private')),
                        moderation_status TEXT NOT NULL DEFAULT 'visible'
                            CHECK(moderation_status IN ('visible', 'pending', 'hidden', 'deleted')),
                        moderation_reason TEXT,
                        reaction_count INTEGER NOT NULL DEFAULT 0,
                        report_count INTEGER NOT NULL DEFAULT 0,
                        version INTEGER NOT NULL DEFAULT 1,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        deleted_at REAL
                    );
                    CREATE INDEX IF NOT EXISTS memory_entries_room_feed_idx
                        ON memory_entries(room_id, moderation_status, created_at DESC, id DESC);
                    CREATE TABLE IF NOT EXISTS memory_placements (
                        entry_id TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
                        surface_id TEXT NOT NULL,
                        u REAL NOT NULL CHECK(u >= 0 AND u <= 1),
                        v REAL NOT NULL CHECK(v >= 0 AND v <= 1),
                        rotation_deg REAL NOT NULL CHECK(rotation_deg >= -180 AND rotation_deg <= 180),
                        scale REAL NOT NULL CHECK(scale >= 0.75 AND scale <= 1.35),
                        z_index INTEGER NOT NULL CHECK(z_index >= 0 AND z_index <= 1000),
                        version INTEGER NOT NULL DEFAULT 1,
                        updated_at REAL NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS memory_placements_surface_idx
                        ON memory_placements(surface_id, z_index, entry_id);
                    CREATE TABLE IF NOT EXISTS memory_reactions (
                        entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
                        reactor_hash TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        PRIMARY KEY(entry_id, reactor_hash)
                    );
                    CREATE TABLE IF NOT EXISTS memory_reports (
                        id TEXT PRIMARY KEY,
                        entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
                        reporter_hash TEXT NOT NULL,
                        category TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        UNIQUE(entry_id, reporter_hash)
                    );
                    CREATE INDEX IF NOT EXISTS memory_reports_entry_idx
                        ON memory_reports(entry_id, created_at);
                    CREATE TABLE IF NOT EXISTS memory_rate_events (
                        id TEXT PRIMARY KEY,
                        actor_hash TEXT NOT NULL,
                        action TEXT NOT NULL,
                        created_at REAL NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS memory_rate_events_actor_idx
                        ON memory_rate_events(actor_hash, action, created_at);
                    CREATE INDEX IF NOT EXISTS memory_rate_events_created_idx
                        ON memory_rate_events(created_at);
                    """
                )
                # Serialize additive migrations across workers. Once this lock
                # is held, a second initializer re-reads the post-migration
                # columns instead of racing a duplicate ALTER TABLE.
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "INSERT OR IGNORE INTO memory_schema_migrations(version, applied_at) VALUES (1, ?)",
                    (now_epoch,),
                )
                entry_columns = {
                    str(row[1])
                    for row in connection.execute("PRAGMA table_info(memory_entries)").fetchall()
                }
                v2_columns = {
                    "design_json": "TEXT",
                    "design_version": "INTEGER",
                    "client_request_id": "TEXT",
                    "creator_hash": "TEXT",
                    "request_fingerprint": "TEXT",
                }
                for column, declaration in v2_columns.items():
                    if column not in entry_columns:
                        connection.execute(
                            f"ALTER TABLE memory_entries ADD COLUMN {column} {declaration}"
                        )
                connection.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS memory_entries_idempotency_idx
                    ON memory_entries(room_id, creator_hash, client_request_id)
                    WHERE creator_hash IS NOT NULL AND client_request_id IS NOT NULL
                    """
                )
                connection.execute(
                    "INSERT OR IGNORE INTO memory_schema_migrations(version, applied_at) VALUES (2, ?)",
                    (now_epoch,),
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS memory_relocation_requests (
                        entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
                        client_request_id TEXT NOT NULL,
                        request_fingerprint TEXT NOT NULL,
                        expected_version INTEGER NOT NULL CHECK(expected_version >= 1),
                        result_version INTEGER NOT NULL CHECK(result_version >= 1),
                        actor_hash TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        PRIMARY KEY(entry_id, client_request_id)
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS memory_relocation_requests_created_idx
                    ON memory_relocation_requests(created_at)
                    """
                )
                connection.execute(
                    "INSERT OR IGNORE INTO memory_schema_migrations(version, applied_at) VALUES (3, ?)",
                    (now_epoch,),
                )
                connection.execute(
                    """
                    INSERT OR IGNORE INTO memory_rooms(
                        id, slug, title, scene_version, theme_id, visibility,
                        revision, created_at, updated_at
                    ) VALUES (?, ?, ?, 1, 'prometheus-coast', 'public', 0, ?, ?)
                    """,
                    (uuid4().hex, DEFAULT_ROOM_SLUG, "프로메테우스 추억방", now_epoch, now_epoch),
                )
            self._initialized = True

    def _connect(self) -> sqlite3.Connection:
        self._ensure_initialized()
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _room_row(self, connection: sqlite3.Connection, slug: str) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM memory_rooms WHERE slug = ? AND visibility = 'public'",
            (slug,),
        ).fetchone()
        if row is None:
            raise MemoryRoomNotFound(slug)
        return row

    def _entry_row(self, connection: sqlite3.Connection, room_id: str, entry_id: str) -> sqlite3.Row:
        row = connection.execute(
            """
            SELECT e.*, p.surface_id, p.u, p.v, p.rotation_deg, p.scale,
                   p.z_index, p.version AS placement_version, p.updated_at AS placement_updated_at
            FROM memory_entries e
            JOIN memory_placements p ON p.entry_id = e.id
            WHERE e.room_id = ? AND e.id = ? AND e.visibility = 'public'
                  AND e.moderation_status = 'visible' AND e.deleted_at IS NULL
            """,
            (room_id, entry_id),
        ).fetchone()
        if row is None:
            raise MemoryNotFound(entry_id)
        return row

    def _owned_entry_row(self, connection: sqlite3.Connection, room_id: str, entry_id: str) -> sqlite3.Row:
        row = connection.execute(
            """
            SELECT e.*, p.surface_id, p.u, p.v, p.rotation_deg, p.scale,
                   p.z_index, p.version AS placement_version, p.updated_at AS placement_updated_at
            FROM memory_entries e
            JOIN memory_placements p ON p.entry_id = e.id
            WHERE e.room_id = ? AND e.id = ? AND e.visibility = 'public'
                  AND e.moderation_status != 'deleted' AND e.deleted_at IS NULL
            """,
            (room_id, entry_id),
        ).fetchone()
        if row is None:
            raise MemoryNotFound(entry_id)
        return row

    @staticmethod
    def _iso(epoch: float) -> str:
        return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")

    def _public_room(self, row: sqlite3.Row, *, memory_count: int | None = None) -> dict:
        result = {
            "slug": row["slug"],
            "title": row["title"],
            "scene_version": int(row["scene_version"]),
            "theme_id": row["theme_id"],
            "revision": int(row["revision"]),
        }
        if memory_count is not None:
            result["memory_count"] = memory_count
        return result

    def _public_memory(self, row: sqlite3.Row) -> dict:
        result = {
            "id": row["id"],
            "kind": row["kind"],
            "body": row["body_plaintext"],
            "emotion": row["emotion"],
            "card_style": row["card_style"],
            "author_alias": row["author_alias"],
            "reaction_count": int(row["reaction_count"]),
            "version": int(row["version"]),
            "created_at": self._iso(float(row["created_at"])),
            "updated_at": self._iso(float(row["updated_at"])),
            "placement": {
                "surface_id": row["surface_id"],
                "u": float(row["u"]),
                "v": float(row["v"]),
                "rotation_deg": float(row["rotation_deg"]),
                "scale": float(row["scale"]),
                "z_index": int(row["z_index"]),
                "version": int(row["placement_version"]),
            },
        }
        if "design_json" in row.keys() and row["design_json"]:
            if isinstance(row["design_json"], dict):
                design = row["design_json"]
            else:
                try:
                    design = json.loads(str(row["design_json"]))
                except (TypeError, json.JSONDecodeError):
                    design = None
            if isinstance(design, dict) and design.get("version") in {1, 2}:
                result["design"] = design
        return result

    @staticmethod
    def _actor_hash(room_slug: str, visitor_token: str) -> str:
        return hashlib.sha256(f"memory:{room_slug}:{visitor_token}".encode("utf-8")).hexdigest()

    @staticmethod
    def _creator_hash(room_slug: str, visitor_token: str) -> str:
        return hashlib.sha256(f"memory-creator:{room_slug}:{visitor_token}".encode("utf-8")).hexdigest()

    @staticmethod
    def _owner_hash(ownership_token: str) -> str:
        return hashlib.sha256(ownership_token.encode("utf-8")).hexdigest()

    def _assert_owner(self, row: sqlite3.Row, ownership_token: str) -> None:
        if not hmac.compare_digest(str(row["ownership_token_hash"]), self._owner_hash(ownership_token)):
            raise MemoryOwnershipError(str(row["id"]))

    def _alias(self, room_slug: str, visitor_token: str) -> str:
        digest = hashlib.sha256(f"alias:{room_slug}:{visitor_token}".encode("utf-8")).digest()
        return f"{_ALIAS_ADJECTIVES[digest[0] % len(_ALIAS_ADJECTIVES)]} {_ALIAS_NOUNS[digest[1] % len(_ALIAS_NOUNS)]}"

    def _consume_rate(
        self,
        connection: sqlite3.Connection,
        *,
        actor_hash: str,
        action: str,
        now_epoch: float,
        limit: int,
        window_seconds: int,
    ) -> None:
        cutoff = now_epoch - window_seconds
        connection.execute("DELETE FROM memory_rate_events WHERE created_at < ?", (now_epoch - 86400,))
        rows = connection.execute(
            """
            SELECT created_at FROM memory_rate_events
            WHERE actor_hash = ? AND action = ? AND created_at > ?
            ORDER BY created_at ASC
            """,
            (actor_hash, action, cutoff),
        ).fetchall()
        if len(rows) >= limit:
            retry_after = math.ceil(float(rows[0]["created_at"]) + window_seconds - now_epoch)
            raise MemoryRateLimitError(retry_after)
        connection.execute(
            "INSERT INTO memory_rate_events(id, actor_hash, action, created_at) VALUES (?, ?, ?, ?)",
            (uuid4().hex, actor_hash, action, now_epoch),
        )

    @staticmethod
    def _validate_placement(placement: dict) -> dict:
        surface_id = str(placement["surface_id"])
        u = float(placement["u"])
        v = float(placement["v"])
        rotation_deg = float(placement["rotation_deg"])
        scale = float(placement["scale"])
        z_index = int(placement["z_index"])
        if surface_id not in MEMORY_SURFACES:
            raise ValueError("unknown memory surface")
        if not (0 <= u <= 1 and 0 <= v <= 1):
            raise ValueError("memory placement coordinates must be normalized")
        if not (-180 <= rotation_deg <= 180 and 0.75 <= scale <= 1.35 and 0 <= z_index <= 1000):
            raise ValueError("invalid memory placement transform")
        return {
            "surface_id": surface_id,
            "u": u,
            "v": v,
            "rotation_deg": rotation_deg,
            "scale": scale,
            "z_index": z_index,
        }

    @staticmethod
    def _validate_legacy_placement(placement: dict) -> dict:
        validated = MemoryStore._validate_placement(placement)
        if validated["surface_id"] not in MEMORY_LEGACY_WRITE_SURFACES:
            raise ValueError("relocation surfaces require the relocation endpoint")
        return validated

    @staticmethod
    def _validate_relocation_target(placement: dict) -> dict:
        surface_id = str(placement["surface_id"])
        if surface_id not in MEMORY_RELOCATION_SURFACES:
            raise ValueError("unknown memory relocation surface")
        validated = MemoryStore._validate_placement({
            **placement,
            "surface_id": surface_id,
            "z_index": 0,
        })
        validated.pop("z_index")
        return validated

    @staticmethod
    def _assert_relocation_surface_bounds(
        placement: dict,
        *,
        kind: str,
        designed: bool,
    ) -> None:
        surface_width, surface_height = MEMORY_RELOCATION_SURFACE_SIZES[
            str(placement["surface_id"])
        ]
        if designed:
            base_width, base_height = MEMORY_RELOCATION_DESIGN_SIZE
        else:
            base_width, base_height = MEMORY_RELOCATION_KIND_SIZES[kind]
        scale = float(placement["scale"])
        rotation_deg = float(placement["rotation_deg"])
        if (
            placement["surface_id"] != "floor.interior"
            and abs(rotation_deg) > 1e-9
        ):
            raise MemoryContentRejected(
                "placement_rotation",
                "벽에 붙이는 추억은 글씨가 바로 보이도록 수평으로 놓아주세요.",
            )
        radians = math.radians(rotation_deg)
        half_width = base_width * scale / 2
        half_height = base_height * scale / 2
        projected_half_width = (
            abs(math.cos(radians)) * half_width
            + abs(math.sin(radians)) * half_height
        )
        projected_half_height = (
            abs(math.sin(radians)) * half_width
            + abs(math.cos(radians)) * half_height
        )
        margin = (
            MEMORY_RELOCATION_FLOOR_EDGE_MARGIN
            if placement["surface_id"] == "floor.interior"
            else MEMORY_RELOCATION_EDGE_CLEARANCE
        )
        center_u = (float(placement["u"]) - 0.5) * surface_width
        center_v = (float(placement["v"]) - 0.5) * surface_height
        if (
            abs(center_u) + projected_half_width + margin > surface_width / 2 + 1e-9
            or abs(center_v) + projected_half_height + margin > surface_height / 2 + 1e-9
        ):
            raise MemoryContentRejected(
                "placement_bounds",
                "추억 전체가 선택한 바닥이나 벽 안에 들어오도록 위치를 옮겨주세요.",
            )

        surface_id = str(placement["surface_id"])
        if surface_id == "floor.interior":
            blockers = (
                ("interior-entry-clearance", MEMORY_RELOCATION_ENTRY_BOUNDS),
                *(
                    (fixture_id, (min_u, max_u, min_v, max_v))
                    for fixture_id, min_u, max_u, min_v, max_v
                    in MEMORY_RELOCATION_FLOOR_FIXTURES
                ),
            )
            clearance = MEMORY_RELOCATION_EDGE_CLEARANCE
        else:
            blockers = tuple(
                (fixture_id, (min_u, max_u, min_v, max_v))
                for fixture_id, fixture_surface, min_u, max_u, min_v, max_v
                in MEMORY_RELOCATION_WALL_FIXTURES
                if fixture_surface == surface_id
            )
            clearance = MEMORY_RELOCATION_WALL_FIXTURE_CLEARANCE

        for blocker_id, blocker_bounds in blockers:
            if _relocation_rect_intersects_bounds(
                center_u=center_u,
                center_v=center_v,
                half_width=half_width,
                half_height=half_height,
                rotation_deg=rotation_deg,
                bounds=blocker_bounds,
                clearance=clearance,
            ):
                raise MemoryContentRejected(
                    "placement_collision",
                    f"{blocker_id}와 겹치지 않는 열린 위치를 선택해주세요.",
                )

    @staticmethod
    def _encode_cursor(created_at: float, entry_id: str) -> str:
        payload = json.dumps([created_at, entry_id], separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_cursor(cursor: str) -> tuple[float, str]:
        try:
            raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            value = json.loads(raw)
            if not isinstance(value, list) or len(value) != 2:
                raise ValueError
            return float(value[0]), str(value[1])
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            raise MemoryConflictError("올바르지 않은 페이지 위치입니다.") from exc

    def room(self, slug: str) -> dict:
        with self._connect() as connection:
            room = self._room_row(connection, slug)
            count = int(connection.execute(
                """
                SELECT COUNT(*) FROM memory_entries
                WHERE room_id = ? AND visibility = 'public'
                      AND moderation_status = 'visible' AND deleted_at IS NULL
                """,
                (room["id"],),
            ).fetchone()[0])
        return self._public_room(room, memory_count=count)

    def list(self, slug: str, *, limit: int = 30, cursor: str | None = None, kind: str | None = None) -> dict:
        if kind is not None and kind not in MEMORY_KINDS:
            raise ValueError("unknown memory kind")
        limit = max(1, min(60, int(limit)))
        cursor_values = self._decode_cursor(cursor) if cursor else None
        with self._connect() as connection:
            room = self._room_row(connection, slug)
            conditions = [
                "e.room_id = ?", "e.visibility = 'public'",
                "e.moderation_status = 'visible'", "e.deleted_at IS NULL",
            ]
            params: list[object] = [room["id"]]
            if kind:
                conditions.append("e.kind = ?")
                params.append(kind)
            if cursor_values:
                conditions.append("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))")
                params.extend([cursor_values[0], cursor_values[0], cursor_values[1]])
            params.append(limit + 1)
            rows = connection.execute(
                f"""
                SELECT e.*, p.surface_id, p.u, p.v, p.rotation_deg, p.scale,
                       p.z_index, p.version AS placement_version, p.updated_at AS placement_updated_at
                FROM memory_entries e
                JOIN memory_placements p ON p.entry_id = e.id
                WHERE {' AND '.join(conditions)}
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
            has_more = len(rows) > limit
            visible_rows = rows[:limit]
            next_cursor = (
                self._encode_cursor(float(visible_rows[-1]["created_at"]), str(visible_rows[-1]["id"]))
                if has_more and visible_rows else None
            )
        return {
            "room": self._public_room(room),
            "memories": [self._public_memory(row) for row in visible_rows],
            "next_cursor": next_cursor,
        }

    def get(self, slug: str, entry_id: str) -> dict:
        with self._connect() as connection:
            room = self._room_row(connection, slug)
            row = self._entry_row(connection, str(room["id"]), entry_id)
        return self._public_memory(row)

    def create(
        self,
        slug: str,
        *,
        kind: str,
        body: str | None,
        emotion: str | None,
        card_style: str,
        author_alias: str | None,
        placement: dict,
        visitor_token: str,
        design: dict | None = None,
        client_request_id: str | None = None,
        ownership_token: str | None = None,
    ) -> tuple[dict, str]:
        if (client_request_id is None) != (ownership_token is None):
            raise ValueError("client_request_id and ownership_token must be provided together")
        if client_request_id is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,99}", client_request_id):
            raise ValueError("invalid client request id")
        if ownership_token is not None and not (32 <= len(ownership_token) <= 200):
            raise ValueError("invalid ownership token")

        supplied_body = _normalize_public_text(body) if body is not None else None
        normalized_design: dict | None = None
        design_json: str | None = None
        design_version: int | None = None
        if design is not None:
            normalized_design, design_json, body_plaintext = normalize_memory_design(design)
            design_version = int(normalized_design["version"])
        else:
            if body is None:
                raise MemoryContentRejected("empty", "한 글자 이상 추억을 남겨주세요.")
            body_plaintext = moderate_memory_body(kind, body)

        author_alias = moderate_memory_alias(author_alias)
        if emotion not in MEMORY_EMOTIONS or card_style not in MEMORY_CARD_STYLES:
            raise ValueError("unknown memory appearance")
        requested_surface_id = str(placement["surface_id"])
        uses_walk_up_surface = (
            normalized_design is not None
            and requested_surface_id in MEMORY_RELOCATION_SURFACES
        )
        placement = (
            self._validate_placement(placement)
            if uses_walk_up_surface
            else self._validate_legacy_placement(placement)
        )
        request_fingerprint = _request_fingerprint({
            "kind": kind,
            "body": supplied_body,
            "emotion": emotion,
            "card_style": card_style,
            "author_alias": author_alias,
            "placement": placement,
            "design": normalized_design,
        })
        now_epoch = self._now().timestamp()
        creator_hash = self._creator_hash(slug, visitor_token)
        resolved_ownership_token = ownership_token or secrets.token_urlsafe(32)
        entry_id = uuid4().hex
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            room = self._room_row(connection, slug)
            if client_request_id is not None:
                existing = connection.execute(
                    """
                    SELECT e.*, p.surface_id, p.u, p.v, p.rotation_deg, p.scale,
                           p.z_index, p.version AS placement_version,
                           p.updated_at AS placement_updated_at
                    FROM memory_entries e
                    JOIN memory_placements p ON p.entry_id = e.id
                    WHERE e.room_id = ? AND e.creator_hash = ? AND e.client_request_id = ?
                    """,
                    (room["id"], creator_hash, client_request_id),
                ).fetchone()
                if existing is not None:
                    if not hmac.compare_digest(
                        str(existing["request_fingerprint"] or ""),
                        request_fingerprint,
                    ):
                        raise MemoryConflictError(
                            "이미 다른 내용에 사용한 방명록 요청 번호예요."
                        )
                    self._assert_owner(existing, resolved_ownership_token)
                    if (
                        existing["visibility"] != "public"
                        or existing["moderation_status"] != "visible"
                        or existing["deleted_at"] is not None
                    ):
                        raise MemoryConflictError(
                            "이미 처리된 방명록 요청 번호는 다시 사용할 수 없어요."
                        )
                    return self._public_memory(existing), resolved_ownership_token

            if uses_walk_up_surface:
                self._assert_relocation_surface_bounds(
                    placement,
                    kind=kind,
                    designed=True,
                )
                highest_surface_z = int(connection.execute(
                    """
                    SELECT COALESCE(MAX(p.z_index), 0)
                    FROM memory_placements p
                    JOIN memory_entries e ON e.id = p.entry_id
                    WHERE e.room_id = ? AND p.surface_id = ?
                          AND e.visibility = 'public'
                          AND e.moderation_status = 'visible'
                          AND e.deleted_at IS NULL
                    """,
                    (room["id"], placement["surface_id"]),
                ).fetchone()[0])
                if highest_surface_z >= 1000:
                    raise MemoryConflictError(
                        "선택한 공간의 방명록 배치 순번이 가득 찼어요."
                    )
                # The request fingerprint intentionally retains the client
                # payload, but the persisted stacking order is allocated only
                # after the idempotency lookup while holding BEGIN IMMEDIATE.
                # A retry therefore returns the original row without consuming
                # another z-index, and concurrent creates receive unique values.
                placement = {**placement, "z_index": highest_surface_z + 1}

            self._consume_rate(
                connection,
                actor_hash=self._actor_hash(slug, visitor_token),
                action="create",
                now_epoch=now_epoch,
                limit=self.create_limit,
                window_seconds=self.create_window_seconds,
            )
            connection.execute(
                """
                INSERT INTO memory_entries(
                    id, room_id, kind, body_plaintext, emotion, card_style,
                    author_alias, ownership_token_hash, visibility,
                    moderation_status, created_at, updated_at, design_json,
                    design_version, client_request_id, creator_hash,
                    request_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', 'visible', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry_id, room["id"], kind, body_plaintext, emotion, card_style,
                    author_alias or self._alias(slug, visitor_token),
                    self._owner_hash(resolved_ownership_token), now_epoch, now_epoch,
                    design_json, design_version, client_request_id, creator_hash,
                    request_fingerprint,
                ),
            )
            connection.execute(
                """
                INSERT INTO memory_placements(
                    entry_id, surface_id, u, v, rotation_deg, scale,
                    z_index, version, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    entry_id, placement["surface_id"], placement["u"], placement["v"],
                    placement["rotation_deg"], placement["scale"], placement["z_index"], now_epoch,
                ),
            )
            connection.execute(
                "UPDATE memory_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?",
                (now_epoch, room["id"]),
            )
            row = self._entry_row(connection, str(room["id"]), entry_id)
        return self._public_memory(row), resolved_ownership_token

    def move(
        self,
        slug: str,
        entry_id: str,
        *,
        placement: dict,
        expected_version: int,
        ownership_token: str,
        visitor_token: str,
    ) -> dict:
        placement = self._validate_legacy_placement(placement)
        now_epoch = self._now().timestamp()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            room = self._room_row(connection, slug)
            row = self._entry_row(connection, str(room["id"]), entry_id)
            self._assert_owner(row, ownership_token)
            current_version = int(row["placement_version"])
            if current_version != expected_version:
                raise MemoryConflictError("다른 곳에서 위치가 변경되었어요. 새로고침 후 다시 시도해주세요.", current_version=current_version)
            self._consume_rate(
                connection,
                actor_hash=self._actor_hash(slug, visitor_token),
                action="move",
                now_epoch=now_epoch,
                limit=self.move_limit,
                window_seconds=self.move_window_seconds,
            )
            cursor = connection.execute(
                """
                UPDATE memory_placements
                SET surface_id = ?, u = ?, v = ?, rotation_deg = ?, scale = ?,
                    z_index = ?, version = version + 1, updated_at = ?
                WHERE entry_id = ? AND version = ?
                """,
                (
                    placement["surface_id"], placement["u"], placement["v"],
                    placement["rotation_deg"], placement["scale"], placement["z_index"],
                    now_epoch, entry_id, expected_version,
                ),
            )
            if cursor.rowcount != 1:
                latest = connection.execute(
                    "SELECT version FROM memory_placements WHERE entry_id = ?", (entry_id,),
                ).fetchone()
                raise MemoryConflictError(
                    "다른 곳에서 위치가 변경되었어요. 새로고침 후 다시 시도해주세요.",
                    current_version=int(latest["version"]) if latest else None,
                )
            connection.execute(
                "UPDATE memory_entries SET version = version + 1, updated_at = ? WHERE id = ?",
                (now_epoch, entry_id),
            )
            connection.execute(
                "UPDATE memory_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?",
                (now_epoch, room["id"]),
            )
            updated = self._entry_row(connection, str(room["id"]), entry_id)
        return self._public_memory(updated)

    def relocate(
        self,
        slug: str,
        entry_id: str,
        *,
        client_request_id: str,
        expected_version: int,
        placement: dict,
        ownership_token: str,
        visitor_token: str,
    ) -> dict:
        """Idempotently place any owned memory on an interior room surface.

        Unlike the legacy PATCH endpoint, callers cannot choose ``z_index``.
        The destination stacking order and all version/revision changes are
        allocated while holding one SQLite write transaction.
        """

        try:
            normalized_request_id = str(UUID(str(client_request_id)))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValueError("invalid relocation request id") from exc
        expected_version = int(expected_version)
        if expected_version < 1:
            raise ValueError("expected version must be positive")
        placement = self._validate_relocation_target(placement)
        request_fingerprint = _request_fingerprint({
            "expected_version": expected_version,
            **placement,
        })
        now_epoch = self._now().timestamp()
        actor_hash = self._actor_hash(slug, visitor_token)

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            room = self._room_row(connection, slug)
            row = self._entry_row(connection, str(room["id"]), entry_id)
            # Ownership is checked before reading an idempotency result so a
            # request UUID never becomes a capability for another visitor.
            self._assert_owner(row, ownership_token)
            current_version = int(row["placement_version"])

            previous = connection.execute(
                """
                SELECT request_fingerprint, result_version
                FROM memory_relocation_requests
                WHERE entry_id = ? AND client_request_id = ?
                """,
                (entry_id, normalized_request_id),
            ).fetchone()
            if previous is not None:
                if not hmac.compare_digest(
                    str(previous["request_fingerprint"]),
                    request_fingerprint,
                ):
                    raise MemoryConflictError(
                        "이미 다른 위치에 사용한 방명록 이동 요청 번호예요.",
                        current_version=current_version,
                    )
                if current_version != int(previous["result_version"]):
                    raise MemoryConflictError(
                        "요청 이후 위치가 다시 변경되었어요. 새 위치에서 다시 시도해주세요.",
                        current_version=current_version,
                    )
                return self._public_memory(row)

            if current_version != expected_version:
                raise MemoryConflictError(
                    "다른 곳에서 위치가 변경되었어요. 새로고침 후 다시 시도해주세요.",
                    current_version=current_version,
                )
            self._assert_relocation_surface_bounds(
                placement,
                kind=str(row["kind"]),
                designed=row["design_version"] is not None,
            )

            highest_surface_z = int(connection.execute(
                """
                SELECT COALESCE(MAX(p.z_index), 0)
                FROM memory_placements p
                JOIN memory_entries e ON e.id = p.entry_id
                WHERE e.room_id = ? AND p.surface_id = ?
                      AND e.visibility = 'public'
                      AND e.moderation_status = 'visible'
                      AND e.deleted_at IS NULL
                """,
                (room["id"], placement["surface_id"]),
            ).fetchone()[0])
            if highest_surface_z >= 1000:
                raise MemoryConflictError(
                    "선택한 공간의 방명록 배치 순번이 가득 찼어요.",
                    current_version=current_version,
                )
            assigned_z = highest_surface_z + 1

            self._consume_rate(
                connection,
                actor_hash=actor_hash,
                action="move",
                now_epoch=now_epoch,
                limit=self.move_limit,
                window_seconds=self.move_window_seconds,
            )
            cursor = connection.execute(
                """
                UPDATE memory_placements
                SET surface_id = ?, u = ?, v = ?, rotation_deg = ?, scale = ?,
                    z_index = ?, version = version + 1, updated_at = ?
                WHERE entry_id = ? AND version = ?
                """,
                (
                    placement["surface_id"], placement["u"], placement["v"],
                    placement["rotation_deg"], placement["scale"], assigned_z,
                    now_epoch, entry_id, expected_version,
                ),
            )
            if cursor.rowcount != 1:
                latest = connection.execute(
                    "SELECT version FROM memory_placements WHERE entry_id = ?",
                    (entry_id,),
                ).fetchone()
                raise MemoryConflictError(
                    "다른 곳에서 위치가 변경되었어요. 새로고침 후 다시 시도해주세요.",
                    current_version=int(latest["version"]) if latest else None,
                )
            connection.execute(
                "UPDATE memory_entries SET version = version + 1, updated_at = ? WHERE id = ?",
                (now_epoch, entry_id),
            )
            connection.execute(
                "UPDATE memory_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?",
                (now_epoch, room["id"]),
            )
            result_version = expected_version + 1
            connection.execute(
                """
                INSERT INTO memory_relocation_requests(
                    entry_id, client_request_id, request_fingerprint,
                    expected_version, result_version, actor_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry_id, normalized_request_id, request_fingerprint,
                    expected_version, result_version, actor_hash, now_epoch,
                ),
            )
            updated = self._entry_row(connection, str(room["id"]), entry_id)
        return self._public_memory(updated)

    def delete(self, slug: str, entry_id: str, ownership_token: str) -> None:
        now_epoch = self._now().timestamp()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            room = self._room_row(connection, slug)
            row = self._owned_entry_row(connection, str(room["id"]), entry_id)
            self._assert_owner(row, ownership_token)
            connection.execute(
                """
                UPDATE memory_entries
                SET body_plaintext = '', design_json = NULL, design_version = NULL,
                    author_alias = '떠난 방문자',
                    moderation_status = 'deleted', moderation_reason = 'owner_deleted',
                    deleted_at = ?, updated_at = ?, version = version + 1
                WHERE id = ?
                """,
                (now_epoch, now_epoch, entry_id),
            )
            connection.execute(
                "UPDATE memory_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?",
                (now_epoch, room["id"]),
            )

    def react(self, slug: str, entry_id: str, visitor_token: str) -> dict:
        now_epoch = self._now().timestamp()
        reactor_hash = hashlib.sha256(f"reaction:{entry_id}:{visitor_token}".encode("utf-8")).hexdigest()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            room = self._room_row(connection, slug)
            self._entry_row(connection, str(room["id"]), entry_id)
            cursor = connection.execute(
                "INSERT OR IGNORE INTO memory_reactions(entry_id, reactor_hash, created_at) VALUES (?, ?, ?)",
                (entry_id, reactor_hash, now_epoch),
            )
            reacted = cursor.rowcount == 1
            if reacted:
                self._consume_rate(
                    connection,
                    actor_hash=self._actor_hash(slug, visitor_token),
                    action="reaction",
                    now_epoch=now_epoch,
                    limit=self.reaction_limit,
                    window_seconds=self.reaction_window_seconds,
                )
                connection.execute(
                    "UPDATE memory_entries SET reaction_count = reaction_count + 1, updated_at = ? WHERE id = ?",
                    (now_epoch, entry_id),
                )
                connection.execute(
                    "UPDATE memory_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?",
                    (now_epoch, room["id"]),
                )
            count = int(connection.execute(
                "SELECT reaction_count FROM memory_entries WHERE id = ?", (entry_id,),
            ).fetchone()[0])
        return {"memory_id": entry_id, "reaction_count": count, "reacted": reacted}

    def report(self, slug: str, entry_id: str, category: str, visitor_token: str) -> dict:
        if category not in MEMORY_REPORT_CATEGORIES:
            raise ValueError("unknown report category")
        now_epoch = self._now().timestamp()
        reporter_hash = hashlib.sha256(f"report:{entry_id}:{visitor_token}".encode("utf-8")).hexdigest()
        actor_hash = self._actor_hash(slug, visitor_token)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            room = self._room_row(connection, slug)
            self._entry_row(connection, str(room["id"]), entry_id)
            duplicate = connection.execute(
                "SELECT 1 FROM memory_reports WHERE entry_id = ? AND reporter_hash = ?",
                (entry_id, reporter_hash),
            ).fetchone()
            if duplicate:
                raise MemoryConflictError("이미 신고한 추억이에요.")
            self._consume_rate(
                connection,
                actor_hash=actor_hash,
                action="report",
                now_epoch=now_epoch,
                limit=self.report_limit,
                window_seconds=self.report_window_seconds,
            )
            connection.execute(
                """
                INSERT INTO memory_reports(id, entry_id, reporter_hash, category, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (uuid4().hex, entry_id, reporter_hash, category, now_epoch),
            )
            connection.execute(
                "UPDATE memory_entries SET report_count = report_count + 1, updated_at = ? WHERE id = ?",
                (now_epoch, entry_id),
            )
            count = int(connection.execute(
                "SELECT report_count FROM memory_entries WHERE id = ?", (entry_id,),
            ).fetchone()[0])
            status = "visible"
            if self.auto_hide_reports is not None and count >= self.auto_hide_reports:
                status = "hidden"
                connection.execute(
                    """
                    UPDATE memory_entries
                    SET moderation_status = 'hidden', moderation_reason = 'report_threshold',
                        updated_at = ?, version = version + 1
                    WHERE id = ?
                    """,
                    (now_epoch, entry_id),
                )
            connection.execute(
                "UPDATE memory_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?",
                (now_epoch, room["id"]),
            )
        return {
            "memory_id": entry_id,
            "reported": True,
            "report_count": count,
            "moderation_status": status,
        }


class _PostgresRow:
    """Small sqlite3.Row-compatible adapter for the shared store logic."""

    def __init__(self, columns: tuple[str, ...], values: tuple[Any, ...]) -> None:
        self._columns = columns
        self._values = values
        self._by_name = dict(zip(columns, values, strict=True))

    def __getitem__(self, key: int | str) -> Any:
        return self._values[key] if isinstance(key, int) else self._by_name[key]

    def keys(self) -> tuple[str, ...]:
        return self._columns


class _PostgresCursor:
    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return int(self._cursor.rowcount)

    def _adapt(self, row: tuple[Any, ...] | None) -> _PostgresRow | None:
        if row is None:
            return None
        columns = tuple(column.name for column in (self._cursor.description or ()))
        return _PostgresRow(columns, tuple(row))

    def fetchone(self) -> _PostgresRow | None:
        return self._adapt(self._cursor.fetchone())

    def fetchall(self) -> list[_PostgresRow]:
        return [row for value in self._cursor.fetchall() if (row := self._adapt(value)) is not None]


class _PostgresConnection:
    """Translate the intentionally small SQLite SQL subset used by MemoryStore."""

    _WRITE_LOCK_ID = 7_196_021_027

    def __init__(self, connection: Any) -> None:
        self._connection = connection

    @staticmethod
    def _translate(query: str) -> str:
        translated = query.replace("?", "%s")
        if "INSERT OR IGNORE INTO memory_reactions" in translated:
            translated = translated.replace(
                "INSERT OR IGNORE INTO memory_reactions(entry_id, reactor_hash, created_at) VALUES (%s, %s, %s)",
                "INSERT INTO memory_reactions(entry_id, reactor_hash, created_at) "
                "VALUES (%s, %s, %s) ON CONFLICT (entry_id, reactor_hash) DO NOTHING",
            )
        return translated

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> _PostgresCursor:
        if query.strip().upper() == "BEGIN IMMEDIATE":
            cursor = self._connection.execute("BEGIN")
            self._connection.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                (self._WRITE_LOCK_ID,),
            )
            return _PostgresCursor(cursor)
        return _PostgresCursor(self._connection.execute(self._translate(query), params))


class _PostgresConnectionContext:
    def __init__(self, pool: Any) -> None:
        self._pool_context = pool.connection()
        self._connection: Any | None = None

    def __enter__(self) -> _PostgresConnection:
        self._connection = self._pool_context.__enter__()
        return _PostgresConnection(self._connection)

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool | None:
        return self._pool_context.__exit__(exc_type, exc, traceback)


class PostgresMemoryStore(MemoryStore):
    """PostgreSQL-backed store retaining the audited MemoryStore contract.

    SQLite's BEGIN IMMEDIATE serializes every write. The adapter takes one
    transaction-scoped PostgreSQL advisory lock for the same correctness-first
    behavior, including unique surface z-index allocation and rate limiting.
    """

    def __init__(self, database_url: str, **kwargs: Any) -> None:
        if not database_url.strip():
            raise RuntimeError("DATABASE_URL is required for the PostgreSQL memory store")
        super().__init__(path=Path("/private/tmp/pume-postgres-memory-store"), **kwargs)
        from psycopg_pool import ConnectionPool

        normalized_url = database_url.strip().strip('"').strip("'")
        if "sslmode=" not in normalized_url:
            normalized_url += ("&" if "?" in normalized_url else "?") + "sslmode=require"

        def configure(connection: Any) -> None:
            connection.execute("SET search_path TO pume, public")
            connection.commit()

        self._pool = ConnectionPool(
            conninfo=normalized_url,
            min_size=1,
            max_size=5,
            timeout=10,
            configure=configure,
            open=True,
        )
        self._initialized = True

    def _ensure_initialized(self) -> None:
        # Schema changes are versioned in supabase/migrations and must never be
        # performed implicitly by a web worker at import time.
        return

    def _connect(self) -> _PostgresConnectionContext:
        return _PostgresConnectionContext(self._pool)

    def close(self) -> None:
        self._pool.close()


def create_memory_store() -> MemoryStore:
    backend = os.getenv("MEMORY_DATABASE_BACKEND", "sqlite").strip().lower()
    if backend == "postgres":
        database_url = os.getenv("DATABASE_URL", "")
        return PostgresMemoryStore(database_url)
    if backend != "sqlite":
        raise RuntimeError(f"unsupported MEMORY_DATABASE_BACKEND: {backend}")
    return MemoryStore()


memory_store = create_memory_store()
