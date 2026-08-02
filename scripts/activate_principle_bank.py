#!/usr/bin/env python3
"""Validate, version, and explicitly activate the bundled principle bank."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from chatbot.principle_bank import BANK_PATH, load_principle_bank
from chatbot.principle_store import DEFAULT_PRINCIPLE_DB_PATH, PrincipleStore


def main() -> int:
    parser = argparse.ArgumentParser(
        description="검증된 JSON 원리 뱅크를 SQLite 활성 버전으로 전환합니다."
    )
    parser.add_argument("--seed-path", type=Path, default=BANK_PATH)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_PRINCIPLE_DB_PATH)
    args = parser.parse_args()

    payload = load_principle_bank(args.seed_path)
    snapshot = PrincipleStore(
        args.db_path,
        seed_path=args.seed_path,
    ).activate_payload(payload)
    print(
        json.dumps(
            {
                "enabled": snapshot.enabled,
                "bank_version": snapshot.bank_version,
                "checksum": snapshot.checksum[:12],
                "source": snapshot.source,
                "principle_count": len(snapshot.principles),
                "db_path": str(args.db_path.resolve()),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
