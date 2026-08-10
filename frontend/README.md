# FlowLink Frontend

Next.js 16 App Router, TypeScript, Tailwind CSS 4로 구성된 FlowLink 웹 프론트엔드입니다.

## 실행

PowerShell에서 `frontend` 디렉터리로 이동한 뒤 실행합니다.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

개발 화면은 http://localhost:3000 에서 확인합니다.

## 검증

```powershell
npm.cmd run lint
npm.cmd run build
```

## 메인 화면 구조

- `src/components/theme`: DAWN/DAY/NIGHT 테마 상태와 토글
- `src/components/layout`: 헤더, 모바일 메뉴, 푸터
- `src/components/home`: Hero 수변 탐지 장면, 현황, 프로세스, 최근 발견물
- `src/data/mock-home.ts`: API 연동 전 사용하는 데모 데이터
- `src/types/home.ts`: 홈 화면 데이터 타입

테마는 `flowlink-theme` localStorage 키에 `dawn`, `day` 또는 `night`로 저장됩니다. 초기화 스크립트가 hydration 전에 `html[data-theme]`을 적용합니다.

현재 메인 화면은 실제 API를 호출하지 않습니다. 백엔드 연동 시 `src/data/mock-home.ts`를 API 응답으로 교체하고, 실제 수변 이미지가 준비되면 `DetectionScene.tsx`의 CSS/inline SVG 장면을 이미지 레이어로 교체합니다.
