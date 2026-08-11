# FlowLink Backend

FlowLink의 FastAPI 백엔드입니다. Python 3.12를 사용합니다.

## 로컬 실행

PowerShell에서 다음 명령을 실행합니다.

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

`.env`에는 로컬 환경에 맞는 실제 값을 설정하고 Git에 커밋하지 않습니다. 현재 애플리케이션은 설정만 읽으며 데이터베이스나 외부 서비스에는 연결하지 않습니다.

API 문서는 개발 서버 실행 후 http://localhost:8000/docs 에서 확인할 수 있습니다.

## 테스트

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest
```

현재 `/health`만 실제로 동작합니다. 나머지 API는 향후 구현을 위한 계약 골격이며 모두 HTTP 501 `Not Implemented`를 반환합니다.

## FlowLink AI Adaptive Copilot

Copilot은 `/api/copilot/chat`과 인증 사용자용 `/api/copilot/briefing`을 사용합니다. 모델은 `CHAT_MODEL_PROVIDER`로 선택하며 `disabled`, `gemini`, `openai`를 지원합니다. `disabled`는 가짜 답변을 만들지 않고 503 공통 연결 안내를 반환합니다.

USER 도구는 서버 인증 사용자 본인의 신고, 매칭, AI 분석, 소유권 요청, 알림만 조회합니다. ADMIN 도구는 운영 집계만 조회하며, 모델이 전달한 사용자 ID나 임의 URL은 신뢰하지 않습니다. API 키와 인증 토큰은 Tool 결과나 로그에 포함하지 않습니다.
