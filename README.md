# FlowLink

AI가 수면 위 폐기물과 개인 물품 후보를 탐지하고, 분실 신고·매칭·관리자 처리를 연결하는 웹 서비스입니다.

## 서비스 구성

| 서비스 | 개발 주소 | 역할 |
| --- | --- | --- |
| Frontend | http://localhost:3000 | 시민·관리자 화면 |
| Backend | http://localhost:8000 | 인증, DB, 비즈니스 API, 탐지 오케스트레이션 |
| Backend AI | http://localhost:8001 | Ultralytics YOLO 추론 전용 API |
| PostgreSQL | localhost:5432 | 서비스 데이터 저장 |

브라우저는 Backend AI를 직접 호출하지 않습니다. Frontend는 기존처럼 `NEXT_PUBLIC_API_BASE_URL`로 Backend만 호출하고, Backend가 내부 HTTP로 Backend AI에 추론을 요청합니다.

```text
Browser
  → Frontend :3000
  → Backend :8000
      → PostgreSQL :5432
      → Backend AI :8001
          → YOLO Runtime
```

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js 16, TypeScript |
| Backend | FastAPI, Python 3.12 |
| Backend AI | FastAPI, Python 3.12, Ultralytics YOLO |
| Database | PostgreSQL |
| ORM | SQLAlchemy |
| Map | Kakao Maps JavaScript API |
| Version Control | Git, GitHub |

## 프로젝트 구조

```text
flowlink/
├─ frontend/    # Next.js 화면
├─ backend/     # 일반 API, 인증, DB, 탐지 결과 저장
├─ backend-ai/  # YOLO inference 전용 FastAPI 서비스
├─ ai/          # 학습/평가/실험 자료
├─ database/    # PostgreSQL 스키마와 초기 데이터
├─ docs/        # 프로젝트 문서
├─ .gitignore
└─ README.md
```

`ai/`는 학습과 평가 자료를 두는 영역이고, `backend-ai/`는 실제 서비스에서 모델을 실행하는 inference server입니다. `best.pt` 같은 모델 파일은 Git에 커밋하지 않습니다.

## 환경 변수

실제 비밀값은 `.env`, `.env.local`에만 두고 Git에 올리지 않습니다.

### Frontend

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_KAKAO_MAP_JS_KEY=
# 기존 로컬 환경 호환용 fallback입니다. 새 설정은 JS_KEY를 우선 사용하세요.
NEXT_PUBLIC_KAKAO_MAP_KEY=
```

Kakao 지도는 REST API 키가 아니라 JavaScript 키를 사용합니다. 로컬 개발 시 Kakao Developers의 JavaScript 키를 `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`에 넣고, 허용 도메인에 `http://localhost:3000`을 등록해주세요.
Frontend의 `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`는 브라우저 지도 렌더링용 JavaScript 키이고, Backend의 `KAKAO_REST_API_KEY`는 관리자 회수 물품 좌표 보정을 위한 Kakao Local API 주소/키워드 검색 REST 키입니다.

운영 Frontend는 배포된 Backend HTTPS origin을 사용합니다.

```env
NEXT_PUBLIC_API_BASE_URL=https://api.flowlink.example
NEXT_PUBLIC_KAKAO_MAP_JS_KEY=
```

실제 배포 domain은 Kakao Developers의 JavaScript 키 허용 도메인에 함께 등록해야 합니다.

### Backend

```env
APP_ENV=development
DATABASE_URL=postgresql+psycopg://flowlink_user:password@127.0.0.1:5432/flowlink
JWT_SECRET_KEY=change-this-secret-key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
AUTH_COOKIE_NAME=flowlink_access_token
UPLOAD_DIR=uploads
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=
FRONTEND_URL=http://localhost:3000
KAKAO_REST_API_KEY=
AI_SERVICE_URL=http://127.0.0.1:8001
AI_INTERNAL_API_KEY=
AI_SERVICE_TIMEOUT_SECONDS=30
AI_VIDEO_SERVICE_TIMEOUT_SECONDS=120
```

### Backend AI

```env
APP_ENV=development
AI_INTERNAL_API_KEY=
DETECTION_MODEL=yolo11n.pt
DETECTION_CONFIDENCE=0.25
DETECTION_IMGSZ=640
```

`AI_INTERNAL_API_KEY`는 Backend와 Backend AI에 같은 값을 설정합니다. `NEXT_PUBLIC_*`로 만들지 않습니다.
로컬 `.env`에는 현재 리포지토리에 올리지 않는 임의의 secret을 Backend와 Backend AI 두 곳에 동일하게 넣어줍니다. 생성한 값 자체는 README나 Git에 기록하지 않습니다.

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 운영 환경 필수 설정

`APP_ENV=production` 또는 `APP_ENV=prod`에서는 안전하지 않은 기본값을 사용하면 Backend가 시작되지 않습니다.

- `JWT_SECRET_KEY`: 기본값이 아닌 32자 이상 비밀값
- `DATABASE_URL`: 운영 PostgreSQL 연결 문자열
- `FRONTEND_URL`: 배포된 Frontend HTTPS origin, localhost/127.0.0.1 및 HTTP 금지
- `AI_INTERNAL_API_KEY`: Backend와 Backend AI에 동일하게 넣는 32자 이상 비공개 값

Backend AI도 운영 환경에서는 startup 단계에서 설정을 즉시 검증합니다. `AI_INTERNAL_API_KEY`가 비어 있거나 32자 미만이면 `/health`가 뜨기 전에 서버 시작이 실패합니다. 운영에서는 팀 custom YOLO 모델을 사용해야 하므로 `DETECTION_MODEL`도 비어 있거나 기본 `yolo11n.pt` 그대로이면 시작되지 않습니다. 모델 파일은 Git에 올리지 않고 배포 환경에만 두며, 운영 `.env`에 `DETECTION_MODEL=models/best.pt`와 팀 권장 `DETECTION_CONFIDENCE` 값을 명시합니다.
Supabase Storage는 선택 사항입니다. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` 세 값이 모두 설정되면 공개 이미지가 Supabase Storage에 저장되고, 하나라도 비어 있으면 기존 로컬 `/uploads` 저장소를 사용합니다.

## 로컬 실행

PowerShell 기준입니다.

### 1. Frontend :3000

```powershell
cd frontend
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

### 2. Backend :8000

```powershell
cd backend
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

확인:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

### 3. Backend AI :8001

```powershell
cd backend-ai
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --port 8001
```

확인:

```powershell
Invoke-RestMethod http://localhost:8001/health
```

Backend AI의 `/health`는 모델을 로드하지 않습니다. 첫 추론 요청 시점에 YOLO 모델이 lazy-load됩니다.

## 현재 구현 상태

- 인증: 회원가입, 로그인, HttpOnly cookie 기반 인증
- 시민 화면: 발견물, 분실 신고, 매칭 후보, 소유권 요청, 알림
- 관리자 화면: 대시보드, 탐지/제보/발견물/소유권 검토
- 지도: 시민용 발견물 지도와 발견물 센터 내 지도 탐색
- 이미지 AI: Backend → Backend AI → YOLO 실제 추론
- 웹캠 AI: 실시간 raw inference frame은 자동 DB 저장하지 않지만, 사용자가 발견 제보를 확정하면 선택된 탐지 frame이 CitizenReport evidence 이미지로 저장됨
- 영상 AI: 업로드, VideoJob 저장, Backend AI ByteTrack 추론 메타데이터 보존
- Custom model: 모델 파일은 Git에 올리지 않고 `backend-ai/.env`의 `DETECTION_MODEL=models/best.pt`처럼 배포 환경에서만 경로 지정

## AI 모델 전달 체크리스트

AI 담당자는 모델 파일만 전달하지 말고 아래 정보를 함께 전달합니다.

- `best.pt`
- Ultralytics version
- class id → class name 매핑
- 권장 confidence
- 권장 imgsz
- 평가 결과
- sample image
- sample video

모델 파일(`*.pt`, `*.pth`, `*.onnx`)은 `.gitignore`로 보호하며 Git에 올리지 않습니다.

데이터베이스를 완전히 초기화해야 할 때는 `database/reset.sql`을 사용할 수 있지만, 기존 FlowLink 테이블과 데이터를 삭제합니다. 운영 DB나 보존해야 할 데이터가 있는 DB에서는 실행하지 마세요.

## 검증 명령

```powershell
cd backend
python -m pytest tests -q

cd ..\backend-ai
python -m pytest tests -q

cd ..\frontend
npm.cmd run lint
npm.cmd run build
.\node_modules\.bin\tsc.cmd --noEmit

cd ..
git diff --check
```

## 협업 금지 사항

- `.env`, API key, DB password 커밋 금지
- `best.pt`, dataset, `node_modules`, `.venv` 커밋 금지
- `main` 직접 push 금지
- `develop` 직접 기능 개발 금지
- force push 금지
- Backend AI에 사용자 JWT, User ORM, DB 연결 복사 금지
