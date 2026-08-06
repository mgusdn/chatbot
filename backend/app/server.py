from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from counsel.delivery import BaselineTurnDelivery
from counsel.llm import provider_status
from counsel.principle_runtime import principle_runtime_status

from .commons import (
    CommonsAnchorError,
    CommonsContentRejected,
    CommonsOwnershipError,
    CommonsTraceNotFound,
    commons_store,
)
from .experiments import RunNotFoundError, store
from .keepsakes import keepsake_store
from .memory_api import router as memory_room_router
from .speech_api import router as speech_router
from .schemas import (
    Arm,
    CommonsReportRequest,
    ExperimentCreateRequest,
    GuestbookCreateRequest,
    InstallationCreateRequest,
    KeepsakeCreateRequest,
    RatingRequest,
    TurnRequest,
)


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"

app = FastAPI(
    title="Pume Counseling Model A/B Lab",
    version="0.1.0",
    description="Latest upstream Gemini baseline versus its latency-optimized Gemini pipeline.",
)
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.include_router(memory_room_router)
app.include_router(speech_router)


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/demo", include_in_schema=False)
def demo() -> FileResponse:
    return FileResponse(STATIC / "demo" / "index.html")


@app.get("/api/health")
def health(probe: bool = Query(default=False)) -> dict:
    return {
        "status": "ok",
        "providers": provider_status(probe=probe),
        "principle_bank": principle_runtime_status(),
        "limitations": {
            "stt": "브라우저 음성을 로컬 whisper.cpp로 변환합니다. /api/speech/health에서 준비 상태를 확인하세요.",
            "tts": "GPT-SoVITS 음성을 브라우저로 스트리밍합니다. /api/speech/health에서 준비 상태를 확인하세요.",
        },
    }


def _raise_commons_error(exc: Exception) -> None:
    if isinstance(exc, CommonsTraceNotFound):
        raise HTTPException(status_code=404, detail="공개 흔적을 찾을 수 없습니다.") from exc
    if isinstance(exc, CommonsOwnershipError):
        raise HTTPException(status_code=403, detail="이 공개 흔적을 삭제할 권한이 없습니다.") from exc
    if isinstance(exc, CommonsAnchorError):
        raise HTTPException(status_code=422, detail="사용할 수 없는 공개 흔적 위치 또는 오브젝트입니다.") from exc
    if isinstance(exc, CommonsContentRejected):
        raise HTTPException(
            status_code=422,
            detail={
                "code": exc.code,
                "message": exc.message,
                "safety_bypass": exc.code == "crisis",
            },
        ) from exc
    raise exc


@app.get("/api/commons/today")
def get_today_commons() -> dict:
    return commons_store.today()


@app.post("/api/commons/guestbook", status_code=201)
def create_guestbook_trace(
    request: GuestbookCreateRequest,
    visitor_token: str | None = Header(default=None, alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        trace, ownership_token = commons_store.create_guestbook(
            anchor_key=request.anchor_key,
            message=request.message,
            visitor_token=visitor_token,
        )
    except (CommonsAnchorError, CommonsContentRejected) as exc:
        _raise_commons_error(exc)
    return {"trace": trace, "ownership_token": ownership_token}


@app.post("/api/commons/installations", status_code=201)
def create_installation_trace(
    request: InstallationCreateRequest,
    visitor_token: str | None = Header(default=None, alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        trace, ownership_token = commons_store.create_installation(
            anchor_key=request.anchor_key,
            object_kind=request.object_kind,
            message=request.message,
            visitor_token=visitor_token,
        )
    except (CommonsAnchorError, CommonsContentRejected) as exc:
        _raise_commons_error(exc)
    return {"trace": trace, "ownership_token": ownership_token}


@app.post("/api/commons/traces/{trace_id}/reactions")
def react_to_common_trace(
    trace_id: str,
    visitor_token: str = Header(alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        reaction_count = commons_store.react(trace_id, visitor_token)
    except CommonsTraceNotFound as exc:
        _raise_commons_error(exc)
    return {"trace_id": trace_id, "reaction_count": reaction_count}


@app.post("/api/commons/traces/{trace_id}/reports", status_code=202)
def report_common_trace(trace_id: str, request: CommonsReportRequest) -> dict:
    try:
        commons_store.report(trace_id, request.category)
    except CommonsTraceNotFound as exc:
        _raise_commons_error(exc)
    return {"trace_id": trace_id, "reported": True}


@app.delete("/api/commons/traces/{trace_id}", status_code=204)
def delete_common_trace(
    trace_id: str,
    ownership_token: str = Header(alias="X-Ownership-Token", min_length=20, max_length=200),
) -> Response:
    try:
        commons_store.delete(trace_id, ownership_token)
    except (CommonsTraceNotFound, CommonsOwnershipError) as exc:
        _raise_commons_error(exc)
    return Response(status_code=204)


@app.post("/api/experiments", status_code=201)
def create_experiment(request: ExperimentCreateRequest | None = None) -> dict:
    return store.create(name=request.name if request else "사용자")


@app.get("/api/experiments/{experiment_id}")
def get_experiment(experiment_id: str) -> dict:
    try:
        return store.describe(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="실험 세션을 찾을 수 없습니다.") from exc


@app.get("/api/experiments/{experiment_id}/demo-state")
def get_demo_state(
    experiment_id: str,
    arm: Arm = Query(default=Arm.optimized),
) -> dict:
    try:
        return store.demo_state(experiment_id, arm.value)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="실험 세션을 찾을 수 없습니다.") from exc


@app.post("/api/experiments/{experiment_id}/keepsake-letter", status_code=201)
def create_keepsake_letter(experiment_id: str, request: KeepsakeCreateRequest) -> dict:
    try:
        context = store.keepsake_context(experiment_id, request.arm.value)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="상담 세션을 찾을 수 없습니다.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="상담 요약이 완성된 뒤 기념 편지를 만들 수 있어요.") from exc

    letter, share_token = keepsake_store.create(context)
    return {
        "letter": letter,
        "share_token": share_token,
        "expires_at": letter["expires_at"],
    }


@app.get("/api/keepsake-letters/{share_token}")
def get_keepsake_letter(share_token: str) -> dict:
    letter = keepsake_store.get(share_token)
    if letter is None:
        raise HTTPException(status_code=404, detail="기념 편지 링크가 만료되었거나 존재하지 않아요.")
    return {"letter": letter}


@app.post("/api/experiments/{experiment_id}/turns")
async def run_turn(experiment_id: str, request: TurnRequest) -> dict:
    try:
        store.describe(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="실험 세션을 찾을 수 없습니다.") from exc

    comparison_id = uuid4().hex

    async def run_one(arm: str) -> dict:
        try:
            return await asyncio.to_thread(
                store.run_turn,
                experiment_id,
                arm,
                request.message,
                comparison_id,
            )
        except Exception as exc:
            return store.record_error(
                experiment_id,
                arm,
                request.message,
                exc,
                comparison_id=comparison_id,
            )

    results = await asyncio.gather(*(run_one(arm.value) for arm in request.arms))
    return {
        "experiment_id": experiment_id,
        "comparison_id": comparison_id,
        "results": {result["arm"]: result for result in results},
    }


@app.post("/api/experiments/{experiment_id}/turns/stream")
async def stream_turn(experiment_id: str, request: TurnRequest) -> StreamingResponse:
    """Stream early baseline delivery segments without changing its graph logic.

    The endpoint accepts the same one- or two-arm request as the normal A/B
    endpoint.  Only baseline publishes opening/aside/waiting-bridge segments;
    optimized keeps its existing complete-response behavior.
    """
    try:
        store.describe(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="실험 세션을 찾을 수 없습니다.") from exc

    comparison_id = uuid4().hex
    loop = asyncio.get_running_loop()
    event_queue: asyncio.Queue[dict] = asyncio.Queue()
    delivery: BaselineTurnDelivery | None = None

    def enqueue_from_thread(event: dict) -> None:
        # Delivery runs inside asyncio.to_thread. Merely scheduling put_nowait
        # can let arm_result overtake the segment when the loop is busy, causing
        # the stream to finish with a valid reflection still queued. Wait until
        # the unbounded queue has accepted the segment before the graph resumes.
        accepted = asyncio.run_coroutine_threadsafe(event_queue.put(event), loop)
        accepted.result(timeout=1.0)

    if Arm.baseline in request.arms:
        delivery = BaselineTurnDelivery(uuid4().hex, enqueue_from_thread)

    async def run_one(arm: Arm) -> None:
        arm_delivery = delivery if arm == Arm.baseline else None
        try:
            result = await asyncio.to_thread(
                store.run_turn,
                experiment_id,
                arm.value,
                request.message,
                comparison_id,
                arm_delivery,
            )
        except Exception as exc:
            if arm_delivery is not None:
                arm_delivery.cancel()
            result = store.record_error(
                experiment_id,
                arm.value,
                request.message,
                exc,
                run_id=arm_delivery.turn_id if arm_delivery else None,
                comparison_id=comparison_id,
                delivery_metrics=(
                    arm_delivery.metrics() if arm_delivery is not None else None
                ),
            )

        metrics = dict(result.get("metrics") or {})
        if metrics.get("first_response_ms") is None:
            metrics["first_response_ms"] = metrics.get("total_ms")
        if arm == Arm.optimized:
            metrics.setdefault("delivery_profile", "complete_response")
            metrics.setdefault("aside_emitted", False)
            metrics.setdefault("bridge_emitted", False)
        result = {**result, "metrics": metrics}
        speech_continuation = (
            arm_delivery.unspoken_continuation(result.get("message") or "")
            if arm_delivery is not None and result.get("status") == "ok"
            else None
        )
        await event_queue.put(
            {
                "type": "arm_result",
                "turn_id": result.get("run_id"),
                "arm": arm.value,
                "result": result,
                "speech_continuation": speech_continuation,
            }
        )

    async def events():
        tasks = [asyncio.create_task(run_one(arm)) for arm in request.arms]
        results: dict[str, dict] = {}
        sequences = {arm.value: 0 for arm in request.arms}
        try:
            while len(results) < len(request.arms):
                event = await event_queue.get()
                arm = str(event.get("arm") or "")
                if arm in sequences:
                    sequences[arm] += 1
                    event = {**event, "sequence": sequences[arm]}
                event["comparison_id"] = comparison_id
                if event.get("type") == "arm_result":
                    results[arm] = event["result"]
                yield json.dumps(event, ensure_ascii=False) + "\n"

            await asyncio.gather(*tasks, return_exceptions=True)
            complete = {
                "type": "complete",
                "experiment_id": experiment_id,
                "comparison_id": comparison_id,
                "results": results,
            }
            yield json.dumps(complete, ensure_ascii=False) + "\n"
        finally:
            if len(results) < len(request.arms) and delivery is not None:
                delivery.cancel()

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/experiments/{experiment_id}/ratings", status_code=204)
def rate_turn(experiment_id: str, request: RatingRequest) -> None:
    try:
        store.rate(experiment_id, request.run_id, request.arm.value, request.score, request.note)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="이 실험과 파이프라인에 해당하는 실행 결과를 찾을 수 없습니다.") from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="실험 세션을 찾을 수 없습니다.") from exc
