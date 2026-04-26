"""
LLM 서비스 — Ollama ChatOllama 인스턴스 관리

Qwen3 8B을 기본 모델로 사용하며,
structured output과 자연어 생성에 각각 다른 temperature를 적용한다.
"""

from langchain_ollama import ChatOllama


def _patch_think(llm_instance: ChatOllama, think: bool) -> ChatOllama:
    """Qwen3의 내부 추론(thinking) 모드를 제어한다.

    think=False: TTFT ~8초 → ~0.4초로 단축.
    think=True:  모델이 내부적으로 충분히 추론한 뒤 고품질 응답 생성.

    LangChain의 ChatOllama는 Ollama의 'think' 파라미터를 직접 지원하지 않으므로,
    _chat_params를 패치하여 Ollama API 호출 시 think 값을 주입한다.
    """
    original_chat_params = llm_instance._chat_params

    def patched_chat_params(*args, **kwargs):
        result = original_chat_params(*args, **kwargs)
        result["think"] = think
        return result

    llm_instance._chat_params = patched_chat_params
    return llm_instance


def get_llm(temperature: float = 0.7, num_ctx: int = 4096, think: bool = False) -> ChatOllama:
    """기본 LLM 인스턴스를 반환한다."""
    instance = ChatOllama(
        model="qwen3:8b",
        temperature=temperature,
        num_ctx=num_ctx,
    )
    return _patch_think(instance, think)


def get_structured_llm(temperature: float = 0.1, num_ctx: int = 4096) -> ChatOllama:
    """Structured output용 LLM (낮은 temperature, 결정적 출력)."""
    instance = ChatOllama(
        model="qwen3:8b",
        temperature=temperature,
        num_ctx=num_ctx,
    )
    return _patch_think(instance, think=False)


# 싱글턴 인스턴스 — 노드 간 공유
llm = get_llm(think=False)                  # 일반 (thinking OFF)
llm_think = get_llm(think=True)             # thinking ON (고품질)
structured_llm_base = get_structured_llm()
