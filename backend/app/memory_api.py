"""FastAPI routes for the Prometheus memory room vertical slice."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Response

from .memories import (
    MemoryConflictError,
    MemoryContentRejected,
    MemoryNotFound,
    MemoryOwnershipError,
    MemoryRateLimitError,
    MemoryRoomNotFound,
    memory_store,
)
from .memory_schemas import (
    MemoryCreateRequest,
    MemoryMoveRequest,
    MemoryRelocationRequest,
    MemoryReportRequest,
)


router = APIRouter(prefix="/api/memory-rooms", tags=["memory-room"])


def _raise_memory_error(exc: Exception) -> None:
    if isinstance(exc, (MemoryRoomNotFound, MemoryNotFound)):
        raise HTTPException(status_code=404, detail="추억방 또는 추억을 찾을 수 없어요.") from exc
    if isinstance(exc, MemoryOwnershipError):
        raise HTTPException(status_code=403, detail="내가 남긴 추억만 옮기거나 지울 수 있어요.") from exc
    if isinstance(exc, MemoryConflictError):
        detail: dict[str, object] = {"code": "conflict", "message": str(exc)}
        if exc.current_version is not None:
            detail["current_version"] = exc.current_version
        raise HTTPException(status_code=409, detail=detail) from exc
    if isinstance(exc, MemoryRateLimitError):
        raise HTTPException(
            status_code=429,
            detail="너무 빠르게 여러 번 요청했어요. 잠시 쉬었다가 다시 시도해주세요.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    if isinstance(exc, MemoryContentRejected):
        raise HTTPException(
            status_code=422,
            detail={
                "code": exc.code,
                "message": exc.message,
                "safety_bypass": exc.code == "crisis",
            },
        ) from exc
    raise exc


@router.get("/{room_slug}")
def get_memory_room(room_slug: str) -> dict:
    try:
        return memory_store.room(room_slug)
    except MemoryRoomNotFound as exc:
        _raise_memory_error(exc)


@router.get("/{room_slug}/memories")
def list_memories(
    room_slug: str,
    limit: int = Query(default=30, ge=1, le=60),
    cursor: str | None = Query(default=None, min_length=1, max_length=300),
    kind: str | None = Query(default=None, pattern="^(note|mood|story)$"),
) -> dict:
    try:
        return memory_store.list(room_slug, limit=limit, cursor=cursor, kind=kind)
    except (MemoryRoomNotFound, MemoryConflictError) as exc:
        _raise_memory_error(exc)


@router.post("/{room_slug}/memories", status_code=201)
def create_memory(
    room_slug: str,
    request: MemoryCreateRequest,
    visitor_token: str = Header(alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        memory, ownership_token = memory_store.create(
            room_slug,
            kind=request.kind,
            body=request.body,
            emotion=request.emotion,
            card_style=request.card_style,
            author_alias=request.author_alias,
            placement=request.placement.model_dump(),
            visitor_token=visitor_token,
            design=request.design.model_dump(mode="json") if request.design else None,
            client_request_id=request.client_request_id,
            ownership_token=request.ownership_token,
        )
    except (
        MemoryRoomNotFound,
        MemoryContentRejected,
        MemoryRateLimitError,
        MemoryConflictError,
        MemoryOwnershipError,
    ) as exc:
        _raise_memory_error(exc)
    return {"memory": memory, "ownership_token": ownership_token}


@router.get("/{room_slug}/memories/{memory_id}")
def get_memory(room_slug: str, memory_id: str) -> dict:
    try:
        return memory_store.get(room_slug, memory_id)
    except (MemoryRoomNotFound, MemoryNotFound) as exc:
        _raise_memory_error(exc)


@router.patch("/{room_slug}/memories/{memory_id}/placement")
def move_memory(
    room_slug: str,
    memory_id: str,
    request: MemoryMoveRequest,
    ownership_token: str = Header(alias="X-Ownership-Token", min_length=20, max_length=200),
    visitor_token: str = Header(alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        return memory_store.move(
            room_slug,
            memory_id,
            placement=request.model_dump(exclude={"expected_version"}),
            expected_version=request.expected_version,
            ownership_token=ownership_token,
            visitor_token=visitor_token,
        )
    except (
        MemoryRoomNotFound, MemoryNotFound, MemoryOwnershipError,
        MemoryConflictError, MemoryRateLimitError,
    ) as exc:
        _raise_memory_error(exc)


@router.post("/{room_slug}/memories/{memory_id}/relocations")
def relocate_memory(
    room_slug: str,
    memory_id: str,
    request: MemoryRelocationRequest,
    ownership_token: str = Header(alias="X-Ownership-Token", min_length=20, max_length=200),
    visitor_token: str = Header(alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        return memory_store.relocate(
            room_slug,
            memory_id,
            client_request_id=str(request.client_request_id),
            expected_version=request.expected_version,
            placement=request.model_dump(
                exclude={"client_request_id", "expected_version"},
            ),
            ownership_token=ownership_token,
            visitor_token=visitor_token,
        )
    except (
        MemoryRoomNotFound, MemoryNotFound, MemoryOwnershipError,
        MemoryConflictError, MemoryRateLimitError, MemoryContentRejected,
    ) as exc:
        _raise_memory_error(exc)


@router.delete("/{room_slug}/memories/{memory_id}", status_code=204)
def delete_memory(room_slug: str, memory_id: str) -> Response:
    # Deletion isn't gated by ownership — anyone can clear any guestbook entry.
    try:
        memory_store.delete(room_slug, memory_id)
    except (MemoryRoomNotFound, MemoryNotFound) as exc:
        _raise_memory_error(exc)
    return Response(status_code=204)


@router.post("/{room_slug}/memories/{memory_id}/reactions")
def react_to_memory(
    room_slug: str,
    memory_id: str,
    visitor_token: str = Header(alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        return memory_store.react(room_slug, memory_id, visitor_token)
    except (MemoryRoomNotFound, MemoryNotFound, MemoryRateLimitError) as exc:
        _raise_memory_error(exc)


@router.post("/{room_slug}/memories/{memory_id}/reports", status_code=202)
def report_memory(
    room_slug: str,
    memory_id: str,
    request: MemoryReportRequest,
    visitor_token: str = Header(alias="X-Visitor-Token", min_length=20, max_length=200),
) -> dict:
    try:
        return memory_store.report(room_slug, memory_id, request.category, visitor_token)
    except (
        MemoryRoomNotFound, MemoryNotFound, MemoryConflictError, MemoryRateLimitError,
    ) as exc:
        _raise_memory_error(exc)
