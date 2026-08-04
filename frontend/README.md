# Pume Village Game Web

동숲 스타일 진입·캐릭터 선택·마을 탐색·‘프바오와 나 찾기’ 화면을 제공하는 Next.js 앱입니다.

실제 상담 화면은 A · 말하며 판단 파이프라인만 사용합니다. 프바오가 공감을 먼저
말하는 동안 메모리에서 검수된 원리를 검색하고, 명백한 단일 슬롯은 로컬로 넘기며
애매한 답만 Gemini가 판단합니다.

## 실행

FastAPI를 먼저 127.0.0.1:8000에서 실행한 뒤:

    npm ci
    npm run dev

브라우저: <http://127.0.0.1:3000/>

상담 입력창의 `목소리 대화 시작`을 한 번 누르면 연속 음성 세션이 시작됩니다.
브라우저의 Silero VAD가 말의 시작과 끝을 감지하고, 발화가 끝나면 별도의 전송
버튼 없이 `STT → Gemini → GPT-SoVITS`를 실행합니다. 프바오 음성이 끝난 뒤에는
250ms의 안전 간격 후 자동으로 다음 말을 듣습니다. 프바오가 말하는 동안에는
마이크 입력을 멈추는 반이중 방식이라 스피커 소리가 사용자 발화로 다시 들어가지
않습니다.

VAD는 `public/vad`에 저장된 모델·AudioWorklet·ONNX Runtime WASM을 로컬에서
불러옵니다. TTS는 raw PCM 문장 조각을 하나의 AudioWorklet 버퍼에 이어 붙여
문장 사이의 재생 공백을 최소화합니다. 음성 서버 설정은
`backend/.env.example`을 참고하세요.

가치 선택 화면은 페이지 자체를 스크롤하지 않습니다. 데스크톱에서는 27개를 한
화면에 표시하고, 모바일에서는 9개씩 3페이지로 보여줍니다. 선택한 5개 가치는
하단 고정 영역에서 확인하거나 다시 뺄 수 있습니다.

frontend/.env.local:

    PUME_API_BASE_URL=http://127.0.0.1:8000
    NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
    DEV_ALLOWED_ORIGINS=192.168.0.62

두 기기에서 같은 로컬 데모를 열 때는 `npm run dev:lan`으로 실행하고 다른 기기에서
`http://<데모 Mac의 LAN IP>:3000`에 접속합니다. 방명록 내용은 FastAPI만 읽고 쓰며,
브라우저는 Supabase의 공개 room revision 신호만 구독합니다. `DEV_ALLOWED_ORIGINS`에는
서버를 실행하는 Mac의 LAN IP를 넣고, 여러 주소가 필요하면 쉼표로 구분합니다.

건물 내부의 접속 캐릭터도 같은 `NEXT_PUBLIC_SUPABASE_URL`과
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 사용해 Presence와 Broadcast로 동기화됩니다.
플레이어 ID는 브라우저 탭의 `sessionStorage`에 자동 생성되므로 별도 환경변수나 DB
테이블이 필요하지 않습니다. 각 컴퓨터가 앱을 따로 실행할 때는 두 컴퓨터 모두 같은
Supabase 공개 URL/키를 설정하고, 한 컴퓨터가 서버를 호스팅할 때는 접속하는 쪽에서
환경변수를 설정할 필요 없이 호스트의 LAN URL만 열면 됩니다.

## 검증

    npm test -- --run
    npx tsc --noEmit
    npm run build

상담 화면의 API 요청은 baseline arm과 `/turns/stream` NDJSON만 사용합니다.
모델 선택기와 A/B 디버깅 지표는 사용자 화면에 노출하지 않습니다.
