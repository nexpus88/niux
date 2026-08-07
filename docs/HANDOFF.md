# SAPUI5 Layout Editor — 핸드오프(이어받기) 문서

> 이 문서는 **다른 개발자(또는 새 AI 코더)가 작업을 바로 이어갈 수 있도록**
> 현재까지의 전체 작업 내역, 아키텍처, 구현 상태, 남은 과제를 한 곳에 정리한
> **마스터 문서**입니다. 항상 이 문서부터 먼저 읽으세요.
>
> 보조 문서:
> - 환경 세팅(새 PC): [`docs/SETUP.md`](./SETUP.md)
> - 아키텍처·복붙 상세: [`docs/WIKI.md`](./WIKI.md)
> - SE24/SICF ABAP 핸들러: [`docs/SE24_SICF_HANDLER.md`](./SE24_SICF_HANDLER.md)

---

## 1. 프로젝트 개요 & 최종 목표

**SAPUI5 Layout Editor**는 SAPUI5 기반의 **드래그 앤 드롭 방식 레이아웃 편집기**입니다.
컨트롤 추가 / 속성 편집 / 복사·붙여넣기로 화면을 구성하고, 그 결과를 XML로 저장합니다.

### 최종 목표 (사용자 명시)
- 이 레이아웃 에디터를 **SAP 온프레미스 시스템에 설치** (보통 BSP Application 형태)
- **SE24에서 생성한 ABAP 클래스의 attribute**를 데이터 바인딩 소스로 사용
- **SE24 클래스의 method**를 이벤트 핸들러(예: Button press)로 바인딩
- 즉, 에디터로 만든 화면의 컨트롤 속성/이벤트가 SE24 클래스의 attribute/method에 연결되어야 함

### 핵심 데이터 흐름
```
SE24 클래스 (attribute/method)
   │  GET /metadata  → 속성·메서드 메타데이터
   │  GET /data      → 속성 현재 값  →  zapp 모델 생성
   ▼
에디터: 컨트롤 속성/이벤트에 바인딩 표현식 부여 ({/GS_COND/CARRID} 등)
   │  저장 → LAYOUT_XML(XML) + LAYOUT_TREE(에디터 트리 JSON)
   ▼
실행 페이지(Preview): zapp 모델에 data 값 주입 → 표현식이 실제 값으로 렌더링
   │  POST /call → 메서드 실행 → 변경된 attribute 반환 → 모델 갱신
```

---

## 2. 기술 스택 & 실행

| 항목 | 값 |
|------|----|
| SAPUI5 | **1.150.0** (`ui5.yaml` = `config/appConfig.json` 통일, CDN 로딩) |
| 테마 | `sap_horizon` |
| 라이브러리 | sap.m, sap.ui.core, sap.ui.layout, sap.f, sap.ui.unified, sap.ui.table, sap.uxap, themelib_sap_horizon |
| 빌드 도구 | UI5 CLI (`@ui5/cli ^3.0.0`) |
| Node.js | `^16.18.0 || >=18.12.0`, npm `>= 8` |
| 미들웨어 | `ui5-middleware-nocache` (로컬 캐시 무력화, `tools/` 폴더 참조) |

### 실행
```bash
cd d:\Sapui5_Layout_Editor
npm install                    # 최초 1회 (node_modules 재생성)
npx ui5 serve --port 8081      # 포트 8080 충돌 시 8081 사용
# 브라우저: http://localhost:8081
```

> **PowerShell 주의**: `&&` 구분자를 쓰면 에러. 반드시 `;`(세미콜론) 사용.
> 포트 충돌(`EADDRINUSE`) 시 다른 포트로 변경.

### 진입 경로 (수동 테스트)
1. `http://localhost:8081` 접속 → 앱 목록(ListView)
2. 앱 선택 → **편집** 버튼 → EditorView 진입
3. (SE24/바인딩 테스트 시) 상단 **SE24** 버튼 → 클래스 지정 후 저장

---

## 3. 프로젝트 구조 (파일 맵)

```
Sapui5_Layout_Editor/
├── webapp/
│   ├── index.html                          # 진입점 (CDN 부트스트랩)
│   ├── Component.js                        # 앱 컴포넌트
│   ├── manifest.json                       # 라우팅·모델(i18n)·CSS
│   ├── view/
│   │   ├── App.view.xml                    # 루트 뷰 (sap.m.App)
│   │   ├── ListView.view.xml              # 앱 목록 뷰
│   │   └── EditorView.view.xml            # ★ 에디터 UI (Shell+Canvas+Outline+Properties)
│   ├── controller/
│   │   ├── ListView.controller.js         # 목록·진입(onPressEdit)
│   │   └── EditorView.controller.js       # ★★ 핵심 로직 (~4380 라인)
│   ├── util/
│   │   ├── Se24Service.js                 # SE24 프로토콜 추상화 (SICF 실서버)
│   │   └── ZappsRepository.js            # 앱 저장(localStorage "zapps")
│   ├── i18n/
│   │   ├── i18n.properties               # 한글 기본 번들 (80 키)
│   │   └── i18n_en.properties            # 영문 번들 (80 키)
│   └── css/style.css                       # 커스텀 스타일
├── docs/
│   ├── HANDOFF.md                          # ★ 이 문서
│   ├── WIKI.md                            # 아키텍처·복붙 상세
│   ├── SETUP.md                           # 새 PC 세팅
│   └── SE24_SICF_HANDLER.md              # ABAP 핸들러 샘플
├── tools/ui5-middleware-nocache/          # 로컬 미들웨어
├── .qoder/skills/sapui5-layout-editor/    # Qoder 프로젝트 스킬(자동 로드)
├── ui5.yaml
├── package.json
└── package-lock.json
```

### 컨트롤러 역할 분담
- **`EditorView.controller.js`** (~4380 라인)가 사실상 전부입니다.
  컨트롤 카탈로그, Outline, 복사/붙여넣기, Properties 패널, XML 직렬화,
  Undo/Redo, Canvas 모드 전환, **데이터 바인딩 팝업**, SE24 다이얼로그,
  실행(Preview) 페이지 생성이 모두 여기 있습니다.
- 수정 시 함수 단위로 검색해 들어가세요. 주요 함수는 5장 참고.

---

## 4. 아키텍처 핵심 결정사항

### 4.1 Editor Shell과 Design Page 분리 (가장 중요)
에디터 껍데기와 디자인 대상 Page가 **분리**되어 있습니다.

```
editorShell (VBox)                        ← 에디터 전체
├── Toolbar                               ← 에디터 툴바 (뒤로/SE24/저장 등)
├── HBox editorLayout                     ← 3분할 (splitterBar로 드래그 리사이즈)
│   ├── leftPane:  outlineTree (Tree)
│   ├── centerPane: canvasPanel
│   └── rightPane: propertiesContent (IconTabBar)
└── OverflowToolbar                       ← 푸터 (컨트롤 개수 등)

Canvas 내부:
canvasRoot (VBox)
└── designCanvas (VBox, 점선 테두리)
    └── designPage (sap.m.Page)           ← 디자인 대상 (타이틀 포함)
        └── content: [Title, Text, HBox, ...]
```

- 앱 개발은 `sap.m.Page`부터 시작하므로, Page(타이틀 포함)가 Canvas 안에 있어야 합니다.
- **designCanvas / designPage 는 삭제·이동 불가** (메뉴 비활성 + 함수 가드).
- **designPage의 CSS 클래스는 사용자 데이터로 수집하지 않음** (에디터 자체 클래스).
  `_applyPageProps`에서 클래스 제거 시 건너뛰고, 구버전 저장 데이터는 자동 치유.

### 4.2 라우팅
- `manifest.json` → `sap.m.routing.Router`
  - `list` (pattern "") → ListView
  - `editor` (pattern `editor/{appId}`) → EditorView
- 저장소는 `localStorage`(ZappsRepository). 추후 SE11 테이블 `ZAPPS`로 교체 예정.

### 4.3 저장 데이터 구조 (ZAPPS)
```
APP_ID / APP_NAME / APP_TYPE / DESCRIPTION / STATUS / CREATED_AT / UPDATED_AT
LAYOUT_XML    STRING   ← 생성된 뷰 XML (실행·SE24용)
LAYOUT_TREE   STRING   ← 에디터 트리 JSON (유지보수·복원용)  ★바인딩 메타 포함
```
- **저장**: `LAYOUT_TREE`(에디터 복원용)와 `LAYOUT_XML`(런타임용)을 함께 저장.
- **복원**: 재진입 시 `LAYOUT_TREE`로 컨트롤 트리를 다시 만들고,
  `_bindingMeta`에서 바인딩 표현식을 복원한 뒤 캔버스에 미러링.
- 이 외에 Page 자체 속성은 `pageProps`, App 루트 속성은 `appProps`로 별도 저장.

### 4.4 sap.m.App 루트의 속성 편집 (오프캔버스 실제 컨트롤)
Outline의 최상위 `sap.m.App` 노드도 **속성 편집이 가능**합니다. 캔버스에는 실제 App이
없으므로, 에디터는 **오프캔버스 실제 `sap.m.App` 인스턴스**를 만들어 이를 등받침합니다.

- `_getDesignApp()`: 지연 생성. `new sap.m.App(createId("designApp"))`를
  `this.getView().addDependent()`로 등록. 렌더링되지 않고 오직 생성 XML의 `<App>` 루트만 등받침.
- Outline의 `sap.m.App` 노드에 이 인스턴스의 `controlId`를 부여 → 클릭하면 선택·속성 패널 표시.
- 속성 편집: `_buildPropertiesPanel`이 그대로 동작 (backgroundColor, homeIcon, backgroundImage 등 17개).
- 저장/복원: `_collectAppProps()` / `_applyAppProps()` — `pageProps`와 동일한 패턴, `oApp.layout.appProps`에 저장.
- XML 직렬화: `_updateXmlFromCanvas`가 `<App backgroundColor="..." ...>` 형태로 App 속성을 출력.
- **보호**: `_isDesignApp(oControl)`로 판별. App은 복사/이동/붙여넣기/삭제 불가
  (컨텍스트 메뉴 구조 작업 비활성 + `onPressDeleteControl` 가드 + 토스트 `toast.cannotDeleteRoot`).

---

## 5. EditorView.controller.js 핵심 기능 & 함수 지도

> 함수가 많으므로, 영역별로 정리. 실제 위치는 파일 내 검색으로 확인.

| 영역 | 대표 함수 | 설명 |
|------|-----------|------|
| i18n | `_i18n(sKey, aArgs)` | 리소스 번들 텍스트 조회 헬퍼 |
| 초기화 | `onInit`, `_onRouteMatched`, `onAfterRendering` | 라우터·단축키·splitter 초기화 |
| 컨트롤 카탈로그 | `_loadOrGenerateCatalog`, `_generateCatalogFromMetadata`, `_getAddDialogCandidates`, `_flattenCatalog` | 추가 가능한 컨트롤 목록 → Add Control 다이얼로그 |
| 선택 | `_attachSelectionToAll`, `_attachSelectionHandler` | 클릭 시 컨트롤 선택 |
| 분할 리사이즈 | `_setupSplitterBars`, `_attachBarDrag` | 좌/우 패널 드래그 너비 조절 |
| 복사/붙여넣기 | `_copyControl`, `_pasteControl`, `_getAcceptingAggregation`, `_canInsertAsSibling`, `_isDescendantOf` | 6장 참고 |
| **바인딩 메타** | `_copyBindingMeta`, `_stripLiveBindings`, `_syncBindingDisplay`, `_syncAllBindingDisplays` | 7장 참고 |
| **바인딩 팝업** | `_openBindingDialog`, `applyBinding`, `detectTargetKind`, `nodeBindingInfo`, `makeItemTemplate` | 7장 참고 |
| Outline | `_buildOutlineData` 내 `buildNode`, `_refreshOutline` | 컨트롤 계층 재귀 순회 |
| Properties | 동적 속성/이벤트 패널 생성 | 우측 IconTabBar |
| XML 직렬화 | `_updateXmlFromCanvas`, `serializeProps` | 8장 참고 |
| 저장/복원 | `onPressSave`(Ctrl+S), `_restoreCanvasFromTree`, `_applyPageProps`, `_collectPageProps` | 4.3 참고 |
| **App 루트 속성** | `_getDesignApp`, `_isDesignApp`, `_collectAppProps`, `_applyAppProps` | 4.4 참고 |
| SE24 | `onPressSe24`, `_openSe24Dialog` | 클래스·endpoint 지정 |
| 실행 페이지 | `_buildRunPageHtml` (+ Canvas Preview 모드) | 9장 참고 |

---

## 6. 복사/붙여넣기 (상세는 WIKI.md 3장)

- **클립보드**: 복사 시 컨트롤 **스냅샷 클론**을 `this._oClipboard`에 저장.
  `oControl.clone()`으로 생성(새 ID 자동 부여).
- **Paste 판별**: Aggregation **타입 기반**.
  - `_getAcceptingAggregation`: 대상이 자식으로 수용 가능한 multiple aggregation 탐색
    (`dependents` 제외, `isA(type)` 체크, 우선순위 content>items>children>controls>pages)
  - `_canInsertAsSibling`: 대상 부모 aggregation 타입과 호환 여부
- **규칙**: 자기 자신→자식 / 복사본의 부모→자식만 / 복사본의 자손→차단(재귀 방지) /
  designPage·designCanvas→`designPage.content`로 리다이렉트
- **보호**: designCanvas·designPage 삭제·이동 불가. sap.m.App 루트도 동일하게 보호(4.4 참고).

---

## 7. 데이터 바인딩 (최근 핵심 작업 영역) ★★★

SE24 attribute를 컨트롤 속성에 연결하는 기능. **표현식은 모델 접두사 없는 절대/상대 경로**를 씁니다.

### 7.1 표현식 표준
| 대상 | 표현식 예 | 설명 |
|------|-----------|------|
| scalar (일반 컨트롤) | `{/GS_COND/CARRID}` | 구조체 필드 절대 경로 (기본 모델) |
| row (테이블 셀) | `{CARRID}` | 상대 경로 (ListItemBase 조상 컨텍스트) |
| table (sap.m.Table) | `items="{/GT_LLIST}"` | attribute(테이블)만 허용 |

- **`zapp>` 모델 접두사는 사용하지 않음** (제거 완료).
  다만 하위호환을 위해 정규식은 `^\{(?:zapp>)?\/(.+)\}$`로 두 형태 모두 해석.
- 실행 페이지에서 모델을 **이중 등록**:
  `oView.setModel(oZappModel)`(기본) + `oView.setModel(oZappModel, "zapp")`(하위호환).

### 7.2 바인딩 팝업 (`_openBindingDialog`)
- 대상 컨트롤 종류 판별: `detectTargetKind` → `table` / `row` / `scalar`
  - `sap.m.Table` → table
  - 조상 중 `sap.m.ListItemBase` 있으면 → row
  - 그 외 → scalar
- **바인딩 규칙** (`nodeBindingInfo`):
  - table → attribute(테이블) 노드만 → `{/GT_LLIST}`
  - row → 구조체 필드만, 상대 경로 → `{CARRID}`
  - scalar → 구조체 필드만, 절대 경로 → `{/GS_COND/CARRID}`
  - 규칙 위반 시 `reasonKey` 반환 → 토스트로 안내
- **트리**: SE24 메타데이터를 트리(`bindingTree` 모델)로 표시.
  - **Level 1(구조체/테이블 그룹)만 전개**, Level 2부터 접힘
    (`numberOfExpandedLevels: 1`)
  - UI5는 트리 바인딩 시 전 레벨을 플래튼해 **단일 템플릿**으로 렌더링.
    따라서 템플릿에 `items` 설정을 넘기면 **안 됨** (`unknown setting 'items'` assertion).
    `makeItemTemplate()`이 단일 `CustomTreeItem` 템플릿 생성.
- **더블클릭 즉시 바인딩**: 트리 노드 dblclick → 유효하면 `applyBinding()`,
  무효면 토스트.
- **다이얼로그**: `draggable: true`, `resizable: true` (sap.m.Dialog 1.112+ 네이티브.
  UI5 1.150이므로 커스텀 DOM 드래그 코드 **불필요**).
  리사이즈 시 레이아웃 추종을 위해 콘텐츠에 `growFactor` + CSS(`style.css`의 `.bindingDialog*`).

### 7.3 `_bindingMeta` (바인딩 메타 저장소)
- 컨트롤 인스턴스의 transient 필드:
  `oControl._bindingMeta = { props: {속성: 표현식}, events: {...} }`
- `serializeProps`에서 메타데이터 속성이 아닌 키(`items` 등)도 XML 어트리뷰트로 출력.
- **clone()은 커스텀 필드를 복제하지 않으므로** 별도 복사가 필요 → 7.4.

### 7.4 캔버스 표현식 미러링 & 복붙 유지
- **미러링**: 바인딩 적용 시 string 타입 속성에 한해 `setProperty`로 `{/PATH}` 표시.
  - `_syncBindingDisplay(oControl, sName, vValue)`: string 속성만 반영
  - `_syncAllBindingDisplays(oControl)`: `_bindingMeta.props` 전체 재적용
  - 호출 지점: `applyBinding`, Properties unbind 버튼, `_restoreCanvasFromTree`, `_copyBindingMeta`
- **unbind 시**: 표현식 제거 후 컨트롤 id(`oControl.getId()`)로 복원.
- **복사/붙여넣기 시 바인딩 유지** (버그 수정 완료):
  - `_stripLiveBindings(oClone)`: clone이 복제한 라이브 바인딩 제거.
    `mBindingInfos` 순회 → `unbindProperty/unbindAggregation/unbindObject`.
    (※ 이 버전에 `unbindAll()`은 **없음**. 쓰면 에러.)
  - `_copyBindingMeta(oSource, oClone)`: `_bindingMeta`를 재귀 병행 순회로 복사.
    **단순 최상위만 복사하면 컨테이너(HBox) 안 중첩 자식의 메타가 소실**되므로
    반드시 aggregation 재귀로 중첩 자식까지 복사해야 함.

---

## 8. XML 직렬화 & Code 뷰

- `_updateXmlFromCanvas`: Canvas 컨트롤 트리를 XML 문자열로 직렬화.
  메타데이터 기본값과 다른 속성만 출력. 네임스페이스 프리픽스 매핑(sap.m→기본, core 등).
- **Code 뷰는 읽기 전용** (`EditorView.view.xml`의 `TextArea editable="false"`).
  조회만 가능, 수정 불가.

---

## 9. SE24 연동 & 실행(Preview) 페이지

### 9.1 Se24Service.js (프로토콜 추상화)
| 메서드 | 설명 |
|--------|------|
| `getMetadata(endpoint, className, client)` | 속성·메서드 메타데이터 |
| `getData(endpoint, className, client)` | 속성 현재 값 → zapp 모델 재료 |
| `callMethod(endpoint, className, method, params, client)` | 메서드 실행 → 변경 attribute 반환 |

- `endpoint`는 필수. 미설정 시 `Se24Service.requireEndpoint()`가 오류로 거부한다.
- 모든 요청은 `credentials: "include"`(SAP logon cookie) + `sap-client` 파라미터를 사용한다.

### 9.2 프로토콜 계약 (실서버 ABAP이 구현)
```
GET  {endpoint}/metadata?class=ZCL_X  → {className, attributes[], methods[]}
GET  {endpoint}/data?class=ZCL_X      → {ATTR: 값, ...}
POST {endpoint}/call  body{class,method,params} → {success, message, data}
```
상세 ABAP 샘플은 [`docs/SE24_SICF_HANDLER.md`](./SE24_SICF_HANDLER.md).

### 9.3 실서버 정보
- **엔드포인트**: `http://lrpsap.localdomain:50081/sap/bc/zse24`
- **모든 요청에 `sap-client=800` 필수**
- **데모 클래스**: `ZCL_CMUI0010` (attribute: `GS_COND`, `GT_LLIST`, `GV_HELLO`)

### 9.4 실행(Preview) 페이지
- Canvas의 **Preview 모드** / SE24 저장 후 실행 시 `_buildRunPageHtml`이 런타임 HTML 생성.
  - zapp 모델 생성 → `getData` 값 주입 → 바인딩 표현식 렌더링
  - 이벤트(press 등) → `Se24Service.callMethod` → 변경 attribute로 모델 갱신
  - 모델 이중 등록(7.1 참고), 표현식 해석 정규식 `^\{(?:zapp>)?\/(.+)\}$`.

---

## 10. 다국어 (i18n)

- 모든 UI 하드코딩 문구를 i18n 키로 전환 완료. **한/영 각 80키 일치.**
- `webapp/i18n/i18n.properties`(한글 기본, fallbackLocale "") + `i18n_en.properties`(영문)
- `manifest.json`에 ResourceModel 등록 (`supportedLocales: ["","ko","en"]`)
- 컨트롤러에서 `_i18n(sKey, aArgs)` 헬퍼 사용. 뷰에서는 `{i18n>key}` 바인딩.
- 새 문구 추가 시 **두 properties 파일에 반드시 동일한 키** 추가.

---

## 11. 기타 구현된 편의 기능

- **Ctrl+S 저장 단축키**: `onInit`에서 document 전역 keydown 등록,
  `onExit`에서 리스너 정리(메모리 누수 방지). 입력 필드 포커스 중에도 동작.
- **Undo/Redo**: 툴바 `btnUndo`/`btnRedo`.
- **Zoom In/Out, 전체화면**: Canvas 툴바.
- **Canvas 모드**: Design / Code(읽기전용) / Preview 세그먼트 전환.
- **패널 드래그 리사이즈**: `splitterBar` 드래그로 좌/우 패널 너비 조절.

---

## 12. 코딩 컨벤션 (반드시 준수)

1. **컨트롤 추가 시 클래스 이름 부여 금지** — id만 사용.
2. **검증 빈도 최소화**: 작은 수정(스타일·레이블·단순 리팩토링)은 브라우저 검증 생략.
   검증은 **큰 구조 변경 / 핵심 기능 추가·수정 / 런타임 에러 의심** 시에만 수행.
   → 사용자는 빠른 진행 속도를 선호.
3. **Managedobject 설정**: `class:`는 유효 setting이 아님 → `addStyleClass()` 사용.
   트리 템플릿에 `items` setting 전달 금지(플래튼 렌더링).
4. **designPage 클래스**는 사용자 데이터로 수집/직렬화하지 않음.
5. i18n 문구는 하드코딩 금지, 두 properties에 동시 추가.
6. **PowerShell**: `&&` 대신 `;`.
7. 이 버전 UI5(1.150)에 없는 API 추측 금지(예: `unbindAll()` 없음).
   쓰기 전 해당 버전 API 존재 여부 확인.

---

## 13. 알려진 이슈 / 남은 과제 (로드맵)

### 미구현 / 미완료
| 항목 | 상태 | 비고 |
|------|------|------|
| 이벤트 바인딩 실제 실행 | 부분 | Properties Events 탭에 handler 이름 입력란은 있으나, SE24 method 연결 로직 미완 |
| ABAP `DESCRIBE_TYPE` 적용 | 미확인 | 메타데이터 추출 방식 개선 여부 확인 필요 |
| 토큰 캐시 + `/call` 연동 | 미적용 | 이전 세션 설계만 되어 있음 |
| ZAPPS localStorage → SE11/OData 교체 | 대기 | ZappsRepository 주석에 구조 명시됨 |
| 호출 허용 클래스 화이트리스트 | 권장 | `CALL METHOD (lv_class)` 임의 실행 보안 제한 필요 |

### 최근 해결한 주요 버그 (재발 주의)
| 버그 | 원인 | 해결 |
|------|------|------|
| 복붙 시 바인딩 풀림 | `_copyBindingMeta`가 최상위만 복사해 중첩 자식 메타 소실 + clone이 라이브 바인딩 복제 | 재귀 병행 순회 복사 + `_stripLiveBindings` |
| `unknown setting 'items'` | 트리 재귀 템플릿이 CustomTreeItem에 `items` 전달 | 단일 템플릿(`makeItemTemplate`) |
| `unknown setting 'class'` | `new Text({ class: ... })` | `addStyleClass()` |
| `unbindAll is not a function` | 없는 API 사용 | `_stripLiveBindings`로 교체 |
| 캔버스 복원 시 빈 화면 | `_applyPageProps`가 designPage 클래스 제거 실패 → 높이 40px 클리핑 | 클래스 유지 + 자동 치유 |

---

## 14. 브라우저 수동/자동 검증 팁

- **browser-use MCP**로 자동 검증 가능. 컨트롤 id는 뷰 prefix 포함:
  `container-com.layout.editor---editorView--designCanvas` 등.
- 테이블 id 예: `container-com.layout.editor---listView--appTable`
- 에디터 진입 자동화: `sap.ui.getCore().byId(...)`로 테이블 찾아
  `setSelectedItem(...)` 후 `onPressEdit()` 직접 호출.
- `document.querySelector("[data-sap-ui]")`로 렌더된 컨트롤 id 수집 가능.

---

## 15. 빠른 시작 체크리스트 (이어받는 사람용)

1. `docs/SETUP.md`대로 환경 세팅 → `npm install`
2. `npx ui5 serve --port 8081` → 브라우저에서 진입 경로 확인(2장)
3. 이 문서 7장(바인딩)·9장(SE24)을 읽고 현재 구현 수준 파악
4. 13장 남은 과제 중 이어받을 항목 선택
5. 수정 전 해당 함수 지도(5장)로 위치 확인 → 코딩 컨벤션(12장) 준수
6. 큰 변경 시에만 브라우저 검증(14장) 수행
