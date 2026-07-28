# Pume Gemini Pipeline A/B Lab

같은 Gemini 모델로 상담 파이프라인과 thinking 설정을 비교하는 로컬 A/B 앱입니다.

- A — improved baseline + delivery: [juminsuh/chatbot](https://github.com/juminsuh/chatbot)
  e065de5의 상담·공감 형식을 유지하면서 먼저 말하고 동시에 판단하는 흐름
- B — optimized: 같은 최신 로직 위에 현재 슬롯 분석·응답 후보 병렬화,
  명시적 슬롯 스위치, 응답기 minimal thinking을 적용한 개선안
- 모델 공급자 — 두 arm 모두 gemini-3.5-flash

Qwen은 A/B 런타임과 상태 API에서 제거했습니다. 결과 로그는
pipeline_arm과 provider=gemini를 분리해서 기록합니다.

## 최신 baseline

업스트림 e065de5에서 다음 변경을 반영했습니다.

- 상담 슬롯 9개 → 11개: relationship, self_message 추가
- 11개 슬롯 수집 후 27개 가치 중 5개 선택
- 슬롯 통합 후 사티어 빙산 모델 기반 insight report 생성
- 최신 sufficiency 기준, 상세 질문 지침, 가치 catalog와 map_data.json
- 업스트림에서 삭제한 dense pattern matching·embedding·self-help 경로 제거

backend/counsel/baseline_nodes.py는 업스트림 상담 단계와 프바오 공감 형식을 유지하고,
일반 상담 턴을 opening 응답기와 현재 슬롯 판단기의 2회 적응형 구조로 개선했습니다.
다음 슬롯과 실제 질문은 순서 제어기가 검수된 로컬 문구에서 선택합니다.

텍스트 A/B 화면의 baseline은 응답기가 만든 동적 공감 한 문장을 먼저 표시합니다.
그와 동시에 서버 시작 때 SQLite에서 메모리로 올린 원리 뱅크를 로컬 검색하고,
맥락 점수가 충분하면 검수된 `social_context` 또는 `named_pattern` 문장을
`aside` segment로 잇습니다. 이 검색은 DB나 외부 API를 호출하지 않습니다.
원리 한마디가 없고 판단 자체가 공감 표시 후 2.2초 이상 늦을 때만 검수된
대기용 `bridge`를 사용합니다. `BASELINE_BRIDGE_DELAY_MS`는 TTS 연결 전 임시 텍스트
경계이며 이후 공감 음성의 `audio_near_end` 이벤트로 대체할 예정입니다.
공감 모델이 정체되면 `BASELINE_OPENING_LEAD_TIMEOUT_SECONDS`(기본 1.8초)에 검수된
공감 fallback을 먼저 전달하고, 두 모델 작업은 뒤에서 정상적으로 마무리합니다.

## A 개선 파이프라인

A의 일반 슬롯 턴은 응답기와 판단기를 분리합니다. 현재처럼 두 작업이 같은 Gemini
용량을 공유하면 공감을 먼저 전달한 뒤 판단기를 호출해 동시 요청 정체를 피합니다.
물리적으로 별도인 `ANALYZER_*` API가 활성화된 경우에만 두 호출을 동시에 시작합니다.

1. `baseline_opening(minimal)`: 기존 REFLECT 공감 규칙으로 짧은 공감만 생성
2. 로컬 원리 검색: 공감 생성 중 현재 발화·슬롯·최근 원리 ID로 상위 후보를 검색
3. 전달 제어기: 공감 뒤에 검수된 원리 문장을 붙여 먼저 전달하고, 같은 원리는 순환 제한
4. `baseline_turn_analysis(low)`: 현재 슬롯 충분성과 최대 2개 부가 정보만 JSON으로 판정
5. 순서 제어기: 충분하면 다음 슬롯 질문, 부족하면 슬롯별 상세 질문을 로컬 문구로 선택
6. 응답기와 판단기의 4초 실패 상한을 넘으면 안정적인 로컬 문구로 fallback

명시적으로 모른다는 답은 다시 캐묻지 않고 unknown으로 저장한 뒤 다음 슬롯으로
넘어갑니다. 판단·응답 fallback 사용 여부와 횟수는 각 턴 metrics에 기록합니다.
원리 출력은 기본적으로 `named_pattern`과 `social_context`만 허용하며, 위기·사별·폭력·
의료·법률 맥락, 단순 기간 답, 명시적 모름, 충분히 긴 답에는 생략합니다.

## B 개선 파이프라인

일반 슬롯 턴에서 두 Gemini 호출을 동시에 시작합니다.

1. target_slot_analysis: 현재 질문 대상 슬롯을 판정하고, 답변에 함께 나온
   다른 슬롯 정보를 최대 2개까지 추출
2. response_candidates: 공감 문장, 충분할 때의 다음 슬롯 질문,
   불충분할 때의 상세 질문을 한 번에 생성
3. 코드가 분석 결과에 따라 맞는 후보를 선택
4. 슬롯 스위치를 off → asking → on/unknown으로 갱신하고 다음 off 슬롯으로 이동

현재 슬롯 판정은 sufficient/detail/explicit_unknown/off_target/no_answer/uncertain을
구분합니다. 명시적으로 모른다는 답은 바로 unknown으로 넘어가며, off-target 답변에
포함된 다른 슬롯 값은 버리지 않습니다. 충분하고 신뢰도 높은 부수 슬롯은 on으로
완료하고, 부분 정보는 저장하되 이후 확인 대상으로 남깁니다.

일반 턴 기준 A와 B 모두 2회 호출입니다. A는 공감만 LLM이 작성하고 판단기는
슬롯 정보만 판정하며, 실제 원리 한마디·질문·순서는 코드가 고정합니다. 두 arm 모두 충분한 부수 슬롯을
건너뛸 수 있습니다. 낮은 confidence는 보수적으로 한 번 상세 질문하며, 같은 슬롯을
두 번 답하지 못하면 unknown으로 닫아 무한 재질문을 막습니다.
target_slot_analysis에는 기본 3.5초 provider 요청 timeout 예산을 적용하고, 실패하거나 제한 시간을
넘으면 늦은 결과를 background에서 상태에 반영하지 않고 보수적인 상세 질문으로
fallback합니다. `TARGET_ANALYZER_TIMEOUT_SECONDS`로 예산을 조정할 수 있습니다.

두 arm의 사용자 응답기는 Gemini native `minimal` thinking을 사용합니다. A 응답기는
공감만 쓰며 질문을 생성하지 않습니다. A 판단기는 primary API의 `low`로 동작합니다.
B 판단기는 `analyzer` 논리 경로에서 `low`로
동작합니다. `ANALYZER_API_ENABLED=false`인 기본 상태에서는 primary 연결을 상속하고,
별도 프로젝트/API와 쿼터가 준비된 경우에만 `ANALYZER_*` 설정과 함께 활성화합니다.
화면의 `판단 API 공유/분리` 표시는 이 실제 설정을 `/api/health`에서 읽은 결과입니다.

라포 4단계, 안전 우회, 11개 슬롯, 가치 선택, 최종 빙산 리포트는 두 arm이 공유합니다.
A/B 모두 라포의 고정 질문 사이 공감을 같은 Gemini `minimal` REFLECT 호출로 생성하고,
본 상담에 진입한 뒤부터 각 arm의 일반 상담 구조가 달라집니다.
baseline의 전달 방식은 `dynamic_principle_aside_v4`, 일반 상담 호출 구조는
`principle_cache_speaking_v5`로 구분됩니다. 결과의 `first_response_ms`,
`reflection_ready_ms`, `aside_emitted`, `bridge_emitted`는 서버에서 segment가 준비된 시점을 기록합니다.
화면의 `브라우저 첫 표시`는 요청 직전부터 실제 segment를 받은 순간까지를 별도로 재서,
프록시·전송·렌더링 지연이 서버 지표와 섞이지 않게 비교합니다.

## 실행

    cd backend
    source ../.venv/bin/activate
    ../.venv/bin/python -m pip install -r requirements-dev.txt
    cp .env.example .env

.env에서 Vertex ADC 또는 API key 모드 중 하나를 설정합니다.

    GEMINI_AUTH_MODE=vertex_adc
    GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
    GOOGLE_CLOUD_LOCATION=global
    GEMINI_MODEL=gemini-3.5-flash

원리 JSON을 수정한 경우에는 검증 후 새 버전을 명시적으로 활성화합니다. 기존 활성
버전을 서버 시작만으로 덮어쓰지 않기 때문에 운영 롤백도 같은 방식으로 관리할 수 있습니다.

    ../.venv/bin/python scripts/activate_principle_bank.py
    GEMINI_REASONING_EFFORT=low
    BASELINE_RESPONSE_THINKING_LEVEL=minimal
    BASELINE_ANALYZER_REASONING_EFFORT=low
    OPTIMIZED_RESPONSE_THINKING_LEVEL=minimal
    OPTIMIZED_ANALYZER_REASONING_EFFORT=low
    ANALYZER_API_ENABLED=false
    AB_MOCK_MODE=false

FastAPI:

    ../.venv/bin/python -m uvicorn app.server:app --host 127.0.0.1 --port 8000

Next.js 3D 마음연구소:

    cd ../frontend
    npm ci
    npm run dev

- A/B 실험실: <http://127.0.0.1:8000/>
- 판다 상담 데모: <http://127.0.0.1:8000/demo>
- 3D 마음연구소: <http://127.0.0.1:3000/>

세 화면 모두 baseline|optimized arm을 사용합니다. Next.js의 /api/*는
FastAPI 127.0.0.1:8000으로 프록시됩니다.

### 브라우저 음성 입출력

3000번 상담 화면은 키보드와 마이크 입력을 같은 상담 `message`로 합칩니다.
마이크로 녹음한 WebM/MP4 오디오는 FastAPI가 ffmpeg로 16 kHz mono PCM으로
변환한 뒤 `juminsuh/chatbot`과 같은 pywhispercpp `small` 모델로 인식합니다.
오인식이 상담 상태를 바로 바꾸지 않도록 인식 결과는 입력창에서 확인한 뒤
전송합니다.

    brew install ffmpeg
    .venv/bin/pip install -r backend/requirements.txt
    .venv/bin/python backend/scripts/download_stt.py small

TTS는 `mgusdn/chatbot-voice`와 같은 GPT-SoVITS `/tts` 계약과
`streaming_mode=3`을 사용합니다. `pume-org/tts`의 API 서버와 가중치를 먼저
준비하고 `.env`에 다음 값을 넣습니다.

    TTS_SERVER_URL=http://127.0.0.1:9880
    TTS_REF_AUDIO_PATH=/absolute/path/to/reference.wav
    TTS_REF_TEXT=참조 WAV에서 실제로 말한 문장

응답 생성과 음성 합성은 분리되어 있습니다. 텍스트는 도착 즉시 보이고,
공감·연결말·질문은 브라우저 음성 큐에서 순서대로 재생됩니다. 봇 음성을 STT가
다시 받아쓰지 않도록 녹음을 시작하면 재생 중인 TTS를 중단합니다.

### 3D 마음연구소 구성

- 동물 주민 6명: 펫형 `나비·파도·콩이`, 이족보행형 `마스터·여울·비앙카`
- 사람 주민 6명: 미니형 `새싹이·구름이`, 오리지널형 `도토리·마루`,
  Quaternius 기반 `미라·하루`
- 해안 세계: 잔디에서 모래·얕은 물·바다로 이어지는 산책 경계와 먼 섬,
  등대, 배, 갈매기 실루엣
- 프로메테우스 추억방: 한 줄 추억·기분·짧은 이야기를 게시판, 벽, 바닥,
  기록 테이블에 직접 배치하고 다시 옮길 수 있는 별도 영구 공간

추억방은 상담 세션·대화 원문 및 24시간 커먼스 흔적과 분리된
`data/memories.sqlite3`를 사용합니다. 공개 내용은 사용자가 직접 입력한 텍스트만
받으며, 익명 소유 토큰·공감 중복 방지·신고·자동 숨김·입력 안전 검사를 적용합니다.

## API

- GET /api/health: Gemini 설정과 연결 상태
- GET /api/speech/health?probe=true&warm=true: STT 모델 준비 및 TTS 연결 상태
- POST /api/speech/transcriptions: 브라우저 녹음 원본을 텍스트로 변환
- POST /api/speech/synthesis: 짧은 수명의 TTS 재생 티켓 생성
- GET /api/speech/synthesis/{ticket}: GPT-SoVITS WAV 스트림
- POST /api/experiments: baseline/optimized 독립 세션 생성
- POST /api/experiments/{id}/turns
- POST /api/experiments/{id}/turns/stream: baseline 공감·선택적 브리지와 arm별 최종
  결과를 NDJSON으로 전달

요청 예:

    {
      "message": "요즘 해야 할 일을 계속 미루게 돼요.",
      "arms": ["baseline", "optimized"]
    }

- GET /api/experiments/{id}/demo-state?arm=baseline|optimized
- POST /api/experiments/{id}/ratings

오늘의 커먼스 흔적은 상담 데이터와 분리된 SQLite에 저장되고 서울 날짜 기준으로
조회되며 24~30시간 뒤 만료됩니다. 상담 대화나 리포트는 공개 흔적으로 자동 전송하지
않고, 사용자가 별도로 입력한 60자 이하 문구만 익명 별칭으로 공개합니다.

- GET /api/commons/today
- POST /api/commons/guestbook
- POST /api/commons/installations
- POST /api/commons/traces/{id}/reactions
- POST /api/commons/traces/{id}/reports
- DELETE /api/commons/traces/{id}

프로메테우스 추억방:

- GET /api/memory-rooms/prometheus
- GET /api/memory-rooms/prometheus/memories
- POST /api/memory-rooms/prometheus/memories
- GET /api/memory-rooms/prometheus/memories/{id}
- PATCH /api/memory-rooms/prometheus/memories/{id}/placement
- POST /api/memory-rooms/prometheus/memories/{id}/reactions
- POST /api/memory-rooms/prometheus/memories/{id}/reports
- DELETE /api/memory-rooms/prometheus/memories/{id}

상담 원문은 기본 JSONL 로그에서 가리고, 해시·지연·호출 수·token·재시도·
pipeline_arm·provider를 기록합니다. AB_LOG_CONTENT=true일 때만 원문을 남깁니다.

## 검증

    cd backend
    ../.venv/bin/pytest -q
    cd ../frontend
    npm test -- --run
    npx tsc --noEmit
    npm run build

실제 Gemini smoke:

    cd backend
    ../.venv/bin/python scripts/smoke_live.py
    ../.venv/bin/python scripts/smoke_full_session.py --arm baseline
    ../.venv/bin/python scripts/smoke_full_session.py --arm optimized

AB_MOCK_MODE=true는 UI·상태 전이 테스트용이며 성능 비교 결과로 사용하면 안 됩니다.
