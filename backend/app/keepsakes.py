from __future__ import annotations

import atexit
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
from threading import RLock
from typing import Any
from uuid import uuid4


DEFAULT_TTL_MINUTES = 30
DEFAULT_TEMPLATE_ID = "purple_growth_v1"


@dataclass(frozen=True)
class PhraseProfile:
    id: str
    modifier: str
    text: str
    keywords: tuple[str, ...]
    hashtags: tuple[str, str, str]
    template_id: str


# The five profiles correspond one-to-one with the five exhibition letter
# designs. The classifier stays closed-set so counseling text can never be
# copied verbatim into the public, token-addressed letter.
PHRASE_CATALOG: tuple[PhraseProfile, ...] = (
    PhraseProfile(
        id="gentle_rest",
        modifier="잠시 쉼이 필요한",
        text="잠시 쉬어가는 것도\n너를 돌보는 중요한 일이야.\n오늘 밤만큼은 걱정을 내려놓고\n편안히 숨을 고르자.",
        keywords=("피곤", "지쳤", "힘들", "부담", "잠", "휴식", "쉬", "무기력"),
        hashtags=("마음의쉼표", "충분히애썼어", "나를돌보기"),
        template_id="cream_rest_v1",
    ),
    PhraseProfile(
        id="self_growth",
        modifier="마음을 단단히 키워온",
        text="지나온 마음을 잊지 마.\n서툴고 아팠던 순간도\n너를 더 단단히 자라게 했어.\n여기까지 잘 견뎌온 너를 믿어.",
        keywords=("자책", "완벽", "부족", "실망", "한심", "자존감", "실수", "비난", "성장", "견뎌"),
        hashtags=("자기다정함", "마음의성장", "있는그대로"),
        template_id="purple_growth_v1",
    ),
    PhraseProfile(
        id="own_pace",
        modifier="소원을 품고 걸어가는",
        text="밤하늘의 별처럼\n너의 바람도 빛을 잃지 않을 거야.\n조급해하지 말고 너의 속도로\n원하는 곳을 향해 가보자.",
        keywords=("진로", "취업", "비교", "늦", "앞서", "제자리", "방향", "목표", "소원", "바라"),
        hashtags=("나만의속도", "빛나는소원", "한걸음씩"),
        template_id="starry_wish_v1",
    ),
    PhraseProfile(
        id="steady_effort",
        modifier="묵묵히 애써온",
        text="세상일이 늘 쉽게 풀리진 않아도\n보이지 않는 곳에서 쌓은 노력은\n분명 너만의 힘이 되어\n좋은 열매로 돌아올 거야.",
        keywords=("노력", "열심", "도전", "시작", "실패", "미루", "끈기", "성과", "일"),
        hashtags=("꾸준한마음", "노력의시간", "좋은열매"),
        template_id="black_effort_v1",
    ),
    PhraseProfile(
        id="joyful_release",
        modifier="마음의 여유를 찾아가는",
        text="열심히 사는 모습도 멋지지만\n너무 오래 마음을 몰아세우진 마.\n좋아하는 음악 한 곡과 함께\n오늘의 긴장을 가볍게 풀어봐.",
        keywords=("관계", "친구", "가족", "사람", "연락", "외로", "눈치", "스트레스", "답답", "화", "긴장", "즐거"),
        hashtags=("마음의여유", "스트레스안녕", "오늘도토닥토닥"),
        template_id="red_release_v1",
    ),
)


THEME_TAGS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("마음의안전", ("불안", "초조", "걱정", "두려")),
    ("감정알아차림", ("감정", "화", "슬프", "답답", "속상")),
    ("자기다정함", ("자책", "부족", "실망", "한심", "완벽")),
    ("관계의온도", ("관계", "친구", "가족", "사람", "연락")),
    ("나만의속도", ("비교", "늦", "진로", "취업", "제자리")),
    ("작은용기", ("시작", "도전", "미루", "용기", "실패")),
    ("마음의쉼표", ("피곤", "지쳤", "힘들", "잠", "휴식")),
    ("솔직한마음", ("표현", "솔직", "진심", "말")),
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _safe_nickname(value: Any) -> str:
    nickname = " ".join(str(value or "사용자").split()).strip()
    nickname = "".join(character for character in nickname if character not in "<>\x00")
    return "".join(list(nickname)[:10]) or "사용자"


def _context_text(context: dict[str, Any]) -> str:
    pieces: list[str] = [str(context.get("report") or "")]
    for values in (context.get("slots") or {}).values():
        if isinstance(values, list):
            pieces.extend(str(value) for value in values[-3:])
    pieces.extend(str(value) for value in context.get("selected_values") or [])
    return " ".join(pieces).lower()


def _keyword_score(text: str, keywords: tuple[str, ...]) -> int:
    return sum(text.count(keyword.lower()) for keyword in keywords)


def build_keepsake_draft(context: dict[str, Any]) -> dict[str, Any]:
    text = _context_text(context)
    ranked = sorted(
        enumerate(PHRASE_CATALOG),
        key=lambda item: (-_keyword_score(text, item[1].keywords), item[0]),
    )
    profile = ranked[0][1] if _keyword_score(text, ranked[0][1].keywords) > 0 else PHRASE_CATALOG[-1]

    ranked_tags = sorted(
        enumerate(THEME_TAGS),
        key=lambda item: (-_keyword_score(text, item[1][1]), item[0]),
    )
    hashtags = [tag for _, (tag, _) in ranked_tags if _keyword_score(text, dict(THEME_TAGS)[tag]) > 0][:3]
    for fallback in profile.hashtags:
        if fallback not in hashtags:
            hashtags.append(fallback)
        if len(hashtags) == 3:
            break

    nickname = _safe_nickname(context.get("name"))
    return {
        "recipient_name": nickname,
        "recipient_modifier": profile.modifier,
        "recipient_label": f"{profile.modifier} {nickname}에게",
        "phrase_id": profile.id,
        "phrase_text": profile.text,
        "hashtags": hashtags[:3],
        "sender_name": "푸바오",
        "sender_label": "푸바오가.",
        "template_id": profile.template_id or DEFAULT_TEMPLATE_ID,
        "template_version": 1,
        "orientation": "landscape",
    }


class KeepsakeStore:
    def create(self, context: dict[str, Any]) -> tuple[dict[str, Any], str]:
        raise NotImplementedError

    def get(self, token: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def close(self) -> None:
        return


class SQLiteKeepsakeStore(KeepsakeStore):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                create table if not exists keepsake_letters (
                    id text primary key,
                    share_token_hash text not null unique,
                    recipient_name text not null,
                    recipient_modifier text not null,
                    recipient_label text not null,
                    phrase_id text not null,
                    phrase_text text not null,
                    hashtags_json text not null,
                    sender_name text not null,
                    sender_label text not null,
                    template_id text not null,
                    template_version integer not null,
                    orientation text not null,
                    created_at text not null,
                    expires_at text not null,
                    downloaded_at text
                )
                """
            )
            connection.execute(
                "create index if not exists keepsake_letters_expiry_idx on keepsake_letters(expires_at)"
            )

    def create(self, context: dict[str, Any]) -> tuple[dict[str, Any], str]:
        draft = build_keepsake_draft(context)
        token = secrets.token_urlsafe(24)
        created_at = _now()
        expires_at = created_at + timedelta(minutes=DEFAULT_TTL_MINUTES)
        row = {
            "id": uuid4().hex,
            **draft,
            "created_at": created_at.isoformat(),
            "expires_at": expires_at.isoformat(),
        }
        with self._lock, self._connect() as connection:
            connection.execute("delete from keepsake_letters where expires_at <= ?", (created_at.isoformat(),))
            connection.execute(
                """
                insert into keepsake_letters (
                    id, share_token_hash, recipient_name, recipient_modifier,
                    recipient_label, phrase_id, phrase_text, hashtags_json,
                    sender_name, sender_label, template_id, template_version,
                    orientation, created_at, expires_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"], _token_hash(token), row["recipient_name"], row["recipient_modifier"],
                    row["recipient_label"], row["phrase_id"], row["phrase_text"],
                    json.dumps(row["hashtags"], ensure_ascii=False), row["sender_name"],
                    row["sender_label"], row["template_id"], row["template_version"],
                    row["orientation"], row["created_at"], row["expires_at"],
                ),
            )
        return row, token

    def get(self, token: str) -> dict[str, Any] | None:
        if not token or len(token) > 100:
            return None
        now = _now().isoformat()
        with self._lock, self._connect() as connection:
            result = connection.execute(
                """
                select * from keepsake_letters
                where share_token_hash = ? and expires_at > ?
                """,
                (_token_hash(token), now),
            ).fetchone()
            if result is None:
                return None
            connection.execute(
                "update keepsake_letters set downloaded_at = coalesce(downloaded_at, ?) where id = ?",
                (now, result["id"]),
            )
        row = dict(result)
        row["hashtags"] = json.loads(row.pop("hashtags_json"))
        row.pop("share_token_hash", None)
        row.pop("downloaded_at", None)
        return row


class PostgresKeepsakeStore(KeepsakeStore):
    def __init__(self, database_url: str) -> None:
        if not database_url.strip():
            raise RuntimeError("DATABASE_URL is required for the PostgreSQL keepsake store")
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        normalized_url = database_url.strip().strip('"').strip("'")
        if "sslmode=" not in normalized_url:
            normalized_url += ("&" if "?" in normalized_url else "?") + "sslmode=require"
        self._dict_row = dict_row
        self._pool = ConnectionPool(conninfo=normalized_url, min_size=1, max_size=3, timeout=10, open=True)

    def close(self) -> None:
        self._pool.close()

    def create(self, context: dict[str, Any]) -> tuple[dict[str, Any], str]:
        draft = build_keepsake_draft(context)
        token = secrets.token_urlsafe(24)
        created_at = _now()
        expires_at = created_at + timedelta(minutes=DEFAULT_TTL_MINUTES)
        row = {
            "id": uuid4().hex,
            **draft,
            "created_at": created_at.isoformat(),
            "expires_at": expires_at.isoformat(),
        }
        with self._pool.connection() as connection:
            connection.execute("delete from pume.keepsake_letters where expires_at <= now()")
            connection.execute(
                """
                insert into pume.keepsake_letters (
                    id, share_token_hash, recipient_name, recipient_modifier,
                    recipient_label, phrase_id, phrase_text, hashtags,
                    sender_name, sender_label, template_id, template_version,
                    orientation, created_at, expires_at
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row["id"], _token_hash(token), row["recipient_name"], row["recipient_modifier"],
                    row["recipient_label"], row["phrase_id"], row["phrase_text"], row["hashtags"],
                    row["sender_name"], row["sender_label"], row["template_id"],
                    row["template_version"], row["orientation"], created_at, expires_at,
                ),
            )
        return row, token

    def get(self, token: str) -> dict[str, Any] | None:
        if not token or len(token) > 100:
            return None
        with self._pool.connection() as connection:
            with connection.cursor(row_factory=self._dict_row) as cursor:
                result = cursor.execute(
                    """
                    update pume.keepsake_letters
                    set downloaded_at = coalesce(downloaded_at, now())
                    where share_token_hash = %s and expires_at > now()
                    returning id, recipient_name, recipient_modifier, recipient_label,
                              phrase_id, phrase_text, hashtags, sender_name, sender_label,
                              template_id, template_version, orientation, created_at, expires_at
                    """,
                    (_token_hash(token),),
                ).fetchone()
        if result is None:
            return None
        row = dict(result)
        for key in ("created_at", "expires_at"):
            if isinstance(row.get(key), datetime):
                row[key] = row[key].isoformat()
        return row


def create_keepsake_store() -> KeepsakeStore:
    backend = os.getenv(
        "KEEPSAKE_DATABASE_BACKEND",
        os.getenv("MEMORY_DATABASE_BACKEND", "sqlite"),
    ).strip().lower()
    if backend == "postgres":
        return PostgresKeepsakeStore(os.getenv("DATABASE_URL", ""))
    if backend != "sqlite":
        raise RuntimeError(f"unsupported KEEPSAKE_DATABASE_BACKEND: {backend}")
    configured = os.getenv("KEEPSAKE_DB_PATH", "data/keepsakes.sqlite3")
    path = Path(configured)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[1] / path
    return SQLiteKeepsakeStore(path)


keepsake_store = create_keepsake_store()
atexit.register(keepsake_store.close)
