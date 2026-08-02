import os

os.environ["AB_MOCK_MODE"] = "true"
os.environ["MOCK_GEMINI_DELAY_MS"] = "0"

import httpx
from fastapi.testclient import TestClient

from app import speech_api
from app.server import app
from app.speech import SynthesisTicketStore


client = TestClient(app)


def test_speech_health_reports_independent_stt_and_tts_state(monkeypatch, tmp_path):
    monkeypatch.setenv("TTS_REF_AUDIO_PATH", str(tmp_path / "missing.wav"))
    response = client.get("/api/speech/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["stt"]["model"] == "small"
    assert body["tts"]["configured"] is False
    assert "파일" in body["tts"]["reason"]


def test_browser_audio_uses_shared_whisper_adapter(monkeypatch):
    monkeypatch.setattr(
        speech_api.whisper_service,
        "transcribe",
        lambda audio: ("음성으로 전한 고민이에요.", 412.5) if audio == b"encoded-audio" else ("", 0),
    )
    response = client.post(
        "/api/speech/transcriptions",
        content=b"encoded-audio",
        headers={"Content-Type": "audio/webm;codecs=opus"},
    )
    assert response.status_code == 200
    assert response.json() == {"text": "음성으로 전한 고민이에요.", "stt_ms": 412.5}


def test_transcription_rejects_non_audio_content_type():
    response = client.post(
        "/api/speech/transcriptions",
        content=b"not-audio",
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 415


def test_tts_ticket_hides_text_and_streams_upstream_audio(monkeypatch, tmp_path):
    ref_audio = tmp_path / "reference.wav"
    ref_audio.write_bytes(b"RIFF-reference")
    monkeypatch.setenv("TTS_REF_AUDIO_PATH", str(ref_audio))
    monkeypatch.setenv("TTS_REF_TEXT", "참조 문장입니다.")
    monkeypatch.setattr(speech_api, "tts_tickets", SynthesisTicketStore())

    upstream_calls = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        def build_request(self, method, url, params):
            upstream_calls.append((method, url, params))
            return httpx.Request(method, url, params=params)

        async def send(self, request, stream=False):
            return httpx.Response(
                200,
                headers={"Content-Type": "audio/raw"},
                content=b"\x01\x00\x02\x00",
                request=request,
            )

        async def aclose(self):
            pass

    monkeypatch.setattr(speech_api.httpx, "AsyncClient", FakeAsyncClient)

    ticket_response = client.post(
        "/api/speech/synthesis",
        json={
            "text": "마음이 많이 답답하셨겠어요.",
            "turn_id": "turn-1",
            "segment_id": "turn-1:1",
        },
    )
    assert ticket_response.status_code == 201
    ticket = ticket_response.json()
    assert "마음" not in ticket["audio_url"]

    audio = client.get(ticket["audio_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"].startswith("audio/raw")
    assert audio.content == b"\x01\x00\x02\x00"
    assert upstream_calls[0][2]["streaming_mode"] == 3
    assert upstream_calls[0][2]["media_type"] == "raw"
    assert upstream_calls[0][2]["fragment_interval"] == 0
    assert upstream_calls[0][2]["text_split_method"] == "cut0"
    assert "batch_size" not in upstream_calls[0][2]


def test_tts_requires_server_owned_reference_voice(monkeypatch):
    monkeypatch.delenv("TTS_REF_AUDIO_PATH", raising=False)
    monkeypatch.delenv("TTS_REF_TEXT", raising=False)
    response = client.post("/api/speech/synthesis", json={"text": "안녕하세요."})
    assert response.status_code == 503
