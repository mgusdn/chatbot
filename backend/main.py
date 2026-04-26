"""
FastAPI 엔트리포인트 — WebSocket 기반 면접 API

클라이언트와 WebSocket으로 통신하며,
각 메시지를 LangGraph 파이프라인에 통과시켜 면접관 응답을 반환한다.
"""

import json
import time
import logging
from contextlib import asynccontextmanager
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.graph.builder import graph as graph_multi
from backend.graph.builder_single import graph_single
from backend.graph.state import create_initial_state, InterviewState
from backend.mock_data.companies import get_company, MOCK_COMPANIES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("interview-api")

# 세션 저장소 (인메모리)
sessions: Dict[str, InterviewState] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🎯 PUME Interview Prototype started")
    logger.info(f"   Available companies: {list(MOCK_COMPANIES.keys())}")
    yield
    logger.info("Interview API shutdown")


app = FastAPI(
    title="PUME Interview Prototype",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.get("/api/companies")
async def list_companies():
    """사용 가능한 회사 목록을 반환한다."""
    result = []
    for cid, company in MOCK_COMPANIES.items():
        roles = []
        for rid, role in company.get("roles", {}).items():
            roles.append({"id": rid, "title": role["title"]})
        result.append({
            "id": cid,
            "name": company["name"],
            "industry": company["industry"],
            "roles": roles,
        })
    return result


@app.websocket("/ws/interview")
async def interview_websocket(ws: WebSocket):
    """면접 WebSocket 엔드포인트."""
    await ws.accept()
    session_state: InterviewState | None = None

    try:
        while True:
            payload = await ws.receive_json()
            msg_type = payload.get("type")

            # ── 세션 시작 ──
            if msg_type == "start_session":
                company_id = payload.get("company_id", "ai_platform")
                role_id = payload.get("role_id", "mlops_engineer")
                pipeline_mode = payload.get("pipeline_mode", "single")
                stream_strategy = payload.get("stream_strategy", "response_first")

                company = get_company(company_id)
                role_data = company.get("roles", {}).get(role_id)

                if not role_data:
                    await ws.send_json({
                        "type": "error",
                        "data": f"Unknown role: {role_id}",
                    })
                    continue

                session_state = create_initial_state(
                    company_name=company["name"],
                    role_name=role_data["title"],
                    target_competencies=role_data["competencies"],
                    company_style={
                        "interview_style": company["interview_style"],
                        "values": company["values"],
                    },
                )
                session_state["stream_strategy"] = stream_strategy

                logger.info(
                    f"Session started: {company['name']} / {role_data['title']} "
                    f"[mode={pipeline_mode}, strategy={stream_strategy}]"
                )

                # 첫 인사 메시지
                greeting = (
                    f"안녕하세요, 반갑습니다. {company['name']}에서 {role_data['title']} 직무 면접을 "
                    f"진행하게 된 김현우 팀장입니다. 편하게 답변해 주시면 됩니다. "
                    f"먼저 간단하게 자기소개와 함께 가장 최근의 관련 경험을 말씀해 주세요."
                )

                session_state["interviewer_response"] = greeting
                session_state["conversation_history"].append({
                    "role": "interviewer",
                    "content": greeting,
                })
                session_state["asked_questions"].append(greeting[:80])

                await ws.send_json({
                    "type": "interviewer_message",
                    "data": {
                        "text": greeting,
                        "phase": "technical_question",
                        "phase_reason": "면접 시작",
                        "turn_id": 0,
                        "difficulty": session_state["current_difficulty"],
                        "pipeline_mode": pipeline_mode,
                        "stream_strategy": stream_strategy,
                        "elapsed_ms": 0,
                        "debug": {
                            "unverified_competencies": session_state["unverified_competencies"],
                            "strengths": [],
                            "risks": [],
                        },
                    },
                })
                continue

            # ── 사용자 메시지 처리 ──
            if msg_type == "user_message":
                if session_state is None:
                    await ws.send_json({
                        "type": "error",
                        "data": "Session not started. Send start_session first.",
                    })
                    continue

                user_text = payload.get("text", "").strip()
                if not user_text:
                    continue

                # 상태에 사용자 입력 설정
                session_state["user_input"] = user_text

                logger.info(f"[턴 {session_state['turn_id'] + 1}] 사용자: {user_text[:50]}... [mode={pipeline_mode}, strategy={stream_strategy}]")

                # LangGraph 파이프라인 실행 — 모드에 따라 분기
                try:
                    start_time = time.time()

                    if pipeline_mode == "single":
                        # 스트리밍 방식 처리
                        buffer_str = ""
                        is_streaming = False
                        stream_ended = False
                        final_state_update = None
                        current_strategy = session_state.get("stream_strategy", "response_first")
                        
                        await ws.send_json({"type": "stream_start"})
                        
                        async for chunk in graph_single.astream(session_state, stream_mode=["messages", "updates"]):
                            mode, payload_chunk = chunk
                            if mode == "messages":
                                try:
                                    msg, metadata = payload_chunk
                                    # unified_interviewer 노드에서 발생한 청크만 처리
                                    if isinstance(metadata, dict) and metadata.get("langgraph_node") == "unified_interviewer":
                                        content_chunk = msg.content
                                        if hasattr(content_chunk, 'content'):
                                            content_chunk = content_chunk.content

                                        if isinstance(content_chunk, str):
                                            buffer_str += content_chunk
                                            
                                            if current_strategy == "response_only":
                                                # 순수 대화: 모든 토큰 즉시 전송
                                                if content_chunk:
                                                    await ws.send_json({"type": "stream_chunk", "data": content_chunk})
                                            
                                            elif current_strategy in ("response_first", "think_response"):
                                                if stream_ended:
                                                    pass # 이미 </response> 이후이므로 무시
                                                # <response> 태그 기반 스트리밍
                                                elif not is_streaming:
                                                    trigger = '<response>'
                                                    if trigger in buffer_str:
                                                        is_streaming = True
                                                        parts = buffer_str.split(trigger, 1)
                                                        after_trigger = parts[1].lstrip(' \n\r\t')
                                                        if after_trigger:
                                                            # 이 순간에 </response>가 같이 온 경우도 있음
                                                            if '</response>' in after_trigger:
                                                                clean_text = after_trigger.split('</response>')[0]
                                                                if clean_text:
                                                                    # 태그 찌꺼기 방지
                                                                    clean_text = clean_text.replace('</response', '').replace('</re', '').replace('</', '')
                                                                    await ws.send_json({"type": "stream_chunk", "data": clean_text})
                                                                is_streaming = False
                                                                stream_ended = True
                                                            else:
                                                                # '<' 문자열이 들어오기 시작하면 전송 보류 또는 필터링 (가장 안전한 방법은 텍스트 파싱)
                                                                clean_text = after_trigger.replace('</response', '').replace('</re', '').replace('</', '')
                                                                await ws.send_json({"type": "stream_chunk", "data": clean_text})
                                                elif is_streaming:
                                                    # </response> 감지 시 스트리밍 중단
                                                    if '</response>' in content_chunk:
                                                        # 마지막 토큰에 </response>가 포함되어 잘렸을 경우 그 앞부분은 보냄
                                                        before_end = content_chunk.split('</response>')[0]
                                                        if before_end:
                                                            before_end = before_end.replace('</response', '').replace('</re', '').replace('</', '')
                                                            await ws.send_json({"type": "stream_chunk", "data": before_end})
                                                        is_streaming = False
                                                        stream_ended = True
                                                    elif '</response>' in buffer_str:
                                                        is_streaming = False
                                                        stream_ended = True
                                                    else:
                                                        if content_chunk:
                                                            await ws.send_json({"type": "stream_chunk", "data": content_chunk})
                                except Exception as chunk_err:
                                    logger.error(f"Stream chunk parsing error: {chunk_err}")
                                                    
                            elif mode == "updates":
                                try:
                                    if isinstance(payload_chunk, dict):
                                        for node_name, updates in payload_chunk.items():
                                            if updates and isinstance(updates, dict):
                                                if final_state_update is None:
                                                    final_state_update = {}
                                                final_state_update.update(updates)
                                except Exception as upd_err:
                                    logger.error(f"Updates parsing error: {upd_err}")
                                        
                        # 스트리밍 종료 알림
                        await ws.send_json({"type": "stream_end"})
                        
                        # 최종 결과 반영
                        result = final_state_update if final_state_update else session_state

                    else:
                        result = graph_multi.invoke(session_state)

                    elapsed_ms = int((time.time() - start_time) * 1000)

                    # 결과로 세션 상태 갱신
                    session_state.update(result)

                    logger.info(
                        f"[턴 {session_state['turn_id']}] "
                        f"Phase: {session_state['final_phase']} | "
                        f"Reason: {session_state['phase_reason']} | "
                        f"Time: {elapsed_ms}ms [{pipeline_mode}]"
                    )

                    # 클라이언트에 응답 전송
                    await ws.send_json({
                        "type": "interviewer_message",
                        "data": {
                            "text": session_state["interviewer_response"],
                            "phase": session_state["final_phase"],
                            "phase_reason": session_state["phase_reason"],
                            "turn_id": session_state["turn_id"],
                            "difficulty": session_state["current_difficulty"],
                            "pipeline_mode": pipeline_mode,
                            "stream_strategy": stream_strategy,
                            "elapsed_ms": elapsed_ms,
                            "debug": {
                                "proposed_phase": session_state.get("proposed_phase", ""),
                                "final_phase": session_state["final_phase"],
                                "should_retrieve": session_state.get("should_retrieve", False),
                                "candidate_analysis": session_state.get("candidate_analysis"),
                                "unverified_competencies": session_state["unverified_competencies"],
                                "strengths": session_state["strengths"],
                                "risks": session_state["risks"],
                                "retrieval_count": session_state["retrieval_count_recent"],
                                "phase_history": session_state["phase_history"][-10:],
                            },
                        },
                    })

                except Exception as e:
                    logger.exception("Graph execution error")
                    await ws.send_json({
                        "type": "error",
                        "data": f"Pipeline error: {str(e)}",
                    })
                continue

            # ── 알 수 없는 메시지 ──
            await ws.send_json({
                "type": "error",
                "data": f"Unknown message type: {msg_type}",
            })

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.exception("WebSocket error")


# ── Static files (프론트엔드) ──
try:
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
except Exception:
    pass  # frontend 디렉토리가 없으면 무시


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
