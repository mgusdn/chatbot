import os
from pathlib import Path
import subprocess
import sys


def test_module_cli_runs_in_mock_mode():
    environment = dict(os.environ)
    environment["CHATBOT_MOCK_MODE"] = "true"
    completed = subprocess.run(
        [sys.executable, "-m", "chatbot", "--mock", "--no-stream"],
        input="1, 2, 3, 4, 5\nquit\n",
        text=True,
        capture_output=True,
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        timeout=20,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert "프메의 숲 상담을 시작합니다" in completed.stdout
    assert "프바오:" in completed.stdout
    assert "상담을 종료합니다" in completed.stdout
