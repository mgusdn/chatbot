"""Apply the Supabase schema and idempotently copy the local memory-room data."""

from __future__ import annotations

from pathlib import Path
import os
import sqlite3
import sys

from dotenv import load_dotenv
import psycopg


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SOURCE = BACKEND / "data" / "memories.sqlite3"
MIGRATION = ROOT / "supabase" / "migrations" / "202608030001_memory_room_realtime.sql"

TABLES = (
    "memory_rooms",
    "memory_entries",
    "memory_placements",
    "memory_reactions",
    "memory_reports",
    "memory_rate_events",
    "memory_relocation_requests",
)


def database_url() -> str:
    load_dotenv(BACKEND / ".env", override=False)
    value = os.getenv("DATABASE_URL", "").strip().strip('"').strip("'")
    if not value.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("backend/.env의 DATABASE_URL을 확인해주세요.")
    if "sslmode=" not in value:
        value += ("&" if "?" in value else "?") + "sslmode=require"
    return value


def source_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")]


def copy_table(
    source: sqlite3.Connection,
    target: psycopg.Connection,
    table: str,
) -> tuple[int, int]:
    columns = source_columns(source, table)
    rows = source.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
    if rows:
        placeholders = ", ".join(["%s"] * len(columns))
        statement = (
            f"INSERT INTO pume.{table} ({', '.join(columns)}) "
            f"VALUES ({placeholders}) ON CONFLICT DO NOTHING"
        )
        with target.cursor() as cursor:
            cursor.executemany(
                statement,
                [tuple(row[column] for column in columns) for row in rows],
            )
    remote_count = target.execute(f"SELECT COUNT(*) FROM pume.{table}").fetchone()[0]
    return len(rows), int(remote_count)


def main() -> int:
    if not SOURCE.exists():
        raise RuntimeError(f"로컬 SQLite 파일을 찾을 수 없습니다: {SOURCE}")
    migration_sql = MIGRATION.read_text(encoding="utf-8")

    with sqlite3.connect(SOURCE) as source:
        source.row_factory = sqlite3.Row
        with psycopg.connect(database_url()) as target:
            target.execute(migration_sql)
            target.execute("SET search_path TO pume, public")
            target.execute("SELECT pg_advisory_xact_lock(%s)", (7_196_021_027,))
            counts = {table: copy_table(source, target, table) for table in TABLES}

            source_visible = source.execute(
                """
                SELECT COUNT(*) FROM memory_entries
                WHERE visibility = 'public' AND moderation_status = 'visible'
                      AND deleted_at IS NULL
                """
            ).fetchone()[0]
            remote_visible = target.execute(
                """
                SELECT COUNT(*) FROM pume.memory_entries
                WHERE visibility = 'public' AND moderation_status = 'visible'
                      AND deleted_at IS NULL
                """
            ).fetchone()[0]
            revision_signal = target.execute(
                "SELECT revision FROM public.memory_room_revisions WHERE slug = 'prometheus'"
            ).fetchone()
            if int(remote_visible) < int(source_visible) or revision_signal is None:
                raise RuntimeError("방명록 데이터 또는 Realtime revision 검증에 실패했습니다.")

    for table, (local_count, remote_count) in counts.items():
        print(f"{table}: local={local_count} remote={remote_count}")
    print(f"visible_memories: local={source_visible} remote={remote_visible}")
    print(f"realtime_revision: {int(revision_signal[0])}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"migration failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
