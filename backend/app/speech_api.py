"""FastAPI routes for browser STT and streamed GPT-SoVITS playback."""

from __future__ import annotations

import asyncio
import os

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .speech import (
    InvalidAudio,
    SpeechUnavailable,
    tts_service,
    tts_tickets,
    whisper_service,
)


router = APIRouter(prefix="/api/speech", tags=["speech"])


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    turn_id: str | None = Field(default=None, max_length=100)
    segment_id: str | None = Field(default=None, max_length=100)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.split()).strip()
        if not normalized:
            raise ValueError("text must not be blank")
        return normalized


@router.get("/health")
async def speech_health(
    probe: bool = Query(default=False),
    warm: bool = Query(default=False),
) -> dict:
    warm_error = None
    if warm and whisper_service.status()["available"]:
        try:
            await asyncio.to_thread(whisper_service.warmup)
        except Exception as exc:  # health must still report TTS and diagnostics
            warm_error = str(exc)
    return {
        "status": "ok",
        "stt": {**whisper_service.status(), "warm_error": warm_error},
        "tts": await tts_service.status(probe=probe),
    }


@router.post("/transcriptions")
async def transcribe_browser_audio(request: Request) -> dict:
    content_type = request.headers.get("content-type", "")
    if content_type and not (
        content_type.startswith("audio/")
        or content_type == "application/octet-stream"
    ):
        raise HTTPException(status_code=415, detail="audio 형식의 요청만 받을 수 있습니다.")
    encoded_audio = await request.body()
    try:
        text, stt_ms = await asyncio.to_thread(whisper_service.transcribe, encoded_audio)
    except SpeechUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except InvalidAudio as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not text:
        raise HTTPException(
            status_code=422,
            detail="말소리를 분명하게 인식하지 못했어요. 마이크 가까이에서 다시 말해 주세요.",
        )
    return {"text": text, "stt_ms": stt_ms}


@router.post("/synthesis", status_code=201)
async def create_synthesis_ticket(request: SynthesisRequest) -> dict:
    configured, reason = tts_service.configuration()
    if not configured:
        raise HTTPException(status_code=503, detail=reason or "TTS가 설정되지 않았습니다.")
    ticket = tts_tickets.create(
        request.text,
        turn_id=request.turn_id,
        segment_id=request.segment_id,
    )
    return {
        "ticket_id": ticket.ticket_id,
        "audio_url": f"/api/speech/synthesis/{ticket.ticket_id}",
        "expires_in_seconds": 90,
    }


@router.get("/synthesis/{ticket_id}")
async def stream_synthesis(ticket_id: str) -> StreamingResponse:
    ticket = tts_tickets.resolve(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="음성 재생 요청이 만료되었거나 이미 사용되었습니다.")

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=float(os.getenv("TTS_CONNECT_TIMEOUT_SECONDS", "3")),
            read=float(os.getenv("TTS_READ_TIMEOUT_SECONDS", "60")),
            write=10.0,
            pool=3.0,
        )
    )
    try:
        upstream_request = client.build_request(
            "GET",
            f"{tts_service.server_url}/tts",
            params=tts_service.request_params(ticket.text),
        )
        upstream = await client.send(upstream_request, stream=True)
        if upstream.status_code >= 400:
            detail = (await upstream.aread()).decode("utf-8", errors="replace")[-500:]
            await upstream.aclose()
            await client.aclose()
            raise HTTPException(
                status_code=502,
                detail=f"GPT-SoVITS가 음성을 만들지 못했습니다: {detail or upstream.status_code}",
            )
    except HTTPException:
        raise
    except (httpx.HTTPError, SpeechUnavailable) as exc:
        await client.aclose()
        raise HTTPException(status_code=503, detail=f"GPT-SoVITS 연결 실패: {exc}") from exc

    async def audio_chunks():
        try:
            async for chunk in upstream.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        audio_chunks(),
        media_type=upstream.headers.get("content-type", "audio/wav"),
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        },
    )
