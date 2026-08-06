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
