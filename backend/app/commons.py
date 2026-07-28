"""Anonymous, short-lived public traces for the shared counseling-space lobby.

This store deliberately has no dependency on counseling experiments, sessions,
transcripts, slots, or reports. Public traces live in their own SQLite tables and
expire automatically.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import sqlite3
from threading import Lock
from uuid import uuid4
from zoneinfo import ZoneInfo

from .safety import detect_crisis


SEOUL = ZoneInfo("Asia/Seoul")
TODAY_WALL_ANCHOR = "today-wall"
INSTALLATION_ANCHORS = tuple(f"installation-{index:02d}" for index in range(1, 17))
INSTALLATION_OBJECT_KINDS = {"flower", "lantern", "book", "stone"}
REPORT_CATEGORIES = {"personal_information", "crisis", "harassment", "spam"}

_ALIAS_ADJECTIVES = (
    "고요한", "다정한", "포근한", "용감한", "느긋한", "반짝이는",
    "푸른", "따뜻한", "산뜻한", "차분한", "수줍은", "든든한",
)
_ALIAS_ANIMALS = (
    "판다", "수달", "토끼", "사슴", "다람쥐", "고양이",
    "강아지", "두루미", "고슴도치", "여우", "참새", "해달",
)
_PROFANITY_TERMS = (
    "씨발", "시발", "병신", "개새끼", "좆", "꺼져", "지랄",
)
_PII_PATTERNS = (
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"(?<!\d)(?:01[016789]|0\d{1,2})[- .]?\d{3,4}[- .]?\d{4}(?!\d)"),
    re.compile(r"(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)"),
)


class CommonsError(Exception):
    pass


class CommonsTraceNotFound(CommonsError):
    pass


class CommonsOwnershipError(CommonsError):
    pass


class CommonsAnchorError(CommonsError):
    pass


class CommonsContentRejected(CommonsError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def moderate_public_message(message: str | None) -> str | None:
    if message is None:
        return None
    normalized = " ".join(message.split()).strip()
    if not normalized:
        return None
    if len(normalized) > 60:
        raise CommonsContentRejected("too_long", "공개 메시지는 60자 이내로 작성해 주세요.")
    if detect_crisis(normalized):
        raise CommonsContentRejected(
            "crisis",
            "이 내용은 공개하지 않았어요. 지금 위험할 수 있다면 112·119 또는 가까운 응급실에 즉시 도움을 요청해 주세요.",
        )
    if any(pattern.search(normalized) for pattern in _PII_PATTERNS):
        raise CommonsContentRejected(
            "personal_information",
            "전화번호, 이메일, 주민등록번호 등 개인정보는 공개 공간에 남길 수 없어요.",
        )
    compact = re.sub(r"[^0-9A-Za-z가-힣]", "", normalized.lower())
    if any(term in compact for term in _PROFANITY_TERMS):
        raise CommonsContentRejected("profanity", "다른 방문자에게 상처가 될 수 있는 표현은 공개할 수 없어요.")
    return normalized


class CommonsStore:
    def __init__(
        self,
        path: str | Path | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
        ttl_hours: float | None = None,
    ) -> None:
        configured = path or os.getenv("COMMONS_DB_PATH")
        self.path = Path(configured) if configured else Path(__file__).resolve().parents[1] / "data" / "commons.sqlite3"
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        requested_ttl = float(ttl_hours if ttl_hours is not None else os.getenv("COMMONS_TTL_HOURS", "30"))
        self.ttl_hours = max(24.0, min(30.0, requested_ttl))
        self._init_lock = Lock()
        self._initialized = False

    def _now(self) -> datetime:
        value = self.clock()
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _day_key(self, now: datetime) -> str:
        return now.astimezone(SEOUL).date().isoformat()

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(self.path, timeout=5) as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA foreign_keys=ON")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS commons_traces (
                        id TEXT PRIMARY KEY,
                        day_key TEXT NOT NULL,
                        kind TEXT NOT NULL CHECK(kind IN ('guestbook', 'installation')),
                        anchor_key TEXT NOT NULL,
                        object_kind TEXT,
                        message TEXT,
                        alias TEXT NOT NULL,
                        ownership_token_hash TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        expires_at REAL NOT NULL,
                        reaction_count INTEGER NOT NULL DEFAULT 0,
                        report_count INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE INDEX IF NOT EXISTS commons_traces_today_idx
                        ON commons_traces(day_key, created_at);
                    CREATE INDEX IF NOT EXISTS commons_traces_expiry_idx
                        ON commons_traces(expires_at);
                    CREATE TABLE IF NOT EXISTS commons_reactions (
                        trace_id TEXT NOT NULL REFERENCES commons_traces(id) ON DELETE CASCADE,
                        reactor_hash TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        PRIMARY KEY (trace_id, reactor_hash)
                    );
                    CREATE TABLE IF NOT EXISTS commons_reports (
                        id TEXT PRIMARY KEY,
                        trace_id TEXT NOT NULL REFERENCES commons_traces(id) ON DELETE CASCADE,
                        category TEXT NOT NULL,
                        created_at REAL NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS commons_reports_trace_idx
                        ON commons_reports(trace_id);
                    """
                )
            self._initialized = True

    def _connect(self) -> sqlite3.Connection:
        self._ensure_initialized()
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _cleanup(self, connection: sqlite3.Connection, now_epoch: float) -> None:
        connection.execute("DELETE FROM commons_traces WHERE expires_at <= ?", (now_epoch,))

    def _alias(self, day_key: str, alias_seed: str) -> str:
        digest = hashlib.sha256(f"{day_key}:{alias_seed}".encode("utf-8")).digest()
        adjective = _ALIAS_ADJECTIVES[digest[0] % len(_ALIAS_ADJECTIVES)]
        animal = _ALIAS_ANIMALS[digest[1] % len(_ALIAS_ANIMALS)]
        return f"오늘의 {adjective} {animal}"

    def _created_bucket(self, created_at: float) -> str:
        hour = datetime.fromtimestamp(created_at, tz=timezone.utc).astimezone(SEOUL).hour
        if 5 <= hour < 12:
            return "morning"
        if 12 <= hour < 18:
            return "afternoon"
        if 18 <= hour < 23:
            return "evening"
        return "night"

    def _public_trace(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "day_key": row["day_key"],
            "kind": row["kind"],
            "anchor_key": row["anchor_key"],
            "object_kind": row["object_kind"],
            "message": row["message"],
            "alias": row["alias"],
            "created_bucket": self._created_bucket(float(row["created_at"])),
            "reaction_count": int(row["reaction_count"]),
        }

    def _least_used_installation_anchor(
        self,
        connection: sqlite3.Connection,
        day_key: str,
        now_epoch: float,
    ) -> str:
        counts = {anchor: 0 for anchor in INSTALLATION_ANCHORS}
        rows = connection.execute(
            """
            SELECT anchor_key, COUNT(*) AS count
            FROM commons_traces
            WHERE day_key = ? AND kind = 'installation' AND expires_at > ?
            GROUP BY anchor_key
            """,
            (day_key, now_epoch),
        ).fetchall()
        for row in rows:
            if row["anchor_key"] in counts:
                counts[row["anchor_key"]] = int(row["count"])
        return min(INSTALLATION_ANCHORS, key=lambda anchor: (counts[anchor], anchor))

    def _create(
        self,
        *,
        kind: str,
        anchor_key: str | None,
        object_kind: str | None,
        message: str | None,
        visitor_token: str | None,
    ) -> tuple[dict, str]:
        message = moderate_public_message(message)
        if kind == "guestbook":
            if anchor_key not in {None, TODAY_WALL_ANCHOR}:
                raise CommonsAnchorError("guestbook anchor must be today-wall")
            if not message:
                raise CommonsContentRejected("empty", "방명록에는 한 글자 이상의 메시지가 필요해요.")
            anchor_key = TODAY_WALL_ANCHOR
            object_kind = None
        elif kind == "installation":
            if anchor_key is not None and anchor_key not in INSTALLATION_ANCHORS:
                raise CommonsAnchorError("unknown installation anchor")
            if object_kind not in INSTALLATION_OBJECT_KINDS:
                raise CommonsAnchorError("unknown installation object kind")
        else:
            raise ValueError("unknown commons trace kind")

        now = self._now()
        now_epoch = now.timestamp()
        day_key = self._day_key(now)
        ownership_token = secrets.token_urlsafe(32)
        trace_id = uuid4().hex
        token_hash = hashlib.sha256(ownership_token.encode("utf-8")).hexdigest()
        expires_at = now_epoch + self.ttl_hours * 60 * 60

        with self._connect() as connection:
            self._cleanup(connection, now_epoch)
            if kind == "installation" and anchor_key is None:
                anchor_key = self._least_used_installation_anchor(connection, day_key, now_epoch)
            connection.execute(
                """
                INSERT INTO commons_traces (
                    id, day_key, kind, anchor_key, object_kind, message, alias,
                    ownership_token_hash, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trace_id,
                    day_key,
                    kind,
                    anchor_key,
                    object_kind,
                    message,
                    self._alias(day_key, visitor_token or ownership_token),
                    token_hash,
                    now_epoch,
                    expires_at,
                ),
            )
            row = connection.execute("SELECT * FROM commons_traces WHERE id = ?", (trace_id,)).fetchone()
        assert row is not None
        return self._public_trace(row), ownership_token

    def create_guestbook(
        self,
        *,
        anchor_key: str = TODAY_WALL_ANCHOR,
        message: str,
        visitor_token: str | None = None,
    ) -> tuple[dict, str]:
        return self._create(
            kind="guestbook",
            anchor_key=anchor_key,
            object_kind=None,
            message=message,
            visitor_token=visitor_token,
        )

    def create_installation(
        self,
        *,
        anchor_key: str | None,
        object_kind: str,
        message: str | None = None,
        visitor_token: str | None = None,
    ) -> tuple[dict, str]:
        return self._create(
            kind="installation",
            anchor_key=anchor_key,
            object_kind=object_kind,
            message=message,
            visitor_token=visitor_token,
        )

    def today(self) -> dict:
        now = self._now()
        now_epoch = now.timestamp()
        day_key = self._day_key(now)
        with self._connect() as connection:
            self._cleanup(connection, now_epoch)
            rows = connection.execute(
                """
                SELECT * FROM commons_traces
                WHERE day_key = ? AND expires_at > ?
                ORDER BY created_at ASC, id ASC
                """,
                (day_key, now_epoch),
            ).fetchall()
        traces = [self._public_trace(row) for row in rows]
        counts = {
            "total": len(traces),
            "guestbook": sum(trace["kind"] == "guestbook" for trace in traces),
            "installation": sum(trace["kind"] == "installation" for trace in traces),
        }
        return {"day_key": day_key, "traces": traces, "counts": counts}

    def react(self, trace_id: str, visitor_token: str) -> int:
        now = self._now()
        now_epoch = now.timestamp()
        day_key = self._day_key(now)
        reactor_hash = hashlib.sha256(f"{trace_id}:{visitor_token}".encode("utf-8")).hexdigest()
        with self._connect() as connection:
            self._cleanup(connection, now_epoch)
            exists = connection.execute(
                "SELECT 1 FROM commons_traces WHERE id = ? AND day_key = ? AND expires_at > ?",
                (trace_id, day_key, now_epoch),
            ).fetchone()
            if not exists:
                raise CommonsTraceNotFound(trace_id)
            cursor = connection.execute(
                "INSERT OR IGNORE INTO commons_reactions (trace_id, reactor_hash, created_at) VALUES (?, ?, ?)",
                (trace_id, reactor_hash, now_epoch),
            )
            if cursor.rowcount == 1:
                connection.execute(
                    "UPDATE commons_traces SET reaction_count = reaction_count + 1 WHERE id = ?",
                    (trace_id,),
                )
            row = connection.execute(
                "SELECT reaction_count FROM commons_traces WHERE id = ?",
                (trace_id,),
            ).fetchone()
        assert row is not None
        return int(row["reaction_count"])

    def report(self, trace_id: str, category: str) -> str:
        if category not in REPORT_CATEGORIES:
            raise ValueError("unknown report category")
        now = self._now()
        now_epoch = now.timestamp()
        day_key = self._day_key(now)
        report_id = uuid4().hex
        with self._connect() as connection:
            self._cleanup(connection, now_epoch)
            exists = connection.execute(
                "SELECT 1 FROM commons_traces WHERE id = ? AND day_key = ? AND expires_at > ?",
                (trace_id, day_key, now_epoch),
            ).fetchone()
            if not exists:
                raise CommonsTraceNotFound(trace_id)
            connection.execute(
                "INSERT INTO commons_reports (id, trace_id, category, created_at) VALUES (?, ?, ?, ?)",
                (report_id, trace_id, category, now_epoch),
            )
            connection.execute(
                "UPDATE commons_traces SET report_count = report_count + 1 WHERE id = ?",
                (trace_id,),
            )
        return report_id

    def delete(self, trace_id: str, ownership_token: str) -> None:
        now_epoch = self._now().timestamp()
        supplied_hash = hashlib.sha256(ownership_token.encode("utf-8")).hexdigest()
        with self._connect() as connection:
            self._cleanup(connection, now_epoch)
            row = connection.execute(
                "SELECT ownership_token_hash FROM commons_traces WHERE id = ?",
                (trace_id,),
            ).fetchone()
            if row is None:
                raise CommonsTraceNotFound(trace_id)
            if not hmac.compare_digest(str(row["ownership_token_hash"]), supplied_hash):
                raise CommonsOwnershipError(trace_id)
            connection.execute("DELETE FROM commons_traces WHERE id = ?", (trace_id,))


commons_store = CommonsStore()
