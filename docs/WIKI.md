# SAPUI5 Layout Editor - 프로젝트 위키

> **최신 전체 현황·이어받기 가이드는 [`docs/HANDOFF.md`](./HANDOFF.md)를 먼저 읽으세요.**
> 이 문서는 아키텍처와 복사/붙여넣기 로직의 상세 설명에 집중합니다.

## 1. 프로젝트 개요

SAPUI5 기반 드래그 앤 드롭 방식의 레이아웃 편집기입니다. 컨트롤을 추가하고, 속성을 편집하며, 복사/붙여넣기로 레이아웃을 구성할 수 있습니다.

- **SAPUI5 버전**: 1.150.0 (CDN 로딩, `config/appConfig.json`)
- **테마**: sap_horizon
- **실행**: `npx ui5 serve --port 8081` → http://localhost:8081

### 주요 파일
| 파일 | 역할 |
|------|------|
| `webapp/view/EditorView.view.xml` | 에디터 UI 구조 (Shell + Canvas + Outline + Properties) |
| `webapp/controller/EditorView.controller.js` | 에디터 로직 (복사/붙여넣기, Outline, XML 직렬화 등) |
| `webapp/css/style.css` | 에디터 스타일 |

---

## 2. 아키텍처 결정사항

### 2.1 Editor Shell과 Design Page 분리

**문제**: 초기에는 `sap.m.Page`가 에디터 전체(툴바, Outline, Canvas, 속성 패널)를 감싸고 있어서, 디자인 대상이 되는 Page의 타이틀이 에디터 상단에 표시되고 Canvas 안에는 존재하지 않았습니다.

**결정**: 에디터 Shell과 디자인 대상 Page를 분리했습니다.

```
변경 전:
<Page id="editorPage">          ← 에디터 전체를 감쌈
  <customHeader>...</customHeader>
  <content>
    <HBox> Outline | Canvas | Properties </HBox>
  </content>
  <footer>...</footer>
</Page>

변경 후:
<VBox id="editorShell">          ← 에디터 Shell (단순 VBox)
  <Toolbar>...</Toolbar>         ← 에디터 툴바
  <HBox> Outline | Canvas | Properties </HBox>
  <OverflowToolbar>...</OverflowToolbar>
</VBox>

Canvas 내부:
<VBox id="designCanvas">         ← 디자인 영역 (점선 테두리)
  <Page id="designPage">         ← 디자인 대상 Page (타이틀 포함)
    <content>...</content>
  </Page>
</VBox>
```

**이유**: 앱 개발은 `sap.m.Page`부터 시작하므로, Page(타이틀 포함)가 Canvas 안에 있어야 실제 앱 구조를 정확히 반영합니다.

### 2.2 Outline 계층 구조

Outline은 Canvas의 실제 컨트롤 계층을 동적으로 반영합니다.

```
App.view.xml
└── sap.m.App          (개념적 노드 - controlId 없음)
    └── pages          (구조 노드)
        └── sap.m.Page (designPage)
            └── content
                ├── sap.m.Title
                ├── sap.m.Text
                └── sap.m.HBox
                    └── items
                        ├── sap.m.Button
                        └── sap.m.Input
```

- `buildNode()` 함수가 컨트롤의 모든 Aggregation을 재귀적으로 순회하여 노드를 생성합니다.
- 구조 노드(App, pages, content, items)는 `controlId`가 없어 우클릭 메뉴가 열리지 않습니다.

---

## 3. 복사/붙여넣기 기능

### 3.1 클립보드 방식

- `복사` 실행 시 컨트롤의 **스냅샷 클론**을 `this._oClipboard`에 저장합니다.
- 원본 컨트롤이 수정/삭제되어도 클립보드 내용에는 영향이 없습니다.
- 클론은 `oControl.clone()`으로 생성되며, 새 ID가 자동 부여됩니다.

### 3.2 Aggregation 기반 Paste 판별

Paste 가능 여부는 **타입 기반**으로 판별합니다.

```javascript
// 대상이 복사본을 자식으로 수용 가능한 Aggregation 찾기
_getAcceptingAggregation: function (oContainer, oControl) {
    // multiple aggregation만 대상, "dependents" 제외
    // oControl.isA(aggregation.type)으로 타입 호환 확인
    // 우선순위: content > items > children > controls > pages
}

// 대상의 부모 Aggregation이 복사본을 sibling으로 수용 가능한지 확인
_canInsertAsSibling: function (oTarget, oCopy) {
    // oTarget이 속한 부모의 aggregation 타입과 oCopy.isA() 비교
}
```

### 3.3 Paste 메뉴 규칙

| 대상 | 붙여넣기 | 앞에/뒤에 붙여넣기 |
|------|---------|-------------------|
| 자기 자신 | 자식으로 추가 | sibling으로 삽입 |
| 복사본의 부모 | 자식으로 추가 | 비활성 |
| 복사본의 자손 | 비활성 (재귀 방지) | 비활성 |
| 일반 컨트롤 | 자식 또는 sibling | 타입 호환 시 활성 |
| designPage / designCanvas | Page.content로 리다이렉트 | Page.content로 리다이렉트 |

### 3.4 Paste 실행 로직

```javascript
_pasteControl: function (oTarget, sPosition) {
    // 1. designPage/designCanvas/그 조상이면 → Page.content로 리다이렉트
    //    - "before": insertAggregation(agg, clone, 0)
    //    - 그 외: addAggregation(agg, clone)
    // 2. position 없고 대상이 컨테이너면 → 대상의 accepting aggregation에 추가
    // 3. 그 외 → 대상의 sibling으로 삽입 (targetAggInfo.index 기준)
}
```

### 3.5 보호 규칙

- **designCanvas, designPage**: 삭제/이동 불가 (메뉴 비활성화 + 함수 가드)
- **자손 Paste 차단**: `_isDescendantOf()`로 복사본의 자손에 Paste 방지 (재귀 구조 방지)

---

## 4. 컨트롤 추가

- Add Control 다이얼로그: `_getAddDialogCandidates()`가 카탈로그를 기준으로
  대상의 aggregation에 추가 가능한 컨트롤 후보를 필터링합니다.
- `_addControlToAggregation()`: 대상의 특정 aggregation에 새 컨트롤을 추가합니다
  (단일 카디널리티 0..1은 기존 자식 교체, 0..n은 추가).
- 추가 시 `_attachSelectionHandler()`로 클릭 선택 핸들러를 연결하고,
  이후 XML/Outline을 동기화합니다.

---

## 5. XML 직렬화 (Code 뷰)

- `_updateXmlFromCanvas()`: Canvas 컨트롤 트리를 XML 문자열로 직렬화합니다.
- 메타데이터 기본값과 다른 속성만 출력합니다.
- 네임스페이스 프리픽스 매핑: `sap.m` → 기본, `sap.ui.core` → `core` 등

---

## 6. 실행 방법

```bash
cd d:\Sapui5_Layout_Editor
npx ui5 serve --port 8081
# 브라우저에서 http://localhost:8081 접속
```

> 포트 8080이 사용 중이면 8081 등 다른 포트를 사용하세요.

---

## 7. 참고: 사용자 선호사항

- 작은 코드 수정 후에는 브라우저 검증을 생략하고 바로 다음 작업 진행
- 검증은 큰 구조 변경, 핵심 기능 추가/수정, 런타임 에러 의심 시에만 수행

---

## 8. 최근 추가된 기능 요약 (상세는 HANDOFF.md)

| 기능 | 핵심 내용 |
|------|-----------|
| **데이터 바인딩 팝업** | SE24 attribute를 컨트롤 속성에 연결. 대상별 규칙(scalar/row/table), 더블클릭 즉시 바인딩, Level1만 전개, 드래그·리사이즈. [HANDOFF 7장](./HANDOFF.md#7-데이터-바인딩-최근-핵심-작업-영역-) |
| **표현식 표준** | `{/GS_COND/CARRID}`(scalar 절대), `{CARRID}`(row 상대), `items="{/GT_LLIST}"`(table). `zapp>` 접두사 미사용 |
| **캔버스 표현식 미러링** | 바인딩 시 string 속성에 표현식 표시, unbind 시 id로 복원. 복붙 시 `_copyBindingMeta`(재귀)로 유지 |
| **Code 뷰 읽기 전용** | `TextArea editable="false"` |
| **다국어(i18n)** | 한/영 각 80키, `_i18n()` 헬퍼, `{i18n>key}` 바인딩 |
| **SE24 연동** | `Se24Service`로 metadata/data/call 추상화, 실행 페이지에서 zapp 모델 주입. [HANDOFF 9장](./HANDOFF.md#9-se24-연동--실행preview-페이지) |
| **Ctrl+S 저장** | 전역 단축키 + `onExit`에서 리스너 정리 |
