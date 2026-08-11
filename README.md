FlowLink

AI가 수면 위 폐기물과 개인 물품 후보를 탐지하고, 분실 신고·매칭·관리자 처리까지 연결하는 통합 웹 서비스입니다.

FlowLink는 이미지·영상·웹캠에서 객체를 탐지하고, 개인 물품 후보를 시민의 분실 신고와 연결하여 관리자 확인·회수·반환까지 이어주는 서비스입니다.

빠른 시작

처음 참여하는 팀원은 다음 순서로 진행합니다.

GitHub 저장소 초대 수락
↓
Repository Clone
↓
develop 최신화
↓
개인 feature 브랜치 생성
↓
Frontend / Backend / Backend AI 환경 설정
↓
개발 및 테스트
↓
Commit / Push
↓
Pull Request → develop

확인 주소:

Frontend
http://localhost:3000

Backend
http://localhost:8000

Backend AI
http://localhost:8001

⚠️ 실제 비밀번호, API Key, JWT Secret, .env, AI 모델 파일은 README나 GitHub에 기록하지 않습니다.

1. 기술 스택
영역	기술
Frontend	Next.js 16, TypeScript
Backend	FastAPI, Python 3.12
Backend AI	FastAPI, Python 3.12, Ultralytics YOLO
Database	PostgreSQL
ORM	SQLAlchemy 2.x
DB Driver	psycopg 3
AI	Ultralytics YOLO Object Detection
Map	Kakao Maps JavaScript API
DB Tool	DBeaver
Version Control	Git, GitHub
2. 서버 구성

FlowLink는 개발 및 최종 배포 구조를 다음 3개 서비스로 분리합니다.

서비스	개발 주소	역할
Frontend	http://localhost:3000	사용자·관리자 화면
Backend	http://localhost:8000	인증·DB·업무 API
Backend AI	http://localhost:8001	YOLO 이미지·영상·웹캠 추론
PostgreSQL	localhost:5432 또는 원격 DB	애플리케이션 데이터

구조:

Browser
   │
   ▼
Frontend
Next.js :3000
   │
   ├──────────────────┐
   │                  │
   ▼                  ▼
Backend             Backend AI
FastAPI :8000       FastAPI :8001
   │                  │
   ▼                  ▼
PostgreSQL          YOLO Model
                    best.pt
3. Backend와 Backend AI 역할
Backend

일반 서비스와 데이터 처리를 담당합니다.

회원가입 / 로그인
사용자 권한
관리자 권한
분실 신고
발견물
자동 매칭
소유권 확인 요청
알림
관리자 처리
DB CRUD
업무 상태 변경
Backend AI

AI 추론만 담당합니다.

이미지 객체 탐지
영상 객체 탐지
영상 객체 추적
웹캠 프레임 탐지
Bounding Box
Class
Confidence
Track ID

AI 서버는 일반 회원·분실 신고·소유권·관리자 업무 데이터를 직접 수정하지 않는 것을 기본 원칙으로 합니다.

4. ai/와 backend-ai/ 차이

이 부분은 특히 AI 담당자가 헷갈리지 않도록 꼭 확인합니다.

ai/
→ 모델을 만드는 곳

backend-ai/
→ 만들어진 모델을 서비스에서 실행하는 곳
ai/
데이터셋
모델 학습
모델 평가
테스트 이미지
테스트 영상
실험 결과
backend-ai/
FastAPI
YOLO runtime
이미지 inference
영상 inference
웹캠 inference
API response
5. 프로젝트 구조
flowlink/
├─ frontend/
│  └─ Next.js 사용자·관리자 화면
│
├─ backend/
│  └─ FastAPI 일반 서비스 API
│
├─ backend-ai/
│  └─ FastAPI AI inference API
│
├─ ai/
│  └─ AI 학습·평가·실험
│
├─ database/
│  └─ PostgreSQL schema / seed
│
├─ docs/
│  └─ API 및 프로젝트 문서
│
├─ .gitignore
└─ README.md
6. 브랜치 운영
main
  ↑
develop
  ↑
feature/*
fix/*
docs/*
main

최종 검증된 코드만 병합합니다.

❌ 직접 개발 금지
❌ 직접 push 금지
develop

팀 기능 통합 브랜치입니다.

feature/*
   ↓
Pull Request
   ↓
develop
feature 브랜치

실제 기능 개발은 개인 feature 브랜치에서 진행합니다.

예:

feature/auth
feature/citizen-map
feature/webcam-detection
feature/ai-service-split
feature/model-integration
feature/video-tracking
7. 처음 Repository Clone

PowerShell:

cd C:\Users\<사용자명>

git clone https://github.com/yj4976s-cpu/flowlink.git

cd flowlink

git fetch --all --prune

git switch develop

git pull --ff-only origin develop

확인:

git branch --show-current

정상 결과:

develop
8. 개인 브랜치 생성
git switch develop
git pull --ff-only origin develop

예:

git switch -c feature/model-integration

처음 Push:

git push -u origin feature/model-integration
9. Frontend 최초 설정
cd frontend

npm.cmd ci

Copy-Item .env.example .env.local

npm.cmd run dev

확인:

http://localhost:3000

.env.local은 GitHub에 Commit하지 않습니다.

10. Backend 최초 설정
cd backend

py -3.12 --version

py -3.12 -m venv .venv

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt

Copy-Item .env.example .env

python -m uvicorn app.main:app --reload --port 8000

확인:

Backend
http://localhost:8000

Health
http://localhost:8000/health

Swagger
http://localhost:8000/docs
11. Backend AI 최초 설정
cd backend-ai

py -3.12 --version

py -3.12 -m venv .venv

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt

Copy-Item .env.example .env

python -m uvicorn app.main:app --reload --port 8001

확인:

Backend AI
http://localhost:8001

Health
http://localhost:8001/health

Swagger
http://localhost:8001/docs
12. 전체 서버 실행

개발 시 VS Code Terminal 3개를 사용하는 것을 권장합니다.

Terminal 1 — Frontend
cd C:\Users\<사용자명>\flowlink\frontend

npm.cmd run dev
Terminal 2 — Backend
cd C:\Users\<사용자명>\flowlink\backend

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.venv\Scripts\Activate.ps1

python -m uvicorn app.main:app --reload --port 8000
Terminal 3 — Backend AI
cd C:\Users\<사용자명>\flowlink\backend-ai

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.venv\Scripts\Activate.ps1

python -m uvicorn app.main:app --reload --port 8001
13. 환경변수
Frontend

예:

NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_AI_API_BASE_URL=http://localhost:8001
NEXT_PUBLIC_KAKAO_MAP_JS_KEY=

실제 변수명은 서버 분리 PR에서 확정된 .env.example을 기준으로 사용합니다.

Backend

주요 역할:

DATABASE_URL
JWT_SECRET_KEY
JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES
FRONTEND_URL

Backend는 PostgreSQL과 업무 API 설정을 담당합니다.

Backend AI

주요 역할:

DETECTION_MODEL
DETECTION_CONFIDENCE
DETECTION_IMGSZ
FRONTEND_URL

예:

DETECTION_MODEL=yolo11n.pt
DETECTION_CONFIDENCE=0.25
DETECTION_IMGSZ=640

최종 모델 연결 후:

DETECTION_MODEL=models/best.pt

형태로 변경할 수 있습니다.

⚠️ 실제 .env 값은 GitHub에 업로드하지 않습니다.

14. AI 모델 구조

FlowLink는 이미지·영상·웹캠에 최종적으로 동일한 YOLO 모델을 사용합니다.

                  YOLO Runtime
                      │
                    best.pt
                      │
        ┌─────────────┼─────────────┐
        │             │             │
      Image         Video         Webcam

즉 각 기능에서 best.pt를 따로 여러 번 로드하는 것이 아니라 하나의 공용 모델 runtime을 사용합니다.

15. 현재 AI 기능 상태
이미지 탐지
이미지 업로드
→ YOLO inference
→ bbox
→ class
→ confidence
→ 탐지 기록 저장

현재 기본 pretrained YOLO 모델로 실제 inference가 가능합니다.

웹캠 탐지
Browser Webcam
→ JPEG frame
→ Backend AI
→ YOLO inference
→ bbox / class / confidence
→ 실시간 화면 표시

웹캠 프레임은 DB 또는 파일에 저장하지 않는 것을 원칙으로 합니다.

영상 탐지

영상 업로드 기능과 작업 구조는 존재하며, 최종 모델 연결 후 실제 영상 inference와 tracking을 연결할 예정입니다.

목표:

MP4
↓
YOLO
↓
ByteTrack 또는 BoT-SORT
↓
track_id
↓
first_seen_ms
last_seen_ms
appearance_count
16. AI 모델 담당자 전달 규칙

최종 모델을 전달할 때 best.pt만 전달하지 않습니다.

같이 전달:

1. best.pt

2. Ultralytics 버전

3. 클래스 목록

4. class id → class name

5. 권장 confidence threshold

6. 권장 imgsz

7. 테스트 이미지

8. 테스트 영상

9. 간단한 평가 결과

예:

0 = TRASH
1 = BRANCH
2 = AQUATIC_PLANT
3 = BAG
4 = UMBRELLA
5 = FOOTWEAR
6 = BALL

실제 순서는 반드시 모델의:

model.names

를 기준으로 합니다.

17. 모델 파일 GitHub 업로드 금지

다음 파일은 GitHub에 올리지 않습니다.

best.pt
last.pt
*.pt
*.pth
*.onnx

datasets/
runs/
weights/

.env
API KEY
비밀번호
업로드 영상

현재 저장소 .gitignore에도 .pt/.pth/.onnx 차단 규칙이 들어가 있어.

18. 개발 전 develop 최신화
git status

git fetch origin

git switch develop

git pull --ff-only origin develop

git switch feature/<내-브랜치>

git merge develop

작업 중 변경 사항이 있다면 먼저 Commit하거나:

git stash push -m "WIP before develop sync"

사용.

복원:

git stash pop
19. 작업 완료 후
git status

git diff

git diff --stat

변경 확인 후:

git add .

git status

민감한 파일이 없는지 다시 확인합니다.

Commit:

git commit -m "feat: implement model integration"

Push:

git push

GitHub에서:

base: develop

compare: feature/<내브랜치>

로 Pull Request를 만듭니다.

20. Commit 규칙
접두사	용도
feat	새로운 기능
fix	버그 수정
design	UI/CSS
refactor	구조 개선
docs	문서
test	테스트
chore	설정/의존성

예:

feat: add webcam detection
feat: integrate custom YOLO model
feat: add video tracking
fix: cleanup webcam stream
refactor: split AI inference server
docs: update local setup guide
21. 금지 사항 🚨
❌ main 직접 push

❌ develop에서 직접 기능 개발

❌ git push --force

❌ .env Commit

❌ API Key Commit

❌ DB 비밀번호 Commit

❌ best.pt Commit

❌ 전체 AI dataset Commit

❌ node_modules Commit

❌ .venv Commit

❌ 다른 팀원 코드 임의 삭제

❌ DB schema 임의 변경

❌ 모델 class 이름 임의 변경

❌ 합의 없이 API 응답 변경

❌ npm audit fix --force 무단 실행
22. VS Code 권장 Extension
Python
Pylance
ESLint
Tailwind CSS IntelliSense
GitLens — 선택
Codex
23. Codex 사용

Codex를 사용할 때는 먼저 프로젝트 전체를 엽니다.

cd C:\Users\<사용자명>\flowlink

code .

작업 전:

git status
git branch --show-current

확인.

Codex에게 처음에는:

현재 FlowLink 프로젝트 구조를 먼저 확인해줘.

나는 지금 feature 브랜치에서 작업 중이다.

수정하기 전에:

- 현재 브랜치
- 변경 파일
- 관련 architecture
- 기존 naming/style

을 먼저 확인해줘.

아직 코드는 수정하지 마.

처럼 요청하는 것이 좋습니다.

24. PR 전 체크
✅ feature 브랜치인가?

✅ develop 최신화했는가?

✅ .env가 포함되지 않았는가?

✅ best.pt가 포함되지 않았는가?

✅ 테스트가 통과했는가?

✅ Frontend lint/build가 통과했는가?

✅ 다른 기능을 깨뜨리지 않았는가?

✅ API 변경을 PR 설명에 작성했는가?

✅ UI 변경 시 스크린샷을 첨부했는가?

