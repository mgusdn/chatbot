"""
InterviewState — LangGraph 상태 스키마

설계서 Section 4의 전체 스키마를 프로토타입 목적에 맞게 간소화한 버전.
핵심 필드만 남기되, 면접 흐름 제어에 필요한 모든 정보는 보존한다.
"""

from typing import TypedDict, Literal, List, Dict, Any, Optional


InterviewPhase = Literal[
    "technical_question",
    "behavioral_question",
    "followup_probe",
    "live_qa",
]


class InterviewState(TypedDict):
    # ── 세션 기본 정보 ──
    company_name: str
    role_name: str
    target_competencies: List[str]
    company_style: Dict[str, Any]       # mock 회사 스타일 프로필

    # ── 현재 턴 ──
    turn_id: int
    user_input: str

    # ── 라우팅 & 가드 ──
    proposed_phase: InterviewPhase
    final_phase: InterviewPhase
    phase_reason: str

    # ── 지원자 분석 ──
    candidate_analysis: Optional[Dict[str, Any]]

    # ── 검색 ──
    should_retrieve: bool
    evidence_summary: str

    # ── 생성 ──
    interviewer_response: str

    # ── 메모리 (누적) ──
    strengths: List[str]
    risks: List[str]
    unverified_competencies: List[str]
    asked_questions: List[str]
    phase_history: List[str]
    current_difficulty: int             # 1~5
    pressure_level: int                 # 1~3
    last_two_phases: List[str]
    retrieval_count_recent: int         # 최근 3턴 retrieval 횟수
    short_summary: str                  # 누적 대화 요약
    conversation_history: List[Dict[str, str]]  # [{"role": "user/interviewer", "content": "..."}]
    stream_strategy: str  # "response_first" | "response_only" | "think_response"


def create_initial_state(
    company_name: str = "AI 플랫폼 기업",
    role_name: str = "MLOps 엔지니어",
    target_competencies: Optional[List[str]] = None,
    company_style: Optional[Dict[str, Any]] = None,
) -> InterviewState:
    """초기 면접 상태를 생성한다."""
    if target_competencies is None:
        target_competencies = [
            "ML 파이프라인 설계",
            "배포 자동화",
            "모니터링 및 장애 대응",
            "팀 협업",
            "문제 해결 능력",
        ]

    if company_style is None:
        company_style = {}

    return InterviewState(
        company_name=company_name,
        role_name=role_name,
        target_competencies=target_competencies,
        company_style=company_style,
        turn_id=0,
        user_input="",
        proposed_phase="technical_question",
        final_phase="technical_question",
        phase_reason="면접 시작",
        candidate_analysis=None,
        should_retrieve=False,
        evidence_summary="",
        interviewer_response="",
        strengths=[],
        risks=[],
        unverified_competencies=list(target_competencies),
        asked_questions=[],
        phase_history=[],
        current_difficulty=2,
        pressure_level=1,
        last_two_phases=[],
        retrieval_count_recent=0,
        short_summary="",
        conversation_history=[],
        stream_strategy="response_first",
    )
