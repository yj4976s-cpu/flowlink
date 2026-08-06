# FlowLink 데이터베이스

PostgreSQL용 FlowLink 스키마와 초기 데이터를 관리합니다. 실제 비밀번호나 연결 문자열은 이 디렉터리의 파일에 기록하지 않습니다.

## 실행 순서

최초 생성은 비어 있는 데이터베이스에서 `schema.sql`만 실행합니다.

```powershell
psql -v ON_ERROR_STOP=1 -d <DB명> -f database/schema.sql
```

전체 초기화가 필요하면 테스트 DB에서 `reset.sql`을 먼저 실행한 뒤 `schema.sql`을 실행합니다.

```powershell
psql -v ON_ERROR_STOP=1 -d <DB명> -f database/reset.sql
psql -v ON_ERROR_STOP=1 -d <DB명> -f database/schema.sql
```

`reset.sql`은 기존 FlowLink 테이블과 그 안의 모든 데이터를 삭제합니다. 운영 DB나 보존해야 할 데이터가 있는 DB에서는 실행하지 마세요.

## AI 클래스 코드 규칙

`object_classes.code`는 대문자로 저장합니다. Roboflow 응답의 클래스명이 소문자이거나 대소문자가 섞여 있으면 백엔드에서 `upper()`로 변환한 뒤 `object_classes.code`를 조회해야 합니다.

`UNKNOWN`은 AI 모델의 출력 클래스가 아니라 관리자가 미확인 부유물을 재분류할 때 사용하는 서비스 클래스입니다.
