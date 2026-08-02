"""Browser-facing speech adapters.

The upstream ``juminsuh/chatbot`` STT captures the host microphone directly and
the ``mgusdn/chatbot-voice`` TTS client plays audio on the host with ffplay.
This module keeps their model/API choices, but replaces both host-only edges:
the browser uploads encoded microphone audio and receives GPT-SoVITS audio.
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
from threading import Lock
import time
from typing import Any
from uuid import uuid4

import httpx
import numpy as np


SAMPLE_RATE = 16_000
HALLUCINATION_PHRASES = {"감사합니다"}


class SpeechUnavailable(RuntimeError):
    """A configured speech provider cannot currently be used."""


class InvalidAudio(ValueError):
    """The uploaded browser audio is empty, too large, or undecodable."""


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_text(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


class BrowserWhisperService:
    """Lazy, process-wide pywhispercpp model for browser audio uploads."""

    def __init__(self) -> None:
        self._model: Any | None = None
        self._model_lock = Lock()
        self._inference_lock = Lock()

    @property
    def model_name(self) -> str:
        return os.getenv("STT_MODEL_NAME", "small").strip() or "small"

    def availability(self) -> tuple[bool, str | None]:
        if not _env_bool("STT_ENABLED", True):
            return False, "STT_ENABLED=false"
        if importlib.util.find_spec("pywhispercpp") is None:
            return False, "pywhispercpp가 설치되지 않았습니다."
        if shutil.which("ffmpeg") is None:
            return False, "ffmpeg가 설치되지 않았습니다."
        return True, None

    def status(self) -> dict[str, Any]:
        available, reason = self.availability()
        return {
            "available": available,
            "model": self.model_name,
            "loaded": self._model is not None,
            "language": os.getenv("STT_LANGUAGE", "ko"),
            "reason": reason,
        }

    def warmup(self) -> None:
        """Load the model before the first recorded utterance arrives."""
        self._get_model()

    def _get_model(self) -> Any:
        available, reason = self.availability()
        if not available:
            raise SpeechUnavailable(reason or "STT를 사용할 수 없습니다.")
        if self._model is not None:
            return self._model
        with self._model_lock:
            if self._model is None:
                from pywhispercpp.model import ContextParams, Model

                self._model = Model(
                    self.model_name,
                    context_params=ContextParams(
                        # CPU is the reliable default on the current M-series
                        # host; Metal can terminate the worker when its buffer
                        # allocation fails. Opt in after validating the host.
                        use_gpu=_env_bool("STT_USE_GPU", False),
                    ),
                    language=os.getenv("STT_LANGUAGE", "ko"),
                    no_speech_thold=float(os.getenv("STT_NO_SPEECH_THRESHOLD", "0.6")),
                    print_progress=False,
                )
        return self._model

    def _decode(self, encoded_audio: bytes) -> np.ndarray:
        max_bytes = int(os.getenv("STT_MAX_UPLOAD_BYTES", str(16 * 1024 * 1024)))
        if not encoded_audio:
            raise InvalidAudio("녹음된 음성이 없습니다.")
        if len(encoded_audio) > max_bytes:
            raise InvalidAudio("녹음 파일이 너무 큽니다. 60초 이내로 말해 주세요.")

        duration = float(os.getenv("STT_MAX_AUDIO_SECONDS", "60"))
        command = [
            shutil.which("ffmpeg") or "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-t",
            str(duration),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ]
        try:
            decoded = subprocess.run(
                command,
                input=encoded_audio,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=max(15.0, duration + 5.0),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise InvalidAudio("음성 파일을 변환하지 못했습니다.") from exc
        if decoded.returncode != 0 or len(decoded.stdout) < SAMPLE_RATE // 10 * 4:
            detail = decoded.stderr.decode("utf-8", errors="replace").strip()
            raise InvalidAudio(detail[-300:] or "음성을 인식할 수 있는 형식으로 변환하지 못했습니다.")
        return np.frombuffer(decoded.stdout, dtype=np.float32).copy()

    def transcribe(self, encoded_audio: bytes) -> tuple[str, float]:
        started = time.perf_counter()
        samples = self._decode(encoded_audio)
        model = self._get_model()
        # whisper.cpp model instances are not guaranteed to be safe for two
        # concurrent transcriptions in the same process.
        with self._inference_lock:
            segments = model.transcribe(
                samples,
                language=os.getenv("STT_LANGUAGE", "ko"),
            )
        text = _normalize_text("".join(segment.text for segment in segments))
        if text.strip(".!?~ ") in HALLUCINATION_PHRASES:
            text = ""
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return text, elapsed_ms


@dataclass(frozen=True)
class SynthesisTicket:
    ticket_id: str
    text: str
    turn_id: str | None
    segment_id: str | None
    expires_at: float


class SynthesisTicketStore:
    """Short-lived one-shot tickets keep counseling text out of audio URLs."""

    def __init__(self) -> None:
        self._items: dict[str, SynthesisTicket] = {}
        self._lock = Lock()

    def create(
        self,
        text: str,
        *,
        turn_id: str | None = None,
        segment_id: str | None = None,
    ) -> SynthesisTicket:
        now = time.monotonic()
        ticket = SynthesisTicket(
            ticket_id=uuid4().hex,
            text=_normalize_text(text),
            turn_id=turn_id,
            segment_id=segment_id,
            expires_at=now + float(os.getenv("TTS_TICKET_TTL_SECONDS", "90")),
        )
        with self._lock:
            self._items = {
                key: item for key, item in self._items.items() if item.expires_at > now
            }
            self._items[ticket.ticket_id] = ticket
        return ticket

    def resolve(self, ticket_id: str) -> SynthesisTicket | None:
        now = time.monotonic()
        with self._lock:
            ticket = self._items.get(ticket_id)
            if ticket is not None and ticket.expires_at <= now:
                self._items.pop(ticket_id, None)
        if ticket is None or ticket.expires_at <= now:
            return None
        return ticket


class GptSoVitsService:
    """Async proxy for the API contract used by mgusdn/chatbot-voice."""

    @property
    def server_url(self) -> str:
        return os.getenv("TTS_SERVER_URL", "http://127.0.0.1:9880").rstrip("/")

    @property
    def reference_audio_path(self) -> str:
        return os.getenv("TTS_REF_AUDIO_PATH", "").strip()

    @property
    def reference_text(self) -> str:
        return os.getenv("TTS_REF_TEXT", "").strip()

    def configuration(self) -> tuple[bool, str | None]:
        if not _env_bool("TTS_ENABLED", True):
            return False, "TTS_ENABLED=false"
        if not self.reference_audio_path:
            return False, "TTS_REF_AUDIO_PATH가 설정되지 않았습니다."
        if not Path(self.reference_audio_path).is_file():
            return False, "TTS_REF_AUDIO_PATH 파일을 찾을 수 없습니다."
        if not self.reference_text:
            return False, "TTS_REF_TEXT가 설정되지 않았습니다."
        return True, None

    async def status(self, *, probe: bool = False) -> dict[str, Any]:
        configured, reason = self.configuration()
        connected: bool | None = None
        if configured and probe:
            try:
                async with httpx.AsyncClient(timeout=1.5) as client:
                    response = await client.get(f"{self.server_url}/docs")
                # A reachable API can legitimately disable Swagger and answer
                # 404; connection itself is what matters here.
                connected = response.status_code < 500
            except httpx.HTTPError:
                connected = False
        return {
            "configured": configured,
            "connected": connected,
            "server_url": self.server_url,
            "reason": reason,
        }

    def request_params(self, text: str) -> dict[str, Any]:
        configured, reason = self.configuration()
        if not configured:
            raise SpeechUnavailable(reason or "TTS가 설정되지 않았습니다.")
        return {
            "text": _normalize_text(text),
            "text_lang": "ko",
            "ref_audio_path": self.reference_audio_path,
            "prompt_text": self.reference_text,
            "prompt_lang": "ko",
            # Raw signed 16-bit PCM lets the browser feed one long-lived
            # AudioWorklet instead of starting a fresh <audio> element for
            # every sentence. The configured voice currently emits 32 kHz mono.
            "media_type": os.getenv("TTS_MEDIA_TYPE", "raw"),
            # 60 ms is short enough to keep pre-buffered sentences flowing,
            # but gives the final syllable a natural release instead of
            # cutting directly from an active waveform to digital zero.
            "fragment_interval": float(os.getenv("TTS_FRAGMENT_INTERVAL_SECONDS", "0")),
            "text_split_method": os.getenv("TTS_TEXT_SPLIT_METHOD", "cut0"),
            # Match chatbot-voice: fastest streaming profile. Never combine it
            # with batch_size; GPT-SoVITS currently errors on that combination.
            "streaming_mode": int(os.getenv("TTS_STREAMING_MODE", "3")),
        }


whisper_service = BrowserWhisperService()
tts_service = GptSoVitsService()
tts_tickets = SynthesisTicketStore()
