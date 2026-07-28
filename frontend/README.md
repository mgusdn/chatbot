# Pume Village Game Web

동숲 스타일 진입·캐릭터 선택·마을 탐색·프바오 상담 화면을 제공하는 Next.js 앱입니다.

상담 선택지는 모델이 아니라 파이프라인입니다.

- A · 말하며 판단: 모델이 공감을 만드는 동안 메모리에서 검수된 원리를 검색하고,
  명백한 단일 슬롯은 로컬로 넘기며 애매한 답만 Gemini가 판단
- 개선 Gemini: 병렬 analyzer/response와 rule-based slot switch 적용

두 선택지 모두 같은 FastAPI 서버와 같은 Gemini 설정을 사용합니다.

## 실행

FastAPI를 먼저 127.0.0.1:8000에서 실행한 뒤:

    npm ci
    npm run dev

브라우저: <http://127.0.0.1:3000/>

상담 입력창의 `음성 입력`을 누르면 브라우저 마이크를 녹음하고, 다시 누르면
FastAPI STT가 입력창에 문장을 채웁니다. `음성 답변`은 GPT-SoVITS가 준비된 경우
활성화되며 텍스트 표시와 별개로 응답 문장을 순서대로 재생합니다. 음성 서버 설정은
`backend/.env.example`을 참고하세요.

frontend/.env.local:

    PUME_API_BASE_URL=http://127.0.0.1:8000

## 검증

    npm test -- --run
    npx tsc --noEmit
    npm run build

상담 API 계약은 baseline|optimized arm을 사용하며, /api/[...path]가 FastAPI로
요청을 전달합니다. baseline은 `/turns/stream` NDJSON을 사용하고 optimized는 기존
완전 JSON 응답을 유지합니다.
