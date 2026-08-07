# 새 PC에서 프로젝트 시작하기 (SETUP 가이드)

이 문서는 프로젝트를 USB 등으로 복사한 뒤 **새 PC에서 막힘없이 작업을 이어가는 방법**을 안내합니다.

---

## 1. 사전 요구사항

새 PC에 아래가 설치되어 있어야 합니다.

| 도구 | 확인 명령 | 설치처 |
|------|----------|--------|
| Node.js (LTS 권장) | `node -v` | https://nodejs.org |
| npm | `npm -v` | Node.js 설치 시 포함 |

> Node.js만 설치하면 npm은 함께 설치됩니다.

---

## 2. 프로젝트 복사

USB에서 프로젝트 폴더를 원하는 위치로 복사합니다.

```
예: D:\Sapui5_Layout_Editor
```

> **주의**: `node_modules` 폴더는 복사하지 않아도 됩니다. 아래 3번 단계에서 자동 재생성됩니다.
> (복사되어 있어도 문제없지만, 용량이 크므로 제외하는 것을 권장합니다.)

---

## 3. 의존성 설치

프로젝트 루트에서 실행합니다.

```bash
cd D:\Sapui5_Layout_Editor
npm install
```

- `package.json`의 `@ui5/cli`가 설치됩니다.
- `node_modules` 폴더가 생성됩니다.

---

## 4. 프로젝트 실행

```bash
npx ui5 serve --port 8081
```

- 서버가 시작되면 브라우저에서 접속: **http://localhost:8081**
- 포트 8080이 비어있다면 `npm start`로도 실행 가능합니다.

### 실행이 안 될 때 점검

| 증상 | 해결 |
|------|------|
| `EADDRINUSE: Port already in use` | 다른 포트로 변경: `npx ui5 serve --port 8082` |
| `ui5: command not found` | `npm install`이 제대로 됐는지 확인 후 `npx ui5 serve` 사용 |
| 화면이 안 뜸 | `webapp/index.html`이 있는지, 브라우저 콘솔(F12) 에러 확인 |

---

## 5. Qoder에서 작업 이어가기

프로젝트에는 아래 지식 자산이 함께 복사되어 새 PC의 Qoder가 바로 컨텍스트를 파악할 수 있습니다.

| 경로 | 내용 |
|------|------|
| `docs/HANDOFF.md` | ★ **마스터 이어받기 문서** (전체 현황·아키텍처·남은 과제) — 가장 먼저 읽기 |
| `docs/WIKI.md` | 아키텍처 결정사항, 복사/붙여넣기 로직, Paste 규칙 |
| `docs/SETUP.md` | 이 문서 (환경 세팅 가이드) |
| `docs/SE24_SICF_HANDLER.md` | SE24/SICF ABAP 핸들러 샘플 |
| `.qoder/skills/sapui5-layout-editor/SKILL.md` | Qoder 에이전트용 프로젝트 스킬 (자동 로드) |
| `.qoder/repowiki/knowledge/` | Qoder 내부 지식베이스 |

**새 PC에서 Qoder를 열면** `.qoder/skills/`의 프로젝트 스킬이 자동으로 인식되어,
에이전트가 프로젝트 구조와 코딩 컨벤션을 이미 아는 상태로 시작합니다.

---

## 6. 프로젝트 구조 한눈에 보기

```
Sapui5_Layout_Editor/
├── webapp/
│   ├── index.html                  # 진입점
│   ├── Component.js                # 앱 컴포넌트
│   ├── manifest.json               # 앱 설정 (라우팅, 모델)
│   ├── view/
│   │   ├── App.view.xml            # 루트 뷰
│   │   ├── ListView.view.xml       # 앱 목록 뷰
│   │   └── EditorView.view.xml     # ★ 에디터 뷰 (Shell + Canvas + Outline)
│   ├── controller/
│   │   ├── ListView.controller.js
│   │   └── EditorView.controller.js # ★ 에디터 로직 (복사/붙여넣기 등)
│   ├── util/
│   │   ├── Se24Service.js          # SE24 프로토콜 추상화 (SICF 실서버)
│   │   └── ZappsRepository.js     # 앱 저장 (localStorage "zapps")
│   ├── i18n/
│   │   ├── i18n.properties         # 한글 기본 번들
│   │   └── i18n_en.properties      # 영문 번들
│   └── css/style.css               # 커스텀 스타일
├── docs/
│   ├── HANDOFF.md                  # ★ 마스터 이어받기 문서 (전체 현황)
│   ├── WIKI.md                     # 프로젝트 위키 (아키텍처·복붙 상세)
│   ├── SETUP.md                    # 이 문서
│   └── SE24_SICF_HANDLER.md        # SE24/SICF ABAP 핸들러
├── .qoder/                         # Qoder 지식/스킬
├── ui5.yaml                        # UI5 CLI 설정 (SAPUI5 1.150.0, config와 통일)
├── package.json
└── package-lock.json
```

---

## 7. 빠른 시작 요약 (복붙용)

```bash
# 1. 프로젝트 폴더로 이동
cd D:\Sapui5_Layout_Editor

# 2. 의존성 설치
npm install

# 3. 실행
npx ui5 serve --port 8081

# 4. 브라우저 접속
# http://localhost:8081
```
