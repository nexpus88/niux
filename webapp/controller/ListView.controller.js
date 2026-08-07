sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "com/layout/editor/util/ZappsRepository",
    "com/layout/editor/util/Se24Service"
], function (Controller, JSONModel, MessageBox, MessageToast, History, ZappsRepository, Se24Service) {
    "use strict";

    return Controller.extend("com.layout.editor.controller.ListView", {
        onInit: function () {
            // Load persisted apps (future SE11 table ZAPPS); seed sample data on
            // first run so the list is never empty.
            var aStored = ZappsRepository.loadApps();
            if (aStored.length === 0) {
                aStored = this._getSampleApps();
                ZappsRepository.persistApps(aStored);
            }
            var oData = {
                apps: aStored,
                appCount: aStored.length
            };

            var oModel = this.getOwnerComponent().getModel("appModel");
            oModel.setData(oData);
        },

        _getSampleApps: function () {
            return [
                    {
                        appId: "ZAPP_001",
                        appName: "고객 관리 앱",
                        appType: "Fiori",
                        description: "고객 정보 조회 및 관리",
                        createdAt: "2026-01-15",
                        updatedAt: "2026-07-20",
                        status: "Active",
                        statusState: "Success",
                        layout: {}
                    },
                    {
                        appId: "ZAPP_002",
                        appName: "주문 처리 앱",
                        appType: "SAPUI5",
                        description: "주문 생성 및 처리",
                        createdAt: "2026-02-10",
                        updatedAt: "2026-07-25",
                        status: "Active",
                        statusState: "Success",
                        layout: {}
                    },
                    {
                        appId: "ZAPP_003",
                        appName: "재고 조회 앱",
                        appType: "Fiori",
                        description: "실시간 재고 현황 조회",
                        createdAt: "2026-03-05",
                        updatedAt: "2026-07-28",
                        status: "Draft",
                        statusState: "Warning",
                        layout: {}
                    },
                    {
                        appId: "ZAPP_004",
                        appName: "결재 요청 앱",
                        appType: "SAPUI5",
                        description: "전자 결재 요청 및 승인",
                        createdAt: "2026-04-20",
                        updatedAt: "2026-07-29",
                        status: "Active",
                        statusState: "Success",
                        layout: {}
                    },
                    {
                        appId: "ZAPP_005",
                        appName: "보고서 생성 앱",
                        appType: "Fiori",
                        description: "월별 보고서 자동 생성",
                        createdAt: "2026-05-12",
                        updatedAt: "2026-07-15",
                        status: "Inactive",
                        statusState: "Error",
                        layout: {}
                    }
                ];
        },

        // Create new app - the SE24 class is mapped 1:1 at creation time
        // and cannot be changed afterwards.
        onPressCreate: function () {
            this._openCreateAppDialog(function (sAppId, sSe24Class) {
                var oModel = this.getOwnerComponent().getModel("appModel");
                var aApps = oModel.getProperty("/apps");
                var bExists = aApps.some(function (oApp) {
                    return oApp.appId === sAppId;
                });
                if (bExists) {
                    MessageBox.error("앱 ID '" + sAppId + "'이(가) 이미 존재합니다.");
                    return;
                }
                // 1:1 mapping - one class may only be used by a single app
                var oTaken = aApps.find(function (oApp) {
                    return oApp.se24 && oApp.se24.className === sSe24Class;
                });
                if (oTaken) {
                    MessageBox.error("클래스 '" + sSe24Class + "'은(는) 이미 앱 '" +
                        oTaken.appId + "'에 매핑되어 있습니다. (1:1 매핑)");
                    return;
                }

                var oConfigModel = this.getOwnerComponent().getModel("config");
                var sEndpoint =
                    (oConfigModel && oConfigModel.getProperty("/se24/endpoint")) ||
                    "";

                // Validate the class by loading its metadata right away;
                // the metadata is stored on the app record.
                MessageToast.show("클래스 메타데이터를 로드하는 중...");
                Se24Service.getMetadata(sEndpoint, sSe24Class)
                    .then(function (oMeta) {
                        var oNewApp = {
                            appId: sAppId,
                            appName: "새 앱",
                            appType: "SAPUI5",
                            description: "",
                            createdAt: new Date().toISOString().split("T")[0],
                            updatedAt: new Date().toISOString().split("T")[0],
                            status: "Draft",
                            statusState: "Warning",
                            layout: {},
                            se24: {
                                className: sSe24Class,
                                endpoint: sEndpoint,
                                attributes: oMeta.attributes || [],
                                methods: oMeta.methods || []
                            }
                        };
                        aApps.push(oNewApp);
                        oModel.setProperty("/apps", aApps);
                        oModel.setProperty("/appCount", aApps.length);
                        ZappsRepository.persistApps(aApps);
                        MessageToast.show("앱 '" + sAppId + "' 이(가) 생성되었습니다. (SE24: " +
                            sSe24Class + ")");
                    }.bind(this))
                    .catch(function (oError) {
                        MessageBox.error("클래스 '" + sSe24Class + "' 메타데이터 로드 실패: " +
                            oError.message);
                    });
            }.bind(this));
        },

        // Create dialog: app id + SE24 class (both mandatory, 1:1 fixed mapping)
        _openCreateAppDialog: function (fnOk) {
            var oIdInput = new sap.m.Input({
                placeholder: "새 앱 ID (예: ZAPPA_001)",
                width: "100%"
            });
            var oClassInput = new sap.m.Input({
                placeholder: "SE24 클래스 (예: ZCL_LAYOUT_DEMO)",
                width: "100%"
            });
            var oDialog = new sap.m.Dialog({
                title: "앱 생성",
                contentWidth: "400px",
                content: [
                    new sap.m.VBox({
                        items: [
                            new sap.m.Label({ text: "앱 ID", required: true }),
                            oIdInput,
                            new sap.m.Label({ text: "SE24 클래스", required: true })
                                .addStyleClass("sapUiTinyMarginTop"),
                            oClassInput,
                            new sap.m.Text({
                                text: "SE24 클래스는 앱과 1:1로 매핑되며 생성 후 변경할 수 없습니다."
                            }).addStyleClass("sapUiTinyMarginTop dialogHint")
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: new sap.m.Button({
                    text: "확인",
                    type: "Emphasized",
                    press: function () {
                        var sAppId = oIdInput.getValue().trim().toUpperCase().replace(/\s+/g, "");
                        var sSe24Class = oClassInput.getValue().trim().toUpperCase().replace(/\s+/g, "");
                        if (!sAppId) {
                            MessageBox.error("앱 ID를 입력하세요.");
                            return;
                        }
                        if (!sSe24Class) {
                            MessageBox.error("SE24 클래스 이름을 입력하세요.");
                            return;
                        }
                        oDialog.close();
                        fnOk(sAppId, sSe24Class);
                    }
                }),
                endButton: new sap.m.Button({
                    text: "취소",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });
            oDialog.open();
            oIdInput.focus();
        },

        // Simple input dialog for app ids (sap.m.MessageBox has no prompt API)
        _openAppIdDialog: function (sTitle, sPlaceholder, sInitialValue, fnOk) {
            var oInput = new sap.m.Input({
                value: sInitialValue || "",
                placeholder: sPlaceholder,
                width: "100%"
            });
            var oDialog = new sap.m.Dialog({
                title: sTitle,
                contentWidth: "360px",
                content: [
                    new sap.m.VBox({
                        items: [oInput]
                    }).addStyleClass("sapUiSmallMargin")
                ],
                beginButton: new sap.m.Button({
                    text: "확인",
                    type: "Emphasized",
                    press: function () {
                        var sValue = oInput.getValue();
                        oDialog.close();
                        if (sValue) {
                            fnOk(sValue);
                        }
                    }
                }),
                endButton: new sap.m.Button({
                    text: "취소",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });
            oInput.attachSubmit(function () {
                var sValue = oInput.getValue();
                oDialog.close();
                if (sValue) {
                    fnOk(sValue);
                }
            });
            oDialog.open();
            oInput.focus();
        },

        // Edit selected app
        onPressEdit: function () {
            var oTable = this.byId("appTable");
            var oSelectedItem = oTable.getSelectedItem();
            if (!oSelectedItem) {
                MessageToast.show("편집할 앱을 선택하세요.");
                return;
            }
            var oContext = oSelectedItem.getBindingContext("appModel");
            var sAppId = oContext.getProperty("appId");
            MessageToast.show("앱 '" + sAppId + "' 편집 모드로 이동합니다.");
            this.getOwnerComponent().getRouter().navTo("editor", { appId: sAppId });
        },

        // Delete selected app
        onPressDelete: function () {
            var oTable = this.byId("appTable");
            var oSelectedItem = oTable.getSelectedItem();
            if (!oSelectedItem) {
                MessageToast.show("삭제할 앱을 선택하세요.");
                return;
            }
            var oContext = oSelectedItem.getBindingContext("appModel");
            var sAppId = oContext.getProperty("appId");

            MessageBox.confirm("앱 '" + sAppId + "'을(를) 삭제하시겠습니까?", {
                title: "앱 삭제",
                onClose: function (oAction) {
                    if (oAction === MessageBox.Action.OK) {
                        var oModel = this.getOwnerComponent().getModel("appModel");
                        var aApps = oModel.getProperty("/apps");
                        var iIndex = aApps.findIndex(function (app) {
                            return app.appId === sAppId;
                        });
                        if (iIndex > -1) {
                            aApps.splice(iIndex, 1);
                            oModel.setProperty("/apps", aApps);
                            oModel.setProperty("/appCount", aApps.length);
                            ZappsRepository.deleteApp(sAppId);
                            MessageToast.show("앱 '" + sAppId + "'이(가) 삭제되었습니다.");
                        }
                    }
                }.bind(this)
            });
        },

        // Copy selected app
        onPressCopy: function () {
            var oTable = this.byId("appTable");
            var oSelectedItem = oTable.getSelectedItem();
            if (!oSelectedItem) {
                MessageToast.show("복사할 앱을 선택하세요.");
                return;
            }
            var oContext = oSelectedItem.getBindingContext("appModel");
            var oApp = oContext.getObject();

            this._openAppIdDialog("앱 복사", "복사할 앱 ID를 입력하세요", oApp.appId + "_COPY", function (sValue) {
                var sAppId = sValue.trim().toUpperCase().replace(/\s+/g, "");
                var oModel = this.getOwnerComponent().getModel("appModel");
                var aApps = oModel.getProperty("/apps");
                var bExists = aApps.some(function (oApp) {
                    return oApp.appId === sAppId;
                });
                if (bExists) {
                    MessageBox.error("앱 ID '" + sAppId + "'이(가) 이미 존재합니다.");
                    return;
                }
                var oCopy = JSON.parse(JSON.stringify(oApp));
                oCopy.appId = sAppId;
                oCopy.createdAt = new Date().toISOString().split("T")[0];
                oCopy.updatedAt = new Date().toISOString().split("T")[0];
                oCopy.status = "Draft";
                oCopy.statusState = "Warning";
                // SE24 mapping is 1:1 per app - it is not carried over to the copy
                oCopy.se24 = null;
                aApps.push(oCopy);
                oModel.setProperty("/apps", aApps);
                oModel.setProperty("/appCount", aApps.length);
                ZappsRepository.persistApps(aApps);
                MessageToast.show("앱 '" + sAppId + "'으로 복사되었습니다. (SE24 매핑은 복사되지 않음)");
            }.bind(this));
        },

        // Search apps
        onPressSearch: function () {
            this.byId("searchField").focus();
        },

        // Execute/Run selected app
        // TODO: 실제 실행 페이지 생성(onPressPreview)과 연결 - 현재는 스텁
        onPressExecute: function () {
            var oTable = this.byId("appTable");
            var oSelectedItem = oTable.getSelectedItem();
            if (!oSelectedItem) {
                MessageToast.show("실행할 앱을 선택하세요.");
                return;
            }
            var oContext = oSelectedItem.getBindingContext("appModel");
            var sAppId = oContext.getProperty("appId");
            MessageToast.show("앱 '" + sAppId + "'을(를) 실행합니다.");
        },

        // Search field handler
        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query");
            var oTable = this.byId("appTable");
            var oBinding = oTable.getBinding("items");

            if (!sQuery) {
                oBinding.filter([]);
                return;
            }

            var oFilter = new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("appId", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("appName", sap.ui.model.FilterOperator.Contains, sQuery)
                ],
                and: false
            });
            oBinding.filter([oFilter]);
        },

        // Row press navigates to the editor
        onPressApp: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("appModel");
            var sAppId = oContext.getProperty("appId");
            this.getOwnerComponent().getRouter().navTo("editor", { appId: sAppId });
        }
    });
});
