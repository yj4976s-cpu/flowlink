# FlowLink

AI가 수면 위 폐기물과 개인 물품 후보를 탐지하고, 분실 신고·매칭·관리자 처리를 연결하는 웹 서비스입니다.

## 빠른 시작

1. 저장소를 clone하고 최신 `develop`로 이동합니다.
2. `develop`에서 개인 feature 브랜치를 만듭니다.
3. `frontend`에서 의존성과 `.env.local`을 준비한 뒤 Next.js를 실행합니다.
4. `backend`에서 Python 3.12 가상환경, 의존성, `.env`를 준비한 뒤 FastAPI를 실행합니다.
5. `http://localhost:3000`, `http://localhost:8000/health`, `http://localhost:8000/docs`를 확인합니다.

> 프로젝트 세팅 내용이 `develop`에 병합된 뒤 아래 절차를 진행하세요. 실제 비밀번호와 API 키는 README나 Git에 기록하지 않습니다.

## 1. 기술 스택

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.12 |
| Database | PostgreSQL |
| ORM | SQLAlchemy 2.x |
| DB Driver | psycopg 3 |
| AI | Roboflow 또는 YOLO Object Detection |
| DB Tool | DBeaver |
| Version Control | Git, GitHub |

## 2. 서버 구성

| 서비스 | 개발 주소 | 역할 |
| --- | --- | --- |
| Next.js | http://localhost:3000 | 사용자 및 관리자 화면 |
| FastAPI | http://localhost:8000 | API, 향후 DB 및 AI 연동 |
| PostgreSQL | `localhost:5432` | 애플리케이션 데이터 |

AI 추론용 별도 웹 서버는 만들지 않습니다. 향후 FastAPI 내부 inference service에서 Roboflow API 또는 준비된 모델을 호출할 예정입니다.

```text
Browser
  → Next.js :3000
  → FastAPI :8000
      → PostgreSQL :5432
      → Roboflow 또는 YOLO
```

## 3. 프로젝트 구조

현재 저장소의 주요 구조는 다음과 같습니다.

```text
flowlink/
├─ frontend/   # Next.js 화면
├─ backend/    # FastAPI API, 향후 DB 및 AI 추론 연동
├─ ai/         # 학습 자료, 클래스 정의, 평가 결과를 관리할 영역
├─ database/   # PostgreSQL 스키마와 초기 데이터
├─ docs/       # API 명세와 프로젝트 문서
├─ .gitignore
└─ README.md
```

## 4. 사전 설치 프로그램

- Git
- Node.js 24 및 npm
- Python 3.12
- PostgreSQL
- DBeaver
- VS Code

**실행 위치: 어느 디렉터리에서든 가능**

```powershell
git --version
node -v
npm.cmd -v
py -3.12 --version
psql --version
```

PowerShell 실행 정책 때문에 `npm.ps1`이 차단되면 `npm` 대신 `npm.cmd`를 사용합니다.

## 5. 최초 저장소 clone

GitHub 조직 또는 저장소 초대를 수락한 계정을 사용합니다.

**실행 위치: `C:\Users\<사용자명>`**

```powershell
cd C:\Users\<사용자명>
git clone https://github.com/yj4976s-cpu/flowlink.git
cd flowlink
git fetch --all --prune
git switch develop
git pull --ff-only origin develop
```

- 프로젝트 세팅 PR이 `develop`에 병합된 뒤 clone하거나 pull합니다.
- 기능 브랜치는 `main`이 아닌 `develop`을 기준으로 만듭니다.
- `main`과 `develop`에서 직접 기능을 개발하지 않습니다.

## 6. 개인 기능 브랜치 생성

**실행 위치: 프로젝트 루트 `flowlink`**

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feature/admin-management
git push -u origin feature/admin-management
```

브랜치 이름 예시는 다음과 같습니다.

- `feature/auth`
- `feature/lost-reports`
- `feature/admin-management`
- `feature/detection-pipeline`
- `feature/model-integration`
- `fix/login-validation`
- `docs/api-spec`

한 기능 브랜치를 여러 명이 공유하지 않습니다. feature 브랜치는 `develop`에서 만들고, `feature → develop` Pull Request를 사용합니다. `main` 직접 push는 금지하며 `develop` 직접 push도 지양합니다. 최종 검증 후 `develop → main` Pull Request를 만듭니다.

## 7. 프론트엔드 최초 설정

현재 `package-lock.json`이 있으므로 재현 가능한 설치를 위해 `npm.cmd ci`를 사용합니다.

**실행 위치: 프로젝트 루트에서 시작**

```powershell
cd frontend
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

`package-lock.json`이 없는 경우에만 다음을 사용합니다.

**실행 위치: `flowlink\frontend`**

```powershell
npm.cmd install
```

브라우저에서 http://localhost:3000 을 확인합니다.

- `.env.local`은 GitHub에 올리지 않습니다.
- 기본 개발 확인에는 네트워크 IP 대신 `localhost`를 사용합니다.
- 다른 기기에서 IP로 접속하면 Next.js의 `allowedDevOrigins` 설정이 필요할 수 있습니다.
- npm 업데이트 알림이 나타나도 프로젝트 도중 major 버전을 임의로 올리지 않습니다.

## 8. 백엔드 최초 설정

현재 `requirements.txt`가 준비되어 있습니다.

**실행 위치: 프로젝트 루트에서 시작**

```powershell
cd backend
py -3.12 --version
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python --version
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

다음 주소를 확인합니다.

- Health: http://localhost:8000/health
- Swagger: http://localhost:8000/docs
- OpenAPI: http://localhost:8000/openapi.json

정상 health 응답은 다음과 같습니다.

```json
{
  "status": "ok",
  "service": "flowlink-api",
  "version": "0.1.0"
}
```

서버를 종료한 뒤 가상환경을 끝내려면 다음을 실행합니다.

**실행 위치: `flowlink\backend`의 활성화된 가상환경**

```powershell
deactivate
```

## 9. 백엔드 환경변수

`backend/.env.example`을 복사해 로컬 `backend/.env`를 만들고 실제 값으로 교체합니다.

| 변수 | 용도 |
| --- | --- |
| `APP_ENV` | 실행 환경 이름 |
| `APP_HOST` | FastAPI 바인딩 호스트 |
| `APP_PORT` | FastAPI 포트 |
| `DATABASE_URL` | PostgreSQL SQLAlchemy 연결 문자열 |
| `JWT_SECRET_KEY` | 향후 JWT 서명 키 |
| `JWT_ALGORITHM` | 향후 JWT 알고리즘 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 향후 액세스 토큰 만료 시간 |
| `ROBOFLOW_API_KEY` | 향후 Roboflow 연동 키 |
| `ROBOFLOW_PROJECT_ID` | 향후 Roboflow 프로젝트 식별자 |
| `ROBOFLOW_MODEL_VERSION` | 향후 Roboflow 모델 버전 |
| `UPLOAD_DIR` | 향후 업로드 파일 경로 |
| `FRONTEND_URL` | CORS에서 허용할 프론트엔드 주소 |

- 실제 `.env` 값은 팀 채널 등 안전한 경로로 전달합니다.
- `.env`를 Git에 추가하지 않습니다.
- `JWT_SECRET_KEY`의 예시 문자열을 실제 환경에서 그대로 사용하지 않습니다.
- PostgreSQL 비밀번호를 README에 기록하지 않습니다.
- Roboflow API 키는 프론트엔드 환경변수에 넣지 않습니다.
- `NEXT_PUBLIC_` 접두사가 붙은 값은 브라우저에 노출될 수 있습니다.

## 10. PostgreSQL 연결

DB 담당자가 DB host, port, name, user, password를 공유한 뒤 `backend/.env`의 `DATABASE_URL`을 수정합니다.

```dotenv
DATABASE_URL=postgresql+psycopg://<사용자>:<비밀번호>@127.0.0.1:5432/<DB명>
```

- 실제 비밀번호 예시는 문서에 작성하지 않습니다.
- 비밀번호에 `@`, `:`, `/` 같은 문자가 있으면 URL encoding이 필요할 수 있습니다.
- 현재 `database/schema.sql`과 `database/seed.sql`은 존재하지만 내용은 준비 중입니다.
- 추후 SQL 실행 순서는 DB 담당자 안내 또는 준비될 `database` 문서를 따릅니다.
- 현재 FastAPI는 `DATABASE_URL`을 읽지만 실제 DB 연결이나 CRUD를 실행하지 않습니다.

## 11. 프론트엔드와 백엔드 동시 실행

초기 설치와 환경변수 준비를 마친 뒤 PowerShell 터미널 두 개를 사용합니다.

**터미널 1 — 실행 위치: `flowlink\frontend`**

```powershell
cd C:\Users\<사용자명>\flowlink\frontend
npm.cmd run dev
```

**터미널 2 — 실행 위치: `flowlink\backend`**

```powershell
cd C:\Users\<사용자명>\flowlink\backend
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --port 8000
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Swagger: http://localhost:8000/docs

## 12. 작업 시작 전 최신 develop 반영

먼저 작업 트리 상태를 확인합니다.

**실행 위치: 프로젝트 루트 `flowlink`**

```powershell
git status
```

수정 사항이 없다면 다음 순서로 동기화합니다. `<내-브랜치>`는 실제 브랜치명으로 바꿉니다.

```powershell
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch feature/<내-브랜치>
git merge develop
```

feature 브랜치에서 `git pull origin develop`을 바로 실행하기보다 로컬 `develop`을 먼저 최신화한 뒤 merge합니다. 충돌 파일을 임의로 삭제하지 말고 팀원과 변경 의도를 확인합니다. 초보 팀원은 rebase와 force push를 기본 동기화 방법으로 사용하지 않습니다.

작업 중 변경이 있다면 먼저 commit하거나 임시 저장합니다.

```powershell
git stash push -m "WIP before develop sync"
```

동기화 후 복원합니다.

```powershell
git stash pop
```

`stash pop`에서도 충돌이 발생할 수 있으므로 `git status`로 확인합니다.

## 13. 작업 완료 및 Pull Request

**실행 위치: 프로젝트 루트 `flowlink`**

```powershell
git status
git diff
git diff --stat
git add .
git commit -m "feat: implement admin management"
git push origin feature/admin-management
```

GitHub에서 `base: develop`, `compare: feature/admin-management` 방향으로 Pull Request를 만듭니다.

PR 전 확인 항목:

- 로컬 실행과 관련 테스트 완료
- `.env`가 포함되지 않았는지 확인
- `node_modules`, `backend/.venv`, 업로드 파일이 포함되지 않았는지 확인
- 다른 기능의 회귀 여부 확인
- 화면 변경 시 스크린샷 첨부
- API 계약 변경 사항 기재

`git add .` 전에 반드시 `git status`로 포함 파일을 검토합니다.

## 14. 커밋 메시지 규칙

| 접두사 | 용도 |
| --- | --- |
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `chore` | 설정 및 의존성 |
| `docs` | 문서 |
| `refactor` | 기능 변경 없는 구조 개선 |
| `test` | 테스트 |
| `design` | 화면 스타일 |

예시:

- `feat: add lost report creation API`
- `feat: implement admin detection list`
- `fix: validate duplicate email`
- `chore: configure FastAPI project`
- `docs: add local setup guide`

## 15. 금지 사항

- `main` 직접 push
- `develop`에서 직접 기능 개발
- `.env` 및 API 키 업로드
- `node_modules` 및 `backend/.venv` 업로드
- AI 데이터셋 및 대용량 모델 파일 업로드
- 다른 팀원의 `database` 파일 임의 수정
- 합의 없이 API 경로, 상태 코드, DB 컬럼명 변경
- `npm audit fix --force` 무단 실행
- 프로젝트 도중 Node.js, Next.js, Python 주요 버전 무단 업그레이드

## 16. 자주 사용하는 명령

아래 명령은 별도 표시가 없으면 프로젝트 루트에서 실행합니다.

```powershell
# 현재 브랜치와 변경 파일
git branch --show-current
git status

# 원격 정보 및 최신 develop
git fetch --all --prune
git switch develop
git pull --ff-only origin develop

# 브랜치 생성 및 최초 push
git switch -c feature/<이름>
git push -u origin feature/<이름>

# 프론트엔드 실행
cd frontend
npm.cmd run dev
```

프론트엔드에서 루트로 돌아온 뒤 백엔드를 실행합니다.

```powershell
cd ..\backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --port 8000
```

백엔드 테스트:

```powershell
cd C:\Users\<사용자명>\flowlink\backend
.\.venv\Scripts\Activate.ps1
python -m pytest
```

## 17. 문제 해결

1. **PowerShell에서 `npm.ps1` 실행 차단**: `npm` 대신 `npm.cmd`를 사용합니다.
2. **`source` 명령 실패**: PowerShell에서는 `.\.venv\Scripts\Activate.ps1`을 사용합니다.
3. **가상환경 실행 정책 오류**: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`를 실행합니다.
4. **Python 3.14 등 다른 버전이 선택됨**: `py -3.12 -m venv .venv`로 버전을 명시합니다.
5. **포트 사용 중 오류**: 실행 중인 기존 서버를 종료하고 프론트엔드 3000, 백엔드 8000을 유지합니다.
6. **Next.js 네트워크 IP 경고**: 기본 개발 확인은 http://localhost:3000 을 사용합니다.
7. **DB 접속 실패**: PostgreSQL 서비스, `DATABASE_URL`, DB 이름·계정·비밀번호·포트를 확인합니다. 단, 현재 백엔드의 실제 DB 연결 로직은 아직 구현 전입니다.
8. **`requirements.txt` 설치 실패**: 가상환경 활성화 여부와 `python --version`이 3.12인지 확인합니다.

## 18. 현재 구현 상태

| 영역 | 현재 상태 |
| --- | --- |
| Frontend | Next.js 16 초기 프로젝트와 기본 실행 스크립트 구성 완료. 실제 FlowLink 화면 기능은 개발 전 단계 |
| Backend | FastAPI 실행 골격과 `GET /health` 구현 완료 |
| API 계약 | 인증, 분실 신고, 발견물, 매칭, 소유권 확인, 관리자 라우터가 Swagger에 노출됨. `/health` 외 API는 현재 HTTP 501 반환 |
| Database | `schema.sql`, `seed.sql` 파일은 존재하지만 현재 내용은 비어 있으며 DB 담당자가 작업 중 |
| DB 연동 | 환경변수와 의존성만 준비됨. ORM 모델, 연결 및 CRUD는 아직 구현되지 않음 |
| AI | `ai` 영역은 있으나 저장소에서 학습 완료 여부를 확인할 자료가 아직 없음. AI 담당자가 Roboflow 또는 YOLO 기반으로 진행 예정 |
| 문서 | `docs` 디렉터리는 존재하지만 현재 비어 있음 |

완료 여부가 불명확한 DB 스키마와 AI 모델 학습은 담당자 확인 후 상태를 갱신합니다.
