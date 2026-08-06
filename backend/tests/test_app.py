import os
from pathlib import Path

os.environ["AB_MOCK_MODE"] = "true"
os.environ["MOCK_GEMINI_DELAY_MS"] = "0"
os.environ["AB_RESULTS_PATH"] = "/private/tmp/pume-llm-ab-test-results.jsonl"
os.environ["KEEPSAKE_DATABASE_BACKEND"] = "sqlite"
os.environ["KEEPSAKE_DB_PATH"] = "/private/tmp/pume-keepsake-api-tests.sqlite3"

from fastapi.testclient import TestClient

from app.server import app


client = TestClient(app)
ARMS = ["baseline", "optimized"]


def create_experiment(name: str = "사용자") -> dict:
    response = client.post("/api/experiments", json={"name": name})
    assert response.status_code == 201
    return response.json()


def test_health_and_experiment_are_gemini_pipeline_ab():
    health = client.get("/api/health").json()
    assert set(health["providers"]) == {"gemini", "mock_mode"}

    experiment = create_experiment("마음이")
    assert set(experiment["greetings"]) == set(ARMS)
    assert experiment["greetings"]["baseline"] == experiment["greetings"]["optimized"]
    assert "마음이님" in experiment["greetings"]["baseline"]
    for arm in ARMS:
        assert experiment["states"][arm]["provider"] == "gemini"
        assert experiment["states"][arm]["pipeline_arm"] == arm
        assert experiment["states"][arm]["upstream_commit"] == "e065de5"


def test_same_message_runs_independent_pipeline_arms():
    experiment = create_experiment()
    response = client.post(
        f"/api/experiments/{experiment['experiment_id']}/turns",
        json={"message": "오늘 마음이 무거워요.", "arms": ARMS},
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body["results"]) == set(ARMS)
    for arm in ARMS:
        result = body["results"][arm]
        assert result["status"] == "ok"
        assert result["pipeline_arm"] == arm
        assert result["provider"] == "gemini"
        assert result["comparison_id"] == body["comparison_id"]


def test_single_arm_does_not_advance_other_arm():
    experiment = create_experiment()
    experiment_id = experiment["experiment_id"]
    client.post(
        f"/api/experiments/{experiment_id}/turns",
        json={"message": "1, 2, 3, 4, 5", "arms": ["optimized"]},
    )
    states = client.get(f"/api/experiments/{experiment_id}").json()["states"]
    assert states["baseline"]["stage"] == "values"
    assert states["optimized"]["stage"] == "rapport"


def test_crisis_gate_bypasses_both_pipelines_and_gemini():
    experiment = create_experiment()
    results = client.post(
        f"/api/experiments/{experiment['experiment_id']}/turns",
        json={"message": "자해하고 싶다는 생각이 들어요.", "arms": ARMS},
    ).json()["results"]
    assert results["baseline"]["message"] == results["optimized"]["message"]
    for arm in ARMS:
        assert results[arm]["safety_bypass"] is True
        assert results[arm]["metrics"]["model_calls"] == 0


def test_rating_is_scoped_to_pipeline_arm():
    experiment = create_experiment()
    experiment_id = experiment["experiment_id"]
    turn = client.post(
        f"/api/experiments/{experiment_id}/turns",
        json={"message": "요즘 잠을 잘 못 자요.", "arms": ["optimized"]},
    ).json()["results"]["optimized"]
    assert client.post(
        f"/api/experiments/{experiment_id}/ratings",
        json={"run_id": turn["run_id"], "arm": "optimized", "score": 4},
    ).status_code == 204
    assert client.post(
        f"/api/experiments/{experiment_id}/ratings",
        json={"run_id": turn["run_id"], "arm": "baseline", "score": 4},
    ).status_code == 404


def test_qwen_and_legacy_model_arms_are_rejected():
    experiment = create_experiment()
    for invalid in ["qwen", "gemini", "gpt4o"]:
        response = client.post(
            f"/api/experiments/{experiment['experiment_id']}/turns",
            json={"message": "테스트 메시지입니다.", "arms": [invalid]},
        )
        assert response.status_code == 422


def test_static_uis_use_pipeline_arm_ids_and_no_qwen_copy():
    root = Path(__file__).resolve().parents[1]
    sources = "\n".join(
        (root / path).read_text(encoding="utf-8")
        for path in [
            "app/static/index.html",
            "app/static/app.js",
            "app/static/demo/index.html",
            "app/static/demo/demo.js",
        ]
    )
    assert 'data-mode="baseline"' in sources
    assert 'data-mode="optimized"' in sources
    assert "A · 공감" in sources
    assert "로컬 원리" in sources
    assert "개선 Gemini" in sources
    assert "qwen" not in sources.lower()


def test_demo_route_and_assets_are_available():
    response = client.get("/demo")
    assert response.status_code == 200
    assert "프바오 마음상담" in response.text
    for path in [
        "/static/demo/demo.js",
        "/static/demo/demo.css",
        "/static/demo/assets/panda-room-v2.png",
    ]:
        assert client.get(path).status_code == 200
