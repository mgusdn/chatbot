"""Download the whisper.cpp model used by browser STT before starting FastAPI."""

from __future__ import annotations

import sys

from pywhispercpp.utils import download_model


def main() -> None:
    model_name = sys.argv[1] if len(sys.argv) > 1 else "small"
    path = download_model(model_name)
    print(f"[download_stt] '{model_name}' ready at: {path}")


if __name__ == "__main__":
    main()
