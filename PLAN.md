
### 1. 프로젝트 개요
- **플러그인 이름**: **ShadowShell**
- **버전**: 0.1.0 (초기 릴리스)
- **설명**: Caido 하단 영역(bottom panel)에 내장되는 **AI 지원 멀티 터미널** 플러그인.  
  Shadow처럼 조용하고 빠르게 나타나 여러 터미널 탭을 관리하며, Claude, Gemini, YOLO 모드 등 사전 정의된 Preset을 클릭 한 번으로 즉시 실행할 수 있습니다.
- **슬로건**: “Shadow처럼 숨겨진 터미널, Lightning처럼 빠른 AI Preset”
- **목적**: Caido 사용자들이 외부 터미널을 따로 띄우지 않고도 shell 작업과 AI 도구(Claude, Gemini 등)를 워크플로우 안에서 즉시 활용할 수 있게 함.
- **타겟**: 보안 연구자, 개발자 등 터미널과 AI CLI를 자주 사용하는 Caido 사용자.

### 2. 목표 및 우선순위
1. 안정성과 Caido 네이티브 UX 완전 통합 (하단 패널 + 단축키)
2. 멀티 탭 지원 필수
3. AI Preset 시스템으로 빠른 실행 경험 제공
4. xterm.js 기반으로 안정적이고 가벼운 구현
5. 확장성 확보 (향후 SSH, Ollama 등 추가 가능)

### 3. 주요 기능 요구사항
#### 필수 기능
- Caido 하단 영역(bottom panel / footer 영역)에 **“ShadowShell”** 탭 추가
- **멀티 탭 지원**
  - 새 탭 생성 (+ 버튼)
  - 탭 전환, 탭 닫기, 탭 이름 변경
- **단축키 토글**: Cmd+J (Mac) / Ctrl+J (Windows/Linux)로 전체 패널 열기/닫기
- xterm.js 기반 터미널 렌더링 (ANSI escape, 마우스 지원, 복사/붙여넣기, 자동 리사이즈)
- 로컬 shell 실행 (OS 기본 shell: bash, zsh, pwsh 등)
- Caido 테마 자동 연동 (다크/라이트 모드)
- **Preset System** (핵심 기능)
  - 사전 정의 Preset 목록: Claude, Gemini, Codex/OpenAI, Grok, YOLO Mode 등
  - Preset 클릭 시 **새 탭 자동 생성 + 해당 명령 즉시 실행**
    - 예: Gemini (YOLO Mode) → `gemini --yolo` 또는 미리 정의된 명령 자동 입력 및 실행
    - Claude → Anthropic CLI 또는 claude 명령 자동 실행
  - Preset은 상단/사이드 툴바에 버튼 형태로 노출
  - 사용자가 직접 Preset 추가/편집 가능 (JSON 기반 저장)

#### 선택 기능 (MVP 이후)
- Preset 관리 전용 UI (추가·수정·삭제)
- 탭별 Working Directory 설정
- Font size, 커스텀 테마
- Backend에서 안정적인 PTY 관리
- 세션 저장 및 복원

### 4. UI/UX 설계
- **위치**: Caido bottom panel 내 별도 탭 (ShadowShell)
- **레이아웃**:
  - 상단 탭 바: 여러 터미널 탭 + 새 탭 버튼
  - 왼쪽 또는 상단: Preset 버튼 목록 (Claude, Gemini, YOLO 등)
  - 중앙: xterm.js 터미널 영역
  - 하단 상태 바: 현재 shell, cwd, 실행 중인 Preset 표시
- **토글**: Cmd+J 단축키 + Caido Command Palette에 “Toggle ShadowShell”, “Open Preset: Gemini YOLO” 등 등록
- **스타일**: Caido의 PrimeVue + Tailwind와 완벽 매칭

### 5. 기술 스택 및 아키텍처
- **플러그인 구조**: Caido 공식 starterkit 사용 (`pnpm create @caido-community/plugin`)
  - **Frontend**: Vue 3 + TypeScript + @caido/sdk-frontend
  - **Backend**: node-pty (PTY spawn 및 프로세스 관리, 필요 시)
  - **manifest.json**: frontend + backend 패키지 정의
- **터미널 엔진**: xterm.js (xterm-addon-fit, xterm-addon-webgl 권장)
- **탭 관리**: Vue 동적 컴포넌트 + Pinia 상태 관리
- **Preset 저장**: Caido storage API 또는 JSON 파일
- **통신**: Frontend ↔ Backend WebSocket (PTY 입출력)

### 6. 구현 계획
- 준비 단계
- MVP 구현 (멀티 탭, 단축키, Preset System, 기본 shell 연동)
- UI/UX 폴리싱 및 Caido 테마 연동
- 테스트 및 패키징
- 배포 준비

### 7. 고려사항 및 위험 관리
- Caido SDK에서 footer 영역 탭 확장 가능 여부 최신 문서 확인
- Preset 실행 시 API 키 등 민감 정보 안전 처리
- 멀티 탭 시 xterm.js 인스턴스 메모리 관리
- 호환성: Caido 최신 버전 기준
- 대안: xterm.js에서 문제가 생기면 ghostty-web으로 전환 검토

### 8. 추가 자료 (AI 작업 시 참고)
- Caido Developer Docs: https://developer.caido.io/
- Frontend SDK Reference: https://developer.caido.io/reference/sdks/frontend/
- Backend SDK Reference: https://developer.caido.io/reference/sdks/backend/
- xterm.js: https://xtermjs.org/
- node-pty: https://github.com/microsoft/node-pty
- Starterkit: https://github.com/caido/starterkit-plugin-frontend

