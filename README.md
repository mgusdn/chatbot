# Pume Counseling Village

프메의 숲 3D 게임 화면과 Gemini 기반 상담 파이프라인을 함께 관리하는
모노레포입니다. 브라우저에서는 같은 Gemini 모델을 사용하는 baseline과 optimized
상담 흐름을 비교할 수 있습니다.

## Repository layout

```text
.
├── backend/                 # FastAPI, LangGraph 상담 로직, STT/TTS 어댑터
│   ├── app/                 # HTTP API와 정적 A/B 데모
│   ├── counsel/             # 상담 그래프, 노드, 프롬프트, 원리 뱅크
│   ├── scripts/             # 운영·검증 스크립트
│   ├── tests/               # 백엔드 단위·통합 테스트
│   ├── .env.example
│   └── requirements*.txt
├── frontend/                # Next.js 3D 마음연구소
│   ├── app/
│   ├── components/
│   ├── public/
│   └── tests/
└── docs/                    # 상담 구조와 원리 뱅크 문서
```

로컬 비밀정보, SQLite 데이터, 로그, Python/Node 가상환경과 빌드 산출물은 Git에
포함하지 않습니다.

## Local setup

Python 3.10 이상과 Node.js 20 이상이 필요합니다.

### 1. Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
cd backend
../.venv/bin/python -m uvicorn app.server:app --host 127.0.0.1 --port 8000
```

`backend/.env`에는 Vertex ADC 또는 Gemini API key 설정이 필요합니다. 실제 키는
커밋하지 않습니다.

### 2. Frontend

다른 터미널에서 실행합니다.

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

- 3D 마음연구소: <http://127.0.0.1:3000>
- A/B 실험실: <http://127.0.0.1:8000>
- 상담 데모: <http://127.0.0.1:8000/demo>

프런트의 `/api/*` 요청은 `PUME_API_BASE_URL`로 지정한 FastAPI 서버에 전달됩니다.

## Voice

- STT: 로컬 whisper.cpp 모델과 ffmpeg가 필요합니다.
- TTS: GPT-SoVITS 서버, 음성 가중치, 참조 WAV와 해당 전사문이 별도로 필요합니다.

TTS 호출 코드는 포함되어 있지만 음성 가중치는 이 저장소에 포함하지 않습니다.
자세한 환경변수는 [backend/.env.example](backend/.env.example)을 참고하세요.

## Verification

```bash
cd backend
../.venv/bin/pytest

cd ../frontend
npm test -- --run
npx tsc --noEmit
npm run build
```

실제 Gemini 연결 검증은 backend에서 별도로 실행합니다.

```bash
../.venv/bin/python scripts/smoke_live.py
../.venv/bin/python scripts/smoke_full_session.py --arm baseline
../.venv/bin/python scripts/smoke_full_session.py --arm optimized
```

## Documentation

- [상담 파이프라인 상세 구조](docs/counseling-architecture.md)
- [원리 뱅크 v1](docs/principle_bank_v1.md)
- [속담·사자성어 후보 검토](docs/principle_reference_candidates_100.md)
