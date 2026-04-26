"""
output_builder — 최종 출력을 구성하는 노드

TTS 없이 텍스트 출력만 정리한다.
디버그 정보도 함께 반환한다.
"""

from backend.graph.state import InterviewState


def output_builder(state: InterviewState) -> dict:
    """최종 출력 패킷을 구성한다. (변경 사항 없음 — 상태 그대로 전달)"""
    # 이 노드에서는 상태를 변경하지 않는다.
    # WebSocket 핸들러에서 state를 읽어 클라이언트에 전송한다.
    return {}
