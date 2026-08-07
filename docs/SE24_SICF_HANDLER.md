# SE24 SICF HTTP 핸들러 가이드

Layout Editor가 SE24 클래스의 public attribute/method에 접근하기 위해 사용하는
HTTP 프로토콜 계약과, 온프레미스 ABAP 시스템에서 이를 구현하는 샘플 코드.

## 프로토콜 계약

베이스 URL: SICF 서비스 노드 (예: `/sap/bc/zse24`). 에디터에서는 앱별 `endpoint`
설정으로 지정한다. 에디터는 이 프로토콜만 사용한다(mock 데이터는 제공하지 않음).

| 요청 | 응답 JSON |
|------|-----------|
| `GET {endpoint}/metadata?class=ZCL_X` | `{ className, attributes: [{name, type, description}], methods: [{name, description, params: [{name, type, direction}]}] }` |
| `GET {endpoint}/data?class=ZCL_X` | `{ ATTR: 값, ... }` |
| `POST {endpoint}/call` body `{ class, method, params }` | `{ success: bool, message, data: {변경된 attribute 값} }` |

- `attributes`: 클래스의 PUBLIC 인스턴스 attribute (읽기 전용 매핑 대상)
- `methods`: PUBLIC 메서드. `params`에는 importing 파라미터만 노출
- `call` 응답의 `data`는 메서드 실행 후 변경된 attribute 값. 런타임 앱은 이 값으로
  화면 모델(`zapp`)을 갱신한다.

## SICF 등록 절차

1. SE24에서 아래 `ZCL_SE24_HTTP_HANDLER` 생성 (인터페이스 `IF_HTTP_HANDLER` 구현)
2. SICF → `/sap/bc` 하위에 서비스 노드 `zse24` 생성
   - Handler 목록에 `ZCL_SE24_HTTP_HANDLER` 등록
   - 인증: 테스트 단계에서는 `Basic Authentication` 또는 Logon 데이터 유지
3. 서비스 활성화 후 URL 테스트: `/sap/bc/zse24/metadata?class=ZCL_LAYOUT_DEMO`
4. Layout Editor에서 앱의 SE24 설정 → endpoint를 `/sap/bc/zse24`로 지정

> CORS: 에디터 앱을 BSP Application(SE80)으로 동일 시스템에 배포하면
> 동일 origin이라 별도 CORS 설정이 필요 없다.

## 샘플 ABAP 구현 (ZCL_SE24_HTTP_HANDLER)

```abap
CLASS zcl_se24_http_handler DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_handler.
ENDCLASS.

CLASS zcl_se24_http_handler IMPLEMENTATION.
  METHOD if_http_handler~handle_request.
    DATA: lo_json   TYPE REF TO cl_trex_json_serializer,
          lv_path   TYPE string,
          lv_class  TYPE seoclsname,
          lv_result TYPE string.

    lv_path  = server->request->get_header_field( name = '~path_info' ).
    lv_class = server->request->get_form_field( name = 'class' ).

    CASE lv_path.
      WHEN '/metadata'.
        lv_result = get_metadata( lv_class ).
      WHEN '/data'.
        lv_result = get_data( lv_class ).
      WHEN '/call'.
        lv_result = call_method( server ).
      WHEN OTHERS.
        server->response->set_status( code = 404 reason = 'Not found' ).
        RETURN.
    ENDCASE.

    server->response->set_header_field(
        name = 'Content-Type' value = 'application/json' ).
    server->response->set_cdata( lv_result ).
    server->response->set_status( code = 200 reason = 'OK' ).
  ENDMETHOD.
ENDCLASS.
```

### metadata - CL_ABAP_CLASSDESCR로 attribute/method 추출

```abap
METHOD get_metadata.
  DATA: lo_class  TYPE REF TO cl_abap_classdescr,
        lt_attrs  TYPE abap_attrdescr_table,
        lt_methods TYPE abap_methdescr_table,
        lv_json   TYPE string.

  TRY.
      lo_class ?= cl_abap_typedescr=>describe_by_name( iv_class ).
    CATCH cx_sy_rtti_error.
      RETURN '{"error":"class not found"}'.
  ENDTRY.

  lt_attrs   = lo_class->attributes.   " visibility = public 필터 필요
  lt_methods = lo_class->methods.

  " attributes / methods / params 를 JSON 문자열로 조립
  " (cl_trex_json_serializer 또는 /ui2/cl_json 사용 권장)
  ...
ENDMETHOD.
```

- `attributes` 루프에서 `visibility = cl_abap_classdescr=>public`
  AND `is_class = abap_false`(인스턴스 attribute) 조건 필터
- `methods` 루프에서 public 메서드만, `parameters`에서
  `parm_kind = cl_abap_objectdescr=>importing` 파라미터만 노출

### data - attribute 현재 값 읽기

```abap
METHOD get_data.
  DATA: lo_obj   TYPE REF TO object,
        lv_value TYPE string,
        lv_json  TYPE string VALUE '{'.

  " 데모: 클래스는 인스턴스 생성 가능해야 함.
  " 실제 운영에서는 싱글톤/팩토리 패턴으로 기존 인스턴스를 쓰는 것을 권장.
  CREATE OBJECT lo_obj TYPE (iv_class).

  LOOP AT public_attributes INTO DATA(ls_attr).
    DATA(lv_val) = get_attr_value( lo_obj, ls_attr-name ).
    lv_json = lv_json && |"{ ls_attr-name }":"{ escape( val = lv_val
              format = cl_abap_format=>e_json_string ) }",|.
  ENDLOOP.
  result = lv_json && '}'.
ENDMETHOD.
```

### call - 동적 메서드 호출 (PARAMETER-TABLE)

```abap
METHOD call_method.
  DATA: lo_obj     TYPE REF TO object,
        lt_params  TYPE abap_parmbind_tab,
        lv_body    TYPE string,
        lt_bind    TYPE ... " body JSON 파싱: method + params

  " request body(JSON)에서 method 이름과 파라미터 값 파싱
  server->request->get_cdata( ) -> /ui2/cl_json=>deserialize 등

  CREATE OBJECT lo_obj TYPE (iv_class).

  LOOP AT parsed_params INTO DATA(ls_p).
    DATA lv_val TYPE string.
    lv_val = ls_p-value.
    INSERT VALUE #( name  = ls_p-name
                    kind  = cl_abap_objectdescr=>importing
                    value = REF #( lv_val ) ) INTO TABLE lt_params.
  ENDLOOP.

  TRY.
      CALL METHOD lo_obj->(iv_method) PARAMETER-TABLE lt_params.
      " 호출 후 변경된 attribute를 다시 읽어 data로 반환
      result = |{{"success":true,"message":"{ iv_method } executed",|
            && |"data":{ get_data( iv_class ) }}}|.
    CATCH cx_root INTO DATA(lx).
      result = |{{"success":false,"message":"{ lx->get_text( ) }","data":{{}}}}|.
  ENDTRY.
ENDMETHOD.
```

## 데모 클래스 (ZCL_LAYOUT_DEMO)

위 프로토콜 계약과 동일한 형태:

```abap
CLASS zcl_layout_demo DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    DATA title   TYPE string VALUE 'SE24에서 가져온 제목'.
    DATA counter TYPE i VALUE 0.
    DATA status  TYPE string VALUE 'READY'.

    METHODS set_title  IMPORTING p_title TYPE string.
    METHODS increment.
    METHODS set_status IMPORTING p_status TYPE string.
ENDCLASS.

CLASS zcl_layout_demo IMPLEMENTATION.
  METHOD set_title.  title = p_title.      ENDMETHOD.
  METHOD increment.  counter = counter + 1. ENDMETHOD.
  METHOD set_status. status = p_status.    ENDMETHOD.
ENDCLASS.
```

## 전환 체크리스트

1. SICF 서비스 등록 및 데모 클래스 생성
2. Layout Editor에서 endpoint를 `/sap/bc/zse24`로 변경 (SE24 다이얼로그)
3. `webapp/util/Se24Service.js`와 실행 페이지 생성 코드는 프로토콜만 따르므로
   코드 수정 불필요 (endpoint만 지정하면 실서버 호출)
4. 보안 검토: 호출 허용 클래스 화이트리스트 추가 권장
   (`CALL METHOD (lv_class)`는 임의 클래스 실행이 가능하므로 반드시 제한)
