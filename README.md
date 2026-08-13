# 🌊 FlowLink

> **AI 기반 수면 부유 객체 탐지 및 맞춤 대응 서비스**

FlowLink는 이미지·영상·웹캠에서 수면 위 객체를 탐지하고,  
개인 물품 후보를 시민의 분실 신고와 연결하여  
**관리자 확인 → 회수 → 반환**까지 지원하는 통합 웹 서비스입니다.

---

## ✨ 주요 기능

### 👤 시민

- 회원가입 및 로그인
- 발견된 개인 물품 검색
- 분실 신고
- 발견물 자동 매칭
- 소유권 확인 요청
- 처리 상태 및 알림 확인

### 🛡️ 관리자

- AI 탐지 결과 확인
- 탐지 객체 분류 수정
- 폐기물 수거 처리
- 개인 물품 회수 및 관리
- 소유권 요청 승인·거절
- 반환 완료 처리

### 🤖 AI

- 이미지 객체 탐지
- 영상 객체 탐지
- 객체 Tracking
- 웹캠 프레임 탐지
- Bounding Box / Class / Confidence 출력

---

## 🏗️ 서비스 구조

```text
                    Browser
                       │
                       ▼
              ┌─────────────────┐
              │    Frontend     │
              │ Next.js :3000   │
              └────────┬────────┘
                       │
            ┌──────────┴──────────┐
            │                     │
            ▼                     ▼
    ┌───────────────┐     ┌───────────────┐
    │    Backend    │     │  Backend AI   │
    │ FastAPI :8000 │     │ FastAPI :8001 │
    └───────┬───────┘     └───────┬───────┘
            │                     │
            ▼                     ▼
      PostgreSQL              YOLO Model
        :5432                  best.pt
```

| 서비스 | 개발 주소 | 역할 |
| --- | --- | --- |
| Frontend | `http://localhost:3000` | 사용자·관리자 화면 |
| Backend | `http://localhost:8000` | 인증·DB·업무 API |
| Backend AI | `http://localhost:8001` | YOLO 이미지·영상·웹캠 추론 |
| PostgreSQL | `localhost:5432` | 애플리케이션 데이터 |

> Frontend는 Backend만 호출하고, Backend가 내부 HTTP로 Backend AI에 추론을 요청합니다. Backend AI는 브라우저에 직접 노출하지 않습니다.

---

## 🧰 기술 스택

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.12 |
| Backend AI | FastAPI, Python 3.12 |
| AI | Ultralytics YOLO |
| Database | PostgreSQL |
| ORM | SQLAlchemy 2.x |
| DB Driver | psycopg 3 |
| Map | Kakao Maps JavaScript API |
| DB Tool | DBeaver |
| Version Control | Git, GitHub |

---

## 📁 프로젝트 구조

```text
flowlink/
├─ frontend/            # Next.js 사용자·관리자 화면
│
├─ backend/             # 일반 서비스 FastAPI
│
├─ backend-ai/          # AI inference FastAPI
│
├─ ai/                  # AI 학습·평가·실험
│
├─ database/            # PostgreSQL schema / seed
│
├─ docs/                # API 및 프로젝트 문서
│
├─ .gitignore
└─ README.md
```

### `ai/`와 `backend-ai/`의 차이

```text
ai/
└─ 모델을 만드는 영역
   ├─ dataset
   ├─ training
   ├─ evaluation
   └─ experiments

backend-ai/
└─ 만들어진 모델을 서비스에서 실행하는 영역
   ├─ FastAPI
   ├─ image inference
   ├─ video inference
   ├─ webcam inference
   └─ API response
```

---

## 🚀 빠른 시작

처음 프로젝트에 참여하는 경우 다음 순서로 진행합니다.

```text
GitHub 저장소 초대 수락
        ↓
Repository Clone
        ↓
develop 최신화
        ↓
개인 feature 브랜치 생성
        ↓
개발환경 설정
        ↓
개발 및 테스트
        ↓
Commit / Push
        ↓
Pull Request
        ↓
develop
```

---

## 1️⃣ Repository Clone

PowerShell에서 실행합니다.

```powershell
cd C:\Users\<사용자명>

git clone https://github.com/yj4976s-cpu/flowlink.git

cd flowlink

git fetch --all --prune

git switch develop

git pull --ff-only origin develop
```

현재 브랜치 확인:

```powershell
git branch --show-current
```

정상 결과:

```text
develop
```

---

## 2️⃣ 개인 작업 브랜치 생성

기능 개발은 `develop`에서 직접 하지 않습니다.

```powershell
git switch develop

git pull --ff-only origin develop

git switch -c feature/<기능명>
```

예:

```powershell
git switch -c feature/model-integration
```

처음 Push:

```powershell
git push -u origin feature/model-integration
```

---

---

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

---

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

---

## 현재 구현 상태

- 인증: 회원가입, 로그인, HttpOnly cookie 기반 인증
- 시민 화면: 발견물, 분실 신고, 매칭 후보, 소유권 요청, 알림
- 관리자 화면: 대시보드, 탐지/제보/발견물/소유권 검토
- 지도: 시민용 발견물 지도와 발견물 센터 내 지도 탐색
- 이미지 AI: Backend → Backend AI → YOLO 실제 추론
- 웹캠 AI: 실시간 raw inference frame은 자동 DB 저장하지 않지만, 사용자가 발견 제보를 확정하면 선택된 탐지 frame이 CitizenReport evidence 이미지로 저장됨
- 영상 AI: 업로드, VideoJob 저장, Backend AI ByteTrack 추론 메타데이터 보존
- Custom model: 모델 파일은 Git에 올리지 않고 `backend-ai/.env`의 `DETECTION_MODEL=models/best.pt`처럼 배포 환경에서만 경로 지정

---

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

---

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

---

## 🌿 브랜치 운영

```text
main
 ↑
develop
 ↑
feature/*
fix/*
docs/*
```

### `main`

최종 검증된 코드만 관리합니다.

- ❌ 직접 개발 금지
- ❌ 직접 Push 금지

### `develop`

팀 기능을 통합하는 개발 브랜치입니다.

```text
feature/*
    ↓
Pull Request
    ↓
develop
```

### 브랜치 예시

```text
feature/auth
feature/citizen-map
feature/webcam-detection
feature/model-integration
feature/video-tracking

fix/login-validation

docs/api-spec
```

---

## 🔄 작업 시작 전

작업 전 최신 `develop`을 반영합니다.

```powershell
git status

git fetch origin

git switch develop

git pull --ff-only origin develop

git switch feature/<내-브랜치>

git merge develop
```

작업 중인 변경 사항을 임시 저장해야 한다면:

```powershell
git stash push -m "WIP before develop sync"
```

복원:

```powershell
git stash pop
```

---

## 📤 작업 완료 후

먼저 변경 내용을 확인합니다.

```powershell
git status

git diff

git diff --stat
```

Commit:

```powershell
git add .

git status

git commit -m "feat: implement model integration"

git push
```

GitHub에서 Pull Request를 생성합니다.

```text
base: develop
compare: feature/<내-브랜치>
```

---

## 📝 Commit 규칙

| 접두사 | 용도 |
| --- | --- |
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `design` | UI / CSS |
| `refactor` | 구조 개선 |
| `docs` | 문서 |
| `test` | 테스트 |
| `chore` | 설정 / 의존성 |

예:

```text
feat: add webcam detection
feat: integrate custom YOLO model
fix: cleanup webcam stream
refactor: split AI inference server
docs: update local setup guide
```

---

## 🤖 AI 모델 관리

FlowLink는 이미지·영상·웹캠에서 동일한 YOLO 모델을 사용하는 것을 기본으로 합니다.

```text
             YOLO Runtime
                  │
               best.pt
                  │
        ┌─────────┼─────────┐
        │         │         │
      Image     Video     Webcam
```

모델 담당자는 최종 모델 전달 시 다음 정보를 함께 공유합니다.

- `best.pt`
- Ultralytics 버전
- 클래스 목록
- `class id → class name`
- 권장 Confidence Threshold
- 권장 `imgsz`
- 테스트 이미지
- 테스트 영상
- 간단한 평가 결과

클래스 순서는 반드시 실제 모델의:

```python
model.names
```

결과를 기준으로 합니다.

---

## 🔐 보안 및 Git 관리

다음 항목은 GitHub에 업로드하지 않습니다.

```text
.env
.env.local

API Key
JWT Secret
DB Password

best.pt
last.pt
*.pt
*.pth
*.onnx

datasets/
runs/
weights/

node_modules/
.venv/

업로드 이미지·영상
```

> ⚠️ 실제 비밀번호, API Key, JWT Secret 및 `.env` 값은 README나 GitHub에 기록하지 않습니다.

---

## ✅ Pull Request 전 체크

- [ ] 현재 브랜치가 `feature/*` 또는 `fix/*`인가?
- [ ] 최신 `develop`을 반영했는가?
- [ ] `.env`가 포함되지 않았는가?
- [ ] AI 모델 파일이 포함되지 않았는가?
- [ ] 관련 테스트가 통과했는가?
- [ ] Frontend lint/build가 통과했는가?
- [ ] 기존 기능에 회귀가 없는가?
- [ ] API 변경 사항을 PR에 작성했는가?
- [ ] UI 변경 시 스크린샷을 첨부했는가?

---

## 📚 개발 문서

자세한 개발 방법은 프로젝트 Notion 및 `docs/` 문서를 참고합니다.

| 문서 | 내용 |
| --- | --- |
| GitHub 협업 가이드 | Clone, Branch, Commit, Push, Pull Request |
| VS Code 개발환경 세팅 | 프로젝트 최초 실행 방법 |
| API 명세 | Frontend ↔ Backend ↔ Backend AI 계약 |
| DB 설계 | PostgreSQL Schema 및 관계 |
| AI 가이드 | 모델 학습·평가·전달 규칙 |

---

## ⚠️ 프로젝트 작업 규칙

- `main` 직접 Push 금지
- `develop` 직접 기능 개발 금지
- `git push --force` 금지
- `.env`, API Key, DB 비밀번호 Commit 금지
- AI 모델 및 전체 Dataset Commit 금지
- 다른 팀원 코드 임의 삭제 금지
- DB Schema 임의 변경 금지
- 모델 Class 이름 임의 변경 금지
- 합의 없이 API Request / Response 변경 금지
- `npm audit fix --force` 임의 실행 금지
