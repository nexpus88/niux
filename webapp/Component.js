sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
    "use strict";

    return UIComponent.extend("com.layout.editor.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.getRouter().initialize();

            var oModel = new JSONModel({
                apps: [],
                currentAppId: "",
                currentLayout: {}
            });
            this.setModel(oModel, "appModel");

            // Central app settings (UI5 version/theme, SE24 endpoint).
            // index.html already fetched appConfig.json before the bootstrap
            // and stored it on window; fall back to sane defaults.
            var oConfig = window.__editorConfig || {
                ui5: {
                    cdn: "https://sapui5.hana.ondemand.com",
                    version: "",
                    theme: "sap_horizon",
                    libs: "sap.m,sap.ui.layout,sap.f,sap.ui.unified,sap.ui.table,sap.uxap",
                    compatVersion: "edge"
                },
                se24: {
                    endpoint: "http://lrpsap.localdomain:50081/sap/bc/zse24",
                    client: "800"
                }
            };
            this.setModel(new JSONModel(oConfig), "config");
        }
    });
});
