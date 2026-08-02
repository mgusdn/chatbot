from typing import Literal, TypedDict


PipelineArm = Literal["baseline"]
ModelProvider = Literal["gemini"]
SlotSwitch = Literal["off", "asking", "on", "unknown"]

SLOT_ORDER = [
    "situation",
    "emotion",
    "thought",
    "cause",
    "behavior",
    "duration",
    "impact",
    "relationship",
    "coping",
    "goal",
    "self_message",
]

SKIP_IF_FILLED_SLOTS = {}
EXPLICIT_UNKNOWN_VALUE = "-"

SLOT_QUESTION_TEMPLATES = {
    "situation": "사용자가 상담을 하는 이유와 배경 상황 (신경쓰이는 일)에 대해 질의",
    "emotion": "사용자가 최근 상황에 대해 느끼는 감정에 대해 질의",
    "thought": "문제에 대해 스스로 드는 생각이 무엇인지 질의",
    "cause": "왜 그런 감정과 생각이 드는지 이유가 무엇이라고 생각하는지 질의",
    "behavior": "사용자의 최근 행동 패턴 또는 경향에 대해 질의. 이는 사용자의 행동 습관이나 문제 때문에 자주 하게 된 행동 패턴에 관한 것으로, 특정 활동 (e.g., 여행, 취미 활동)의 맥락이 아님.",
    "duration": "문제의 지속 기간과 빈도수에 대해 질의",
    "impact": "문제가 구체적으로 일상에 어떤 영향을 주는지 질의",
    "relationship": "이 문제가 대인관계에 어떤 영향을 미치는지, 요즘 주변 사람들과의 관계는 어떤지 질의",
    "coping": "문제를 해결하기 위해 과거 시도해본 방법에 대해 질의",
    "goal": "사용자의 앞으로의 바램, 기대하는 나아진 모습, 목표에 대해 질의",
    "self_message": "지금까지 나눈 이야기를 바탕으로, 스스로에게 해주고 싶은 말이 있다면 무엇인지 질의",
}

# Deterministic user-facing questions owned by the A-series sequence controller.
SLOT_FALLBACK_QUESTIONS = {
    "situation": "요즘 어떤 고민이나 신경 쓰이는 일이 있으신가요?",
    "emotion": "그 일로 요즘 어떤 감정이 드시나요?",
    "thought": "그 문제를 떠올리면 스스로 어떤 생각이 드시나요?",
    "cause": "그런 감정과 생각이 드는 이유는 무엇이라고 느끼시나요?",
    "behavior": "이런 마음이 들 때 실제로 자주 하게 되는 행동이 있나요?",
    "duration": "이런 어려움은 언제부터, 얼마나 자주 이어지고 있나요?",
    "impact": "이 문제가 일상생활에 구체적으로 어떤 영향을 주고 있나요?",
    "relationship": "이 문제로 주변 사람들과의 관계에도 달라진 점이 있나요?",
    "coping": "이 문제를 해결하려고 전에 시도해 본 방법이 있나요?",
    "goal": "앞으로 어떤 모습으로 달라지고 싶으신가요?",
    "self_message": "지금까지 이야기한 자신에게 어떤 말을 건네고 싶으신가요?",
}

# A's sequence controller owns re-ask wording. Keeping these questions in code
# prevents the visible question from drifting away from the pending slot while
# the response model focuses only on warmth and conversational texture.
SLOT_DETAIL_QUESTIONS = {
    "situation": "최근 가장 먼저 떠오르는 경험 하나를 편하게 들려주실 수 있나요?",
    "emotion": "그 순간 마음에 가장 가까웠던 감정을 하나 떠올려보실 수 있나요?",
    "thought": "그때 스스로에 대해 어떤 생각이 가장 먼저 떠올랐나요?",
    "cause": "그런 감정과 생각이 생긴 이유로 떠오르는 것이 있나요?",
    "behavior": "그럴 때 실제로 가장 자주 하게 되는 행동은 무엇인가요?",
    "duration": "정확하지 않아도 괜찮으니 대략 언제부터 얼마나 자주 그랬나요?",
    "impact": "이 문제가 일상에서 가장 크게 불편하게 만드는 점은 무엇인가요?",
    "relationship": "특히 누구와의 관계에서 달라진 점을 느끼시나요?",
    "coping": "시도해 본 방법 중 도움이 됐거나 아쉬웠던 점도 있었나요?",
    "goal": "조금 나아진다면 일상에서 어떤 모습이 가장 달라지길 바라시나요?",
    "self_message": "지금의 상황과 연결해서 자신에게 어떤 말을 건네고 싶으신가요?",
}

SLOT_KOREAN_LABELS = {
    "situation": "상황",
    "emotion": "감정",
    "thought": "생각",
    "cause": "원인",
    "behavior": "행동",
    "duration": "기간·빈도",
    "impact": "영향",
    "relationship": "대인관계",
    "coping": "과거 시도",
    "goal": "목표",
    "self_message": "나에게 하고 싶은 말",
}


class SlotState(TypedDict):
    situation: list[str]
    emotion: list[str]
    thought: list[str]
    cause: list[str]
    behavior: list[str]
    duration: list[str]
    impact: list[str]
    relationship: list[str]
    coping: list[str]
    goal: list[str]
    self_message: list[str]


def askable_slots(slots: SlotState, asked_slots: list[str]) -> list[str]:
    result = []
    for slot in SLOT_ORDER:
        if slot in asked_slots:
            continue
        if slot in SKIP_IF_FILLED_SLOTS and slots[slot]:
            continue
        result.append(slot)
    return result


class PendingQuestion(TypedDict):
    target_slot: str
    question_intent: str


class GateState(TypedDict):
    coverage_ok: bool


class SessionState(TypedDict):
    session_id: str
    pipeline_arm: PipelineArm
    provider: ModelProvider
    upstream_commit: str
    stage: Literal["rapport", "loop", "values", "done"]
    rapport_step: Literal["greeting", "mood", "how", "who"]
    name: str
    turn_count: int
    user_input: str | None
    bot_message: str | None
    reflection_prefix: str | None
    pending: PendingQuestion | None
    asked_slots: list[str]
    retry_count: dict[str, int]
    slot_switches: dict[str, SlotSwitch]
    last_analysis: dict | None
    last_aside_turn: int | None
    recent_asides: list[str]
    recent_principle_ids: list[str]
    slots: SlotState
    conversation_log: list[dict]
    gate: GateState
    values_prompted: bool
    selected_values: list[str]
    report: str | None
    report_fallback: bool


def new_session(
    session_id: str,
    name: str = "사용자",
) -> SessionState:
    return SessionState(
        session_id=session_id,
        pipeline_arm="baseline",
        provider="gemini",
        upstream_commit="e065de5",
        stage="values",
        rapport_step="greeting",
        name=name,
        turn_count=0,
        user_input=None,
        bot_message=None,
        reflection_prefix=None,
        pending=None,
        asked_slots=[],
        retry_count={slot: 0 for slot in SLOT_ORDER},
        slot_switches={slot: "off" for slot in SLOT_ORDER},
        last_analysis=None,
        last_aside_turn=None,
        recent_asides=[],
        recent_principle_ids=[],
        slots=SlotState(**{slot: [] for slot in SLOT_ORDER}),
        conversation_log=[],
        gate=GateState(coverage_ok=False),
        values_prompted=False,
        selected_values=[],
        report=None,
        report_fallback=False,
    )
