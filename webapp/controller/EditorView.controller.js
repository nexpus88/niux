sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "com/layout/editor/util/ZappsRepository",
    "com/layout/editor/util/Se24Service",
  ],
  function (Controller, MessageToast, JSONModel, ZappsRepository, Se24Service) {
    "use strict";

    return Controller.extend("com.layout.editor.controller.EditorView", {
      _controlCatalog: null,
      _categoryDisplayNames: null,

      // Resolve an i18n key against the component's resource bundle.
      _i18n: function (sKey, aArgs) {
        return this.getOwnerComponent()
          .getModel("i18n")
          .getResourceBundle()
          .getText(sKey, aArgs);
      },

      // Formatter for the footer control counter ("{0} 컨트롤" template).
      formatControlCount: function (sCount, sTemplate) {
        return sTemplate ? sTemplate.replace("{0}", sCount) : sCount;
      },

      onInit: function () {
        var oRouter = this.getOwnerComponent().getRouter();
        oRouter
          .getRoute("editor")
          .attachPatternMatched(this._onRouteMatched, this);

        // Ctrl+S saves the current layout (blocks the browser's save-page dialog)
        this._fnSaveShortcut = function (oEvent) {
          if (
            (oEvent.ctrlKey || oEvent.metaKey) &&
            !oEvent.altKey &&
            (oEvent.key === "s" || oEvent.key === "S")
          ) {
            oEvent.preventDefault();
            this.onPressSave();
          }
        }.bind(this);
        document.addEventListener("keydown", this._fnSaveShortcut);

        // The unified library (context menu) is loaded lazily on first use in
        // _openContextMenu - no eager preload here so the editor opens faster.

        // Right-click on an outline item opens the same context menu as the canvas.
        // The delegate lives on the Tree control itself, so it survives outline rebuilds.
        var that = this;
        var oOutlineTree = this.byId("outlineTree");
        if (oOutlineTree) {
          oOutlineTree.addEventDelegate({
            oncontextmenu: function (oEvent) {
              var oTarget = oEvent.target;
              var oItemDom =
                oTarget && oTarget.closest ? oTarget.closest(".sapMLIB") : null;
              if (!oItemDom) {
                return;
              }
              var aItems = oOutlineTree.getItems();
              for (var i = 0; i < aItems.length; i++) {
                if (aItems[i].getDomRef() === oItemDom) {
                  that._onOutlineContextMenu(aItems[i], oEvent);
                  break;
                }
              }
            },
          });
        }

        // Initialize editor model
        var oEditorModel = this.getOwnerComponent().getModel("appModel");
        oEditorModel.setProperty("/currentXml", "");
        oEditorModel.setProperty("/selectedControl", {
          type: "",
          id: "",
        });
        oEditorModel.setProperty("/controlCount", 0);

        // Load or generate control catalog from metadata API
        this._loadOrGenerateCatalog();
      },

      _CATALOG_VERSION: 6, // Increment when catalog structure changes

      // Load catalog from localStorage, or generate from SAPUI5 metadata API.
      // The cache is keyed by the loaded UI5 version (pinned in
      // config/appConfig.json), so changing the version regenerates it.
      // The catalog feeds the aggregation-aware "Add Control" dialog
      // (_getAddDialogCandidates).
      _loadOrGenerateCatalog: function () {
        var sUi5Version = sap.ui.getVersionInfo && sap.ui.getVersionInfo().version;
        var sCacheKey = "sapui5_controlCatalog";
        var sCached = localStorage.getItem(sCacheKey);
        if (sCached) {
          try {
            var oCached = JSON.parse(sCached);
            // Check cache version + UI5 version - regenerate if either changed
            if (
              oCached.version === this._CATALOG_VERSION &&
              oCached.ui5Version === sUi5Version &&
              oCached.catalog
            ) {
              this._controlCatalog = oCached.catalog;
              this._categoryDisplayNames = oCached.displayNames;
              return;
            }
          } catch (e) {
            // corrupted cache, regenerate
          }
        }
        // Generate from SAPUI5 metadata API. Deferred so the editor shell and
        // the canvas render immediately; the catalog fills in the background
        // (only on first run - afterwards it is served from localStorage).
        var that = this;
        setTimeout(function () {
          that._generateCatalogFromMetadata();
          // Save to localStorage for next time
          localStorage.setItem(
            sCacheKey,
            JSON.stringify({
              version: that._CATALOG_VERSION,
              ui5Version: sUi5Version,
              catalog: that._controlCatalog,
              displayNames: that._categoryDisplayNames,
            }),
          );
        }, 0);
      },

      // Generate control catalog by querying SAPUI5 standard metadata API
      _generateCatalogFromMetadata: function () {
        // Ensure key libraries are loaded before querying metadata
        // Only load libraries known to be available in the current SAPUI5 version
        var aLibs = [
          "sap.m",
          "sap.f",
          "sap.ui.layout",
          "sap.ui.table",
          "sap.uxap",
        ];
        aLibs.forEach(function (sLib) {
          try {
            var oLib = sap.ui.getCore().getLoadedLibraries()[sLib];
            if (!oLib) {
              sap.ui.getCore().loadLibrary(sLib);
            }
          } catch (e) {
            /* library not available, skip */
          }
        });

        var oCatalog = {};
        var oDisplayNames = {};

        // Category definitions with matching rules
        var aCategories = [
          {
            key: "Action",
            display: "Action",
            match: function (sType, oMeta) {
              var oEvents = oMeta.getAllEvents();
              return "press" in oEvents || /Button|Link|Bookmark/i.test(sType);
            },
          },
          {
            key: "Container",
            display: "Container",
            match: function (sType, oMeta) {
              var oAggs = oMeta.getAllAggregations();
              return (
                ("items" in oAggs || "content" in oAggs || "pages" in oAggs) &&
                /Box|Panel|Container|Scroll|Flex/i.test(sType)
              );
            },
          },
          {
            key: "Display",
            display: "Display",
            match: function (sType, oMeta) {
              var oProps = oMeta.getAllProperties();
              return (
                "text" in oProps &&
                !/Button|Input|Check|Radio|Switch|Slider|Date|Select|Combo/i.test(
                  sType,
                )
              );
            },
          },
          {
            key: "Layout",
            display: "Layout",
            match: function (sType) {
              return /^sap\.ui\.layout\./.test(sType);
            },
          },
          {
            key: "List",
            display: "List",
            match: function (sType) {
              return (
                /Table|List|ListItem|Column/i.test(sType) &&
                !/Overflow|Upload/i.test(sType)
              );
            },
          },
          {
            key: "SemanticF",
            display: "Semantic (sap.f)",
            match: function (sType) {
              return /^sap\.f\./.test(sType);
            },
          },
          {
            key: "SemanticM",
            display: "Semantic (sap.m)",
            match: function (sType) {
              return /^sap\.m\.(Page|Toolbar|OverflowToolbar|SemanticPage|ActionSheet)$/.test(
                sType,
              );
            },
          },
          {
            key: "Smart",
            display: "Smart",
            match: function (sType) {
              return /^sap\.ui\.comp\./i.test(sType);
            },
          },
          {
            key: "Tile",
            display: "Tile",
            match: function (sType) {
              return /Tile/i.test(sType);
            },
          },
          {
            key: "UserInput",
            display: "User Input",
            match: function (sType, oMeta) {
              var oProps = oMeta.getAllProperties();
              return (
                "value" in oProps ||
                /Input|CheckBox|RadioButton|Switch|Slider|DatePicker|TimePicker|ComboBox|Select|TextArea|StepInput|RatingIndicator/i.test(
                  sType,
                )
              );
            },
          },
          {
            key: "VisualBusiness",
            display: "Visual Business",
            match: function (sType) {
              return (
                /^sap\.suite\./i.test(sType) ||
                /Chart|ChartContainer/i.test(sType)
              );
            },
          },
          {
            key: "Uxap",
            display: "UXAP",
            match: function (sType) {
              return /^sap\.uxap\./i.test(sType);
            },
          },
          {
            // Catch-all: controls that don't match any specific category
            // (e.g. sap.m.Bar which has contentLeft/Middle/Right, not items/content).
            key: "Other",
            display: "Other",
            match: function () {
              return true;
            },
          },
        ];

        // Default icon map based on control name patterns.
        // NOTE: only icon names verified via IconPool.getIconInfo may be used.
        var fnGetIcon = function (sType) {
          if (/Button/i.test(sType)) return "sap-icon://action";
          if (/Input|TextArea/i.test(sType)) return "sap-icon://edit";
          if (/Text|Label|Title/i.test(sType))
            return "sap-icon://text-align-justified";
          if (/Box|VBox|HBox|Flex/i.test(sType)) return "sap-icon://grid";
          if (/Panel|Container/i.test(sType)) return "sap-icon://group-2";
          if (/Table|List/i.test(sType)) return "sap-icon://table-view";
          if (/Image|Picture/i.test(sType)) return "sap-icon://picture";
          if (/Link|Chain/i.test(sType)) return "sap-icon://chain-link";
          if (/Check/i.test(sType)) return "sap-icon://check-availability";
          if (/Radio/i.test(sType)) return "sap-icon://circle-task";
          if (/Switch|Toggle/i.test(sType)) return "sap-icon://sys-enter-2";
          if (/Slider/i.test(sType)) return "sap-icon://resize-horizontal";
          if (/Date|Calendar/i.test(sType)) return "sap-icon://calendar";
          if (/Page|Toolbar/i.test(sType)) return "sap-icon://grid";
          if (/Tile/i.test(sType)) return "sap-icon://grid";
          if (/Chart/i.test(sType)) return "sap-icon://bar-chart";
          if (/Upload/i.test(sType)) return "sap-icon://upload";
          if (/Grid|Layout|Splitter/i.test(sType)) return "sap-icon://grid";
          if (/Scroll/i.test(sType)) return "sap-icon://widgets";
          return "sap-icon://widgets";
        };

        // Convert type name to display name
        var fnDisplayName = function (sType) {
          var sShort = sType.split(".").pop();
          // CamelCase to spaced: "OverflowToolbarButton" -> "Overflow Toolbar Button"
          return sShort.replace(/([A-Z])/g, " $1").trim();
        };

        // Extract aggregation info from metadata
        var fnGetAggregations = function (oMeta) {
          var oAggs = oMeta.getAllAggregations();
          var aResult = [];
          Object.keys(oAggs).forEach(function (sAggName) {
            var oAggDef = oAggs[sAggName];
            aResult.push({
              name: sAggName,
              type: oAggDef.type || "sap.ui.core.Element",
              multiple: !!oAggDef.multiple,
              singularName: oAggDef.singularName || sAggName,
            });
          });
          return aResult;
        };

        // Query all loaded libraries and their controls
        var oLibraries = sap.ui.getCore().getLoadedLibraries();
        Object.keys(oLibraries).forEach(function (sLibName) {
          var oLib = oLibraries[sLibName];
          // Skip internal/private libraries
          if (
            /^sap\.ui\.(core|base|model|unified)/.test(sLibName) ||
            /^themelib_/.test(sLibName)
          ) {
            return;
          }
          // Get all control AND element types from this library
          // (e.g. sap.m.Column is an Element, not a Control, so it would be
          // missed if we only looked at oLib.controls)
          var aTypes = [];
          if (oLib.controls) {
            aTypes = aTypes.concat(oLib.controls);
          }
          if (oLib.elements) {
            aTypes = aTypes.concat(oLib.elements);
          }
          if (aTypes.length === 0) {
            // Fallback: try to get types from the library's metadata
            try {
              var oLibMeta = jQuery.sap.getObject(sLibName);
              if (oLibMeta && oLibMeta.controls) {
                aTypes = aTypes.concat(oLibMeta.controls);
              }
              if (oLibMeta && oLibMeta.elements) {
                aTypes = aTypes.concat(oLibMeta.elements);
              }
            } catch (e) {
              /* skip */
            }
          }

          aTypes.forEach(function (sType) {
            try {
              var fnClass = jQuery.sap.getObject(sType);
              if (!fnClass || !fnClass.getMetadata) return;
              var oMeta = fnClass.getMetadata();
              if (!oMeta || oMeta.getName() !== sType) return;
              // Skip abstract classes and internal types
              if (oMeta.isAbstract && oMeta.isAbstract()) return;
              if (/internal|private|_/.test(sType)) return;

              // Find matching category
              for (var i = 0; i < aCategories.length; i++) {
                if (aCategories[i].match(sType, oMeta)) {
                  var sCatKey = aCategories[i].key;
                  if (!oCatalog[sCatKey]) {
                    oCatalog[sCatKey] = [];
                    oDisplayNames[sCatKey] = aCategories[i].display;
                  }
                  oCatalog[sCatKey].push({
                    name: fnDisplayName(sType),
                    type: sType,
                    icon: fnGetIcon(sType),
                    aggregations: fnGetAggregations(oMeta),
                  });
                  break;
                }
              }
            } catch (e) {
              /* skip unloadable types */
            }
          });
        });

        this._controlCatalog = oCatalog;
        this._categoryDisplayNames = oDisplayNames;
      },

      onAfterRendering: function () {
        // Attach selection handlers to initial canvas controls
        var oCanvas = this.byId("designCanvas");
        if (oCanvas) {
          this._attachSelectionToAll(oCanvas);
        }
        // Set up splitter drag handles (once)
        this._setupSplitterBars();
        // Sync Code view with the actual canvas hierarchy on initial load
        this._updateXmlFromCanvas();
        // Populate the outline tree on initial load (no longer behind a tab)
        this._refreshOutline();
      },

      // Set up draggable splitter bars between left/center/right panes
      _setupSplitterBars: function () {
        if (this._splitterBarsAttached) {
          return;
        }
        var oLeftBarCtrl = this.byId("leftSplitterBar");
        var oRightBarCtrl = this.byId("rightSplitterBar");
        var oLeftPane = this.byId("leftPane");
        var oRightPane = this.byId("rightPane");
        if (!oLeftBarCtrl || !oRightBarCtrl || !oLeftPane || !oRightPane) {
          return;
        }
        this._splitterBarsAttached = true;
        this._attachBarDrag(oLeftBarCtrl, oLeftPane, false);
        this._attachBarDrag(oRightBarCtrl, oRightPane, true);
      },

      // Attach mousedown drag logic to a splitter bar control
      _attachBarDrag: function (oBarCtrl, oPane, bRightSide) {
        oBarCtrl.attachBrowserEvent("mousedown", function (oEvent) {
          oEvent.preventDefault();
          var iStartX = oEvent.clientX;
          var iStartWidth = oPane.$().width();

          var onMouseMove = function (oMoveEvent) {
            var iDelta = oMoveEvent.clientX - iStartX;
            var iNewWidth = bRightSide
              ? iStartWidth - iDelta
              : iStartWidth + iDelta;
            // Clamp between 150px and 600px
            iNewWidth = Math.max(150, Math.min(600, iNewWidth));
            oPane.setWidth(iNewWidth + "px");
          };

          var onMouseUp = function () {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
          };

          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        });
      },

      // Recursively attach click selection handler to all controls
      _attachSelectionToAll: function (oControl) {
        var that = this;
        var oMetadata = oControl.getMetadata();
        var oAggregations = oMetadata.getAllAggregations();

        Object.keys(oAggregations).forEach(function (sAggName) {
          var vContent = oControl.getAggregation(sAggName);
          if (!vContent) {
            return;
          }
          var aContent = Array.isArray(vContent) ? vContent : [vContent];
          aContent.forEach(function (oChild) {
            if (oChild && oChild.isA && oChild.isA("sap.ui.core.Control")) {
              that._attachSelectionHandler(oChild);
              that._attachSelectionToAll(oChild);
            }
          });
        });
      },

      // Attach a single click selection handler to a control
      _attachSelectionHandler: function (oControl) {
        var that = this;
        // Non-rendering Elements (e.g. FormElement) have no DOM and no
        // addEventDelegate - selection happens via their parent/outline
        if (!oControl || typeof oControl.addEventDelegate !== "function") {
          return;
        }
        // Avoid double-attaching
        if (oControl._selectionHandlerAttached) {
          return;
        }
        oControl._selectionHandlerAttached = true;
        oControl.addEventDelegate({
          onclick: function (oEvent) {
            // Stop bubbling so only the innermost control gets selected
            oEvent.stopPropagation();
            that._selectControl(oControl);
          },
          oncontextmenu: function (oEvent) {
            // Suppress the browser menu and show the editor context menu
            oEvent.preventDefault();
            oEvent.stopPropagation();
            that._selectControl(oControl);
            that._openContextMenu(oControl, oEvent);
          },
        });
      },

      _onRouteMatched: function (oEvent) {
        var sAppId = oEvent.getParameter("arguments").appId;
        var oModel = this.getOwnerComponent().getModel("appModel");
        oModel.setProperty("/currentAppId", sAppId);

        // Load layout for this app
        this._loadLayout(sAppId);
      },

      _loadLayout: function (sAppId) {
        // Prefer the persistent ZAPPS store (survives page refresh);
        // fall back to the in-memory app list.
        var oApp = ZappsRepository.readApp(sAppId);
        var oModel = this.getOwnerComponent().getModel("appModel");
        if (!oApp) {
          var aApps = oModel.getProperty("/apps") || [];
          oApp = aApps.find(function (app) {
            return app.appId === sAppId;
          });
        }

        // Restore the app's SE24 class mapping (if configured)
        oModel.setProperty("/se24", (oApp && oApp.se24) || null);

        // The view is reused between apps - clear the previous selection
        // state so nothing from the last app leaks into this one.
        this._resetSelectionPanel();

        // Restore the App root's own properties (backgroundColor, homeIcon, ...)
        this._applyAppProps(oApp && oApp.layout && oApp.layout.appProps);

        if (
          oApp &&
          oApp.layout &&
          oApp.layout.tree &&
          oApp.layout.tree.length > 0
        ) {
          // Rebuild the editable canvas from the saved tree
          this._clearCanvas();
          this._applyPageProps(oApp.layout.pageProps);
          this._restoreCanvasFromTree(oApp.layout.tree);
          this._updateXmlFromCanvas();
          this._refreshOutline();
        } else {
          // Default empty layout - the view is reused across apps, so the
          // canvas must always be reset to the sample content first.
          this._clearCanvas();
          this._applyPageProps(
            (oApp && oApp.layout && oApp.layout.pageProps) || null,
          );
          this._buildDefaultCanvas();
          this._updateXmlFromCanvas();
          this._refreshOutline();
          this.getOwnerComponent()
            .getModel("appModel")
            .setProperty("/controlCount", this._countCanvasElements());
        }
      },

      // Reset the right-hand inspector back to the "no selection" state
      _resetSelectionPanel: function () {
        var oModel = this.getOwnerComponent().getModel("appModel");
        this._sSelectedControlId = null;
        oModel.setProperty("/selectedControl", { type: "", id: "" });
        this.byId("noSelection").setVisible(true);
        this.byId("propertiesContent").setVisible(false);
      },

      // Aggregations that are framework/editor infrastructure rather than
      // user content (customData, layoutData, tooltip, dependents,
      // dragDropConfig, private underscore aggregations). They are never
      // counted, serialized, outlined, or traversed.
      _isTechnicalAggregation: function (sName) {
        return (
          sName === "customData" ||
          sName === "layoutData" ||
          sName === "tooltip" ||
          sName === "dependents" ||
          sName === "dragDropConfig" ||
          sName.charAt(0) === "_"
        );
      },

      // Count all Elements below the design page (for the status bar)
      _countCanvasElements: function () {
        var that = this;
        var iCount = 0;
        function walk(oControl) {
          if (!oControl || !oControl.getMetadata) {
            return;
          }
          iCount++;
          var oAggs = oControl.getMetadata().getAllAggregations();
          Object.keys(oAggs).forEach(function (sName) {
            if (that._isTechnicalAggregation(sName)) {
              return;
            }
            var vContent = oControl.getAggregation(sName);
            if (!vContent) {
              return;
            }
            (Array.isArray(vContent) ? vContent : [vContent]).forEach(walk);
          });
        }
        var oPage = this.byId("designPage");
        if (oPage) {
          (oPage.getAggregation("content") || []).forEach(walk);
        }
        return iCount;
      },

      // Remove (and destroy) all design page content so the canvas starts clean
      _clearCanvas: function () {
        var oPage = this.byId("designPage");
        if (!oPage) {
          return;
        }
        var aOldContent = oPage.removeAllContent();
        aOldContent.forEach(function (oChild) {
          oChild.destroy();
        });
      },

      // Return the off-canvas design-time sap.m.App that represents the runtime
      // root of the generated view. It is a real ManagedObject (kept as a view
      // dependent) so the outline "sap.m.App" node can be selected and its
      // properties edited - but it is never rendered on the canvas; it only backs
      // the <App> root element of the generated XML.
      _getDesignApp: function () {
        if (!this._oDesignApp) {
          var oApp = new sap.m.App(this.createId("designApp"));
          // Bind it to the view lifecycle (destroyed together with the editor)
          this.getView().addDependent(oApp);
          this._oDesignApp = oApp;
        }
        return this._oDesignApp;
      },

      // True only for the off-canvas design App root. The App is a protected
      // node: its properties are editable, but it can never be copied, moved,
      // pasted into, or deleted.
      _isDesignApp: function (oControl) {
        return !!oControl && !!this._oDesignApp && oControl === this._oDesignApp;
      },

      // Collect the canvas Page's own property values (title, ...).
      // The content aggregation is stored in the tree; the Page itself is
      // the canvas root, so its attributes are kept separately (future
      // SE11 column could merge them into LAYOUT_TREE).
      _collectPageProps: function () {
        var oPage = this.byId("designPage");
        var oProps = {};
        if (!oPage) {
          return oProps;
        }
        var oPropDefs = oPage.getMetadata().getAllProperties();
        Object.keys(oPropDefs).forEach(function (sName) {
          var vValue = oPage.getProperty(sName);
          if (vValue === null || vValue === undefined || vValue === "") {
            return;
          }
          if (vValue === oPropDefs[sName].defaultValue) {
            return;
          }
          if (typeof vValue === "object") {
            return;
          }
          oProps[sName] = vValue;
        });
        var aClasses = this._styleClassesOf(oPage);
        if (aClasses.length > 0) {
          oProps.styleClasses = aClasses;
        }
        return oProps;
      },

      // Restore the canvas Page's own properties (inverse of
      // _collectPageProps). Properties without a saved value are reset to
      // their metadata default so state never leaks between apps.
      _applyPageProps: function (oPageProps) {
        var oPage = this.byId("designPage");
        if (!oPage) {
          return;
        }
        var oSaved = oPageProps || {};
        var oPropDefs = oPage.getMetadata().getAllProperties();
        Object.keys(oPropDefs).forEach(function (sName) {
          var vValue =
            sName in oSaved ? oSaved[sName] : oPropDefs[sName].defaultValue;
          // Use specific setter (e.g. setTitle) if available, as it may
          // trigger additional internal updates (e.g. header title control)
          var sSetter = "set" + sName.charAt(0).toUpperCase() + sName.slice(1);
          if (typeof oPage[sSetter] === "function") {
            oPage[sSetter](vValue);
          } else {
            oPage.setProperty(sName, vValue);
          }
        });
        var that = this;
        this._styleClassesOf(oPage).forEach(function (sCls) {
          oPage.removeStyleClass(sCls);
        });
        (oSaved.styleClasses || []).forEach(function (sCls) {
          that.byId("designPage").addStyleClass(sCls);
        });
        // Explicitly re-render the page so the header reflects the restored title
        if (typeof oPage.rerender === "function") {
          oPage.rerender();
        }
      },

      // Collect the design App root's own property values (backgroundColor,
      // homeIcon, ...). Mirrors _collectPageProps for the off-canvas App.
      _collectAppProps: function () {
        var oApp = this._getDesignApp();
        var oProps = {};
        var oPropDefs = oApp.getMetadata().getAllProperties();
        Object.keys(oPropDefs).forEach(function (sName) {
          var vValue = oApp.getProperty(sName);
          if (vValue === null || vValue === undefined || vValue === "") {
            return;
          }
          if (vValue === oPropDefs[sName].defaultValue) {
            return;
          }
          if (typeof vValue === "object") {
            return;
          }
          oProps[sName] = vValue;
        });
        var aClasses = this._styleClassesOf(oApp);
        if (aClasses.length > 0) {
          oProps.styleClasses = aClasses;
        }
        return oProps;
      },

      // Restore the design App root's own properties (inverse of
      // _collectAppProps). Unsaved properties reset to their metadata default
      // so state never leaks between apps.
      _applyAppProps: function (oAppProps) {
        var oApp = this._getDesignApp();
        var oSaved = oAppProps || {};
        var oPropDefs = oApp.getMetadata().getAllProperties();
        Object.keys(oPropDefs).forEach(function (sName) {
          var vValue =
            sName in oSaved ? oSaved[sName] : oPropDefs[sName].defaultValue;
          var sSetter = "set" + sName.charAt(0).toUpperCase() + sName.slice(1);
          if (typeof oApp[sSetter] === "function") {
            oApp[sSetter](vValue);
          } else {
            oApp.setProperty(sName, vValue);
          }
        });
        this._styleClassesOf(oApp).forEach(function (sCls) {
          oApp.removeStyleClass(sCls);
        });
        (oSaved.styleClasses || []).forEach(function (sCls) {
          oApp.addStyleClass(sCls);
        });
      },

      // Default canvas for apps without a saved tree: an empty Page only.
      // The declarative designPage in EditorView.view.xml ships without
      // content, so only the selection delegates need to be attached.
      _buildDefaultCanvas: function () {
        var oPage = this.byId("designPage");
        if (!oPage) {
          return;
        }
        this._attachSelectionToAll(this.byId("designCanvas"));
      },

      // Serialize the canvas into a JSON tree that can fully restore the
      // editor state later (future SE11 column LAYOUT_TREE).
      // Node shape: { id, type, props, bindingMeta, aggregations }
      _buildCanvasTree: function () {
        var that = this;
        var oPage = this.byId("designPage");
        if (!oPage) {
          return [];
        }

        function nodeOf(oControl) {
          var oNode = {
            id: oControl.getId(),
            type: oControl.getMetadata().getName(),
            props: {},
            aggregations: {},
          };

          // Only keep properties that differ from their metadata default
          var oPropDefs = oControl.getMetadata().getAllProperties();
          Object.keys(oPropDefs).forEach(function (sName) {
            var vValue = oControl.getProperty(sName);
            if (vValue === null || vValue === undefined || vValue === "") {
              return;
            }
            if (vValue === oPropDefs[sName].defaultValue) {
              return;
            }
            oNode.props[sName] = vValue;
          });

          // Bound properties / event handlers live on the control instance
          if (oControl._bindingMeta) {
            oNode.bindingMeta = jQuery.extend(true, {}, oControl._bindingMeta);
          }

          // User-assigned CSS classes ("class" pseudo-property); the
          // transient selection highlight is never persisted
          if (oControl.isA && oControl.isA("sap.ui.core.Control")) {
            var aStyleClasses = that._styleClassesOf(oControl).filter(
              function (sCls) {
                return sCls !== "controlSelected";
              },
            );
            if (aStyleClasses.length > 0) {
              oNode.styleClasses = aStyleClasses;
            }
          }

          var oAggDefs = oControl.getMetadata().getAllAggregations();
          Object.keys(oAggDefs).forEach(function (sAggName) {
            if (that._isTechnicalAggregation(sAggName)) {
              return;
            }
            var vContent = oControl.getAggregation(sAggName);
            if (!vContent) {
              return;
            }
            var aContent = Array.isArray(vContent) ? vContent : [vContent];
            var aChildren = aContent.filter(function (oChild) {
              return oChild && oChild.isA && oChild.isA("sap.ui.core.Element");
            });
            if (aChildren.length > 0) {
              oNode.aggregations[sAggName] = aChildren.map(nodeOf);
            }
          });
          return oNode;
        }

        var aContent = oPage.getAggregation("content") || [];
        return aContent
          .filter(function (oChild) {
            return oChild && oChild.isA && oChild.isA("sap.ui.core.Element");
          })
          .map(nodeOf);
      },

      // Rebuild the canvas controls from a saved tree (inverse of
      // _buildCanvasTree). Keeps the saved control ids so later
      // maintenance and id references stay stable.
      _restoreCanvasFromTree: function (aNodes) {
        var that = this;
        var oPage = this.byId("designPage");
        if (!oPage) {
          return;
        }
        var iRestoredCount = 0;
        // UI5 auto-generated ids ("__button49") are not stable across
        // sessions - reassign semantic ids (button_N) at restore time.
        var RE_AUTO_ID = /^__/;
        var RE_SUFFIX = /_?(\d+)$/;
        var oUsedIds = {};

        function semanticId(oNode) {
          if (oNode.id && !RE_AUTO_ID.test(oNode.id)) {
            return oNode.id;
          }
          var sBase = (oNode.type.split(".").pop() || "control")
            .charAt(0)
            .toLowerCase() + (oNode.type.split(".").pop() || "control").slice(1);
          var iNum = 1;
          var oMatch = oNode.id ? RE_SUFFIX.exec(oNode.id) : null;
          if (oMatch) {
            iNum = parseInt(oMatch[1], 10) || 1;
          }
          var sId = sBase + "_" + iNum;
          while (oUsedIds[sId] || sap.ui.getCore().byId(sId)) {
            iNum++;
            sId = sBase + "_" + iNum;
          }
          oUsedIds[sId] = true;
          return sId;
        }

        function instantiate(oNode) {
          var fnClass = jQuery.sap.getObject(oNode.type);
          if (!fnClass) {
            try {
              jQuery.sap.require(oNode.type);
              fnClass = jQuery.sap.getObject(oNode.type);
            } catch (e) {
              /* class unavailable */
            }
          }
          if (typeof fnClass !== "function") {
            return null;
          }
          var oControl;
          try {
            // Keep the original id; fall back to an auto id on collision
            oControl = new fnClass(semanticId(oNode), {});
          } catch (e) {
            oControl = new fnClass({});
          }
          Object.keys(oNode.props || {}).forEach(function (sName) {
            oControl.setProperty(sName, oNode.props[sName]);
          });
          if (oNode.bindingMeta) {
            oControl._bindingMeta = jQuery.extend(true, {}, oNode.bindingMeta);
            // Mirrored expressions may be missing on old saved layouts
            that._syncAllBindingDisplays(oControl);
          }
          if (oNode.styleClasses && oControl.addStyleClass) {
            oNode.styleClasses.forEach(function (sCls) {
              oControl.addStyleClass(sCls);
            });
          }
          iRestoredCount++;
          var oAggDefs = oControl.getMetadata().getAllAggregations();
          Object.keys(oNode.aggregations || {}).forEach(function (sAggName) {
            // Respect aggregation cardinality: 0..1 uses setAggregation,
            // 0..n uses addAggregation (addAggregation on a singular
            // aggregation raises a cardinality error)
            var bMultiple = !oAggDefs[sAggName] || !!oAggDefs[sAggName].multiple;
            oNode.aggregations[sAggName].forEach(function (oChildNode) {
              var oChild = instantiate(oChildNode);
              if (oChild) {
                if (bMultiple) {
                  oControl.addAggregation(sAggName, oChild);
                } else {
                  oControl.setAggregation(sAggName, oChild);
                }
              }
            });
          });
          // A Form renders nothing without a FormLayout; older saved trees
          // may lack one, so inject a default layout at restore time.
          if (
            oControl.isA &&
            oControl.isA("sap.ui.layout.form.Form") &&
            !oControl.getLayout()
          ) {
            try {
              jQuery.sap.require("sap.ui.layout.form.ResponsiveGridLayout");
              oControl.setLayout(
                new sap.ui.layout.form.ResponsiveGridLayout(),
              );
            } catch (e) {
              /* layout class unavailable */
            }
          }
          return oControl;
        }

        aNodes.forEach(
          function (oNode) {
            var oControl = instantiate(oNode);
            if (oControl) {
              oPage.addContent(oControl);
            }
          }.bind(this)
        );

        // Re-wire selection handling; the control count now mirrors the
        // number of restored elements (id numbering probes live ids).
        this._attachSelectionToAll(this.byId("designCanvas"));
        this.getOwnerComponent()
          .getModel("appModel")
          .setProperty("/controlCount", iRestoredCount);
      },

      onExit: function () {
        if (this._fnSaveShortcut) {
          document.removeEventListener("keydown", this._fnSaveShortcut);
          this._fnSaveShortcut = null;
        }
      },

      // Navigation
      onNavBack: function () {
        var oRouter = this.getOwnerComponent().getRouter();
        oRouter.navTo("list");
      },

      // Canvas mode change (Design/Code/Preview)
      onCanvasModeChange: function (oEvent) {
        var sKey = oEvent.getParameter("item").getKey();
        var oDesignCanvas = this.byId("designCanvas");
        var oCodeView = this.byId("codeView");

        switch (sKey) {
          case "design":
            oDesignCanvas.setVisible(true);
            oCodeView.setVisible(false);
            break;
          case "code":
            oDesignCanvas.setVisible(false);
            oCodeView.setVisible(true);
            break;
          case "preview":
            // Preview opens the generated app in a new window; the editor
            // canvas itself stays in its current mode, so restore the selection
            this.byId("canvasMode").setSelectedKey(
              oCodeView.getVisible() ? "code" : "design",
            );
            this.onPressPreview();
            break;
        }
      },

      _createControl: function (sName, sType, iId) {
        // Find a free id of the form <name>_N (per type, collision-safe)
        var sId = this._nextFreeId(sName.toLowerCase().replace(/\s+/g, ""));

        // Known types with specific default settings
        switch (sName) {
          case "Button":
            return new sap.m.Button({ id: sId, text: "Button " + iId });
          case "Text":
            return new sap.m.Text({ id: sId, text: "Text " + iId });
          case "Input":
            return new sap.m.Input({ id: sId });
          case "Label":
            return new sap.m.Label({ id: sId, text: "Label " + iId });
          case "CheckBox":
            return new sap.m.CheckBox({ id: sId, text: "CheckBox " + iId });
          case "Title":
            return new sap.m.Title({
              id: sId,
              text: "Title " + iId,
              level: "H3",
            });
          case "Link":
            return new sap.m.Link({ id: sId, text: "Link " + iId });
          case "Image":
            return new sap.m.Image({ id: sId });
          case "ToolbarSpacer":
            return new sap.m.ToolbarSpacer({ id: sId });
          case "Form": {
            // A Form renders absolutely nothing without a FormLayout, so
            // always create one plus an initial (empty) container that the
            // user can right-click to fill with form elements.
            jQuery.sap.require("sap.ui.layout.form.Form");
            jQuery.sap.require("sap.ui.layout.form.ResponsiveGridLayout");
            return new sap.ui.layout.form.Form({
              id: sId,
              layout: new sap.ui.layout.form.ResponsiveGridLayout(),
              formContainers: [new sap.ui.layout.form.FormContainer({})],
            });
          }
        }

        // Dynamic instantiation for any control type from the metadata catalog
        var fnClass = jQuery.sap.getObject(sType);
        if (!fnClass) {
          try {
            jQuery.sap.require(sType);
            fnClass = jQuery.sap.getObject(sType);
          } catch (e) {
            /* load failed */
          }
        }
        if (typeof fnClass === "function") {
          try {
            var oMeta = fnClass.getMetadata ? fnClass.getMetadata() : null;
            var oSettings = { id: sId };

            // Set sensible defaults based on metadata
            if (oMeta) {
              var oProps = oMeta.getAllProperties();
              if ("text" in oProps) {
                oSettings.text = sName + " " + iId;
              } else if ("value" in oProps) {
                oSettings.value = "";
                if ("placeholder" in oProps) {
                  oSettings.placeholder = sName + " " + iId;
                }
              } else if ("title" in oProps) {
                oSettings.title = sName + " " + iId;
              }
            }

            return new fnClass(oSettings);
          } catch (e) {
            // fallback
          }
        }

        // Ultimate fallback
        return new sap.m.Text({ id: sId, text: "[" + sName + "] " + iId });
      },

      // Return the next unused id "<sBase>_N" (starting at 1).
      _nextFreeId: function (sBase) {
        var iNum = 1;
        var sId = sBase + "_" + iNum;
        while (sap.ui.getCore().byId(sId)) {
          iNum++;
          sId = sBase + "_" + iNum;
        }
        return sId;
      },

      _selectControl: function (oControl) {
        var oModel = this.getOwnerComponent().getModel("appModel");
        var sType = oControl.getMetadata().getName();
        var sId = oControl.getId();

        oModel.setProperty("/selectedControl", {
          type: sType,
          id: sId,
        });

        // Highlight the control on the canvas (blue dashed border)
        this._highlightCanvasControl(oControl);

        // Sync the outline tree selection with the selected control
        this._syncOutlineSelection(sId);

        // Show properties panel (always default back to the Properties tab)
        this.byId("noSelection").setVisible(false);
        this.byId("propertiesContent").setVisible(true);
        this.byId("propertiesContent").setSelectedKey("properties");

        // Build dynamic properties from metadata
        this._buildPropertiesPanel(oControl);
      },

      // Apply the blue dashed selection border to a canvas control,
      // clearing the border from the previously selected control.
      _highlightCanvasControl: function (oControl) {
        // Clear previous highlight (look up by id to avoid disposed controls)
        if (
          this._sSelectedControlId &&
          this._sSelectedControlId !== oControl.getId()
        ) {
          var oPrev = sap.ui.getCore().byId(this._sSelectedControlId);
          if (oPrev && oPrev.removeStyleClass) {
            oPrev.removeStyleClass("controlSelected");
          }
        }
        // Apply highlight to the newly selected control
        if (oControl.addStyleClass) {
          oControl.addStyleClass("controlSelected");
        }
        this._sSelectedControlId = oControl.getId();
      },

      // Select the outline tree item that corresponds to the given control id
      _syncOutlineSelection: function (sControlId) {
        var oTree = this.byId("outlineTree");
        if (!oTree) {
          return;
        }
        var oTargetItem = this._findOutlineItem(oTree, sControlId);
        if (oTargetItem) {
          oTree.setSelectedItem(oTargetItem);
        } else {
          // Outline not built yet or stale - rebuild (restores selection from model)
          this._refreshOutline();
        }
      },

      // Find an outline tree item by its bound controlId
      _findOutlineItem: function (oTree, sControlId) {
        var aItems = oTree.getItems();
        for (var i = 0; i < aItems.length; i++) {
          var oContext = aItems[i].getBindingContext();
          if (oContext && oContext.getProperty("controlId") === sControlId) {
            return aItems[i];
          }
        }
        return null;
      },

      // ===================== Context Menu =====================

      // Build and open the context menu for a canvas control at the mouse position.
      // oAnchorControl (optional) is the control used to position the menu - it
      // defaults to the target control itself (canvas case); when invoked from the
      // outline tree, the tree item is passed so the menu opens at the mouse pointer.
      // sAggOverride (optional) switches to aggregation-node mode: the menu then
      // only offers "add", targeted at that specific aggregation of oControl
      // (e.g. right-clicking the "columns" folder of a Table in the outline).
      _openContextMenu: function (oControl, oEvent, oAnchorControl, sAggOverride) {
        var that = this;
        // Ensure the unified library (Menu) is available
        if (!sap.ui.unified || !sap.ui.unified.Menu) {
          sap.ui.getCore().loadLibrary("sap.ui.unified");
        }
        this._closeContextMenu();

        var sType = oControl.getMetadata().getName();
        var oMenu = new sap.ui.unified.Menu();

        // Helper: create a menu item, storing its action as custom data
        var fnAddItem = function (sText, sIcon, sAction, bEnabled) {
          var oItem = new sap.ui.unified.MenuItem({
            text: sText,
            icon: sIcon || "",
            enabled: bEnabled !== false,
          });
          if (sAction) {
            oItem.data("action", sAction);
          }
          oMenu.addItem(oItem);
        };

        // Header: control type (non-interactive)
        fnAddItem(sType, "", null, false);

        // The off-canvas App root is selectable for property editing, but none of
        // the structural actions below may touch it.
        var bIsDesignApp = this._isDesignApp(oControl);

        if (sAggOverride) {
          // Aggregation-node mode: only "add" is offered, targeting the specific
          // aggregation (e.g. a new Column under a Table's "columns" node).
          var oAggOverride = oControl
            .getMetadata()
            .getAllAggregations()[sAggOverride];
          fnAddItem(
            this._i18n("ctx.add"),
            "sap-icon://add",
            "add",
            !!oAggOverride && !bIsDesignApp,
          );
        } else {
          // Add - opens a searchable dialog listing controls that fit the target's
          // aggregations (aggregation-aware). Disabled when the target has no
          // multiple aggregation that can receive a child.
          var bCanAdd = this._getPrimaryAggregationName(oControl) !== null;
          fnAddItem(this._i18n("ctx.add"), "sap-icon://add", "add", bCanAdd && !bIsDesignApp);

          // Move up / Move down
          fnAddItem(
            this._i18n("ctx.moveUp"),
            "sap-icon://arrow-top",
            "moveUp",
            this._canMoveControl(oControl, -1) && !bIsDesignApp,
          );
          fnAddItem(
            this._i18n("ctx.moveDown"),
            "sap-icon://arrow-bottom",
            "moveDown",
            this._canMoveControl(oControl, 1) && !bIsDesignApp,
          );

          // Copy: store a snapshot on the clipboard. Pasting is a separate step
          // offered from the context menu of the paste target.
          fnAddItem(this._i18n("ctx.copy"), "sap-icon://copy", "copy", !bIsDesignApp);

          // Paste actions - only offered once something has been copied.
          // "Before"/"After" insert the copy as a sibling of the target (available
          // at the same level, the parent's siblings, grandparents, ...); on the
          // copy's own parent only "붙여넣기" (append into it) is active.
          var oPasteInfo = bIsDesignApp ? null : this._getPasteInfo(oControl);
          if (oPasteInfo) {
            fnAddItem(
              this._i18n("ctx.paste"),
              "sap-icon://paste",
              "paste",
              oPasteInfo.canPaste,
            );
            fnAddItem(
              this._i18n("ctx.pasteBefore"),
              "sap-icon://arrow-top",
              "pasteBefore",
              oPasteInfo.canBeforeAfter,
            );
            fnAddItem(
              this._i18n("ctx.pasteAfter"),
              "sap-icon://arrow-bottom",
              "pasteAfter",
              oPasteInfo.canBeforeAfter,
            );
          }

          // Delete (disabled for the canvas root, design page and App root)
          var bIsCanvasRoot =
            oControl === this.byId("designCanvas") ||
            oControl === this.byId("designPage") ||
            bIsDesignApp;
          fnAddItem(this._i18n("ctx.delete"), "sap-icon://delete", "delete", !bIsCanvasRoot);
        }

        // Dispatch the selected action (MenuItem has no own select event)
        oMenu.attachItemSelect(function (oEvent) {
          var oItem = oEvent.getParameter("item");
          var sAction = oItem ? oItem.data("action") : null;
          switch (sAction) {
            case "add":
              that._openAddControlDialog(oControl, sAggOverride);
              break;
            case "moveUp":
              that._moveControl(oControl, -1);
              break;
            case "moveDown":
              that._moveControl(oControl, 1);
              break;
            case "copy":
              that._copyControl(oControl);
              break;
            case "paste":
              that._pasteControl(oControl);
              break;
            case "pasteBefore":
              that._pasteControl(oControl, "before");
              break;
            case "pasteAfter":
              that._pasteControl(oControl, "after");
              break;
            case "delete":
              that._deleteControl(oControl);
              break;
            default:
              break;
          }
        });

        this._oContextMenu = oMenu;
        // NOTE: do NOT destroy the menu in its "closed" handler. The unified
        // Menu closes itself BEFORE firing itemSelect, so destroying it on
        // close would dispose the control before the action event is delivered.
        // The previous menu is destroyed the next time the context menu opens.

        // Position the menu's top-left corner at the mouse pointer
        var oAnchor = oAnchorControl || oControl;
        var oDom = oAnchor.getDomRef();
        var sOffset = "0 0";
        if (oDom) {
          var oRect = oDom.getBoundingClientRect();
          var iScrollX =
            window.scrollX || document.documentElement.scrollLeft || 0;
          var iScrollY =
            window.scrollY || document.documentElement.scrollTop || 0;
          var iX =
            (oEvent.pageX ||
              (oEvent.originalEvent && oEvent.originalEvent.pageX) ||
              0) -
            (oRect.left + iScrollX);
          var iY =
            (oEvent.pageY ||
              (oEvent.originalEvent && oEvent.originalEvent.pageY) ||
              0) -
            (oRect.top + iScrollY);
          sOffset = iX + " " + iY;
        }
        oMenu.open(
          false,
          oAnchor,
          sap.ui.core.Popup.Dock.BeginTop,
          sap.ui.core.Popup.Dock.BeginTop,
          oAnchor,
          sOffset,
        );
      },

      // Destroy the currently open context menu (if any)
      _closeContextMenu: function () {
        if (this._oContextMenu && !this._oContextMenu.bIsDestroyed) {
          this._oContextMenu.destroy();
        }
        this._oContextMenu = null;
      },

      // Locate the parent aggregation that holds the control and return its info
      _findAggregationInfo: function (oControl) {
        var oParent = oControl.getParent();
        if (!oParent) {
          return null;
        }
        var oAggregations = oParent.getMetadata().getAllAggregations();
        for (var sName in oAggregations) {
          if (!oAggregations[sName].multiple) {
            continue;
          }
          var iIndex = oParent.indexOfAggregation(sName, oControl);
          if (iIndex > -1) {
            return {
              parent: oParent,
              aggregation: sName,
              index: iIndex,
              length: oParent.getAggregation(sName).length,
            };
          }
        }
        return null;
      },

      // Whether the control can be moved in the given direction (-1 up, +1 down)
      _canMoveControl: function (oControl, iDirection) {
        var oInfo = this._findAggregationInfo(oControl);
        if (!oInfo) {
          return false;
        }
        var iNewIndex = oInfo.index + iDirection;
        return iNewIndex >= 0 && iNewIndex < oInfo.length;
      },

      // Move the control up (-1) or down (+1) within its parent aggregation
      _moveControl: function (oControl, iDirection) {
        // Protect the canvas root, design page and App root from being moved
        if (
          oControl === this.byId("designCanvas") ||
          oControl === this.byId("designPage") ||
          this._isDesignApp(oControl)
        ) {
          return;
        }
        var oInfo = this._findAggregationInfo(oControl);
        if (!oInfo) {
          return;
        }
        var iNewIndex = oInfo.index + iDirection;
        if (iNewIndex < 0 || iNewIndex >= oInfo.length) {
          return;
        }
        oInfo.parent.removeAggregation(oInfo.aggregation, oControl);
        oInfo.parent.insertAggregation(oInfo.aggregation, oControl, iNewIndex);
        this._afterCanvasChange();
      },

      // Copy the control to the editor clipboard. A snapshot clone is stored so
      // that later edits to - or deletion of - the original do not change what
      // gets pasted. Pasting is then offered from the context menu separately.
      // Deep-copy the binding metadata (data bindings + event handlers) from
      // oSource onto oClone. clone() copies properties and aggregations but not
      // custom transient fields like _bindingMeta, so we handle it explicitly.
      _copyBindingMeta: function (oSource, oClone) {
        if (!oSource || !oClone) {
          return;
        }
        var that = this;
        if (oSource._bindingMeta) {
          oClone._bindingMeta = jQuery.extend(true, {}, oSource._bindingMeta);
          this._syncAllBindingDisplays(oClone);
        }
        // Recurse into aggregations: clone() deep-copies children in order,
        // but the custom _bindingMeta field dies on nested children (e.g. a
        // bound Text inside a copied HBox, bound cells inside a Table).
        var oAggs = oSource.getMetadata().getAllAggregations();
        Object.keys(oAggs).forEach(function (sName) {
          if (sName.charAt(0) === "_") {
            return;
          }
          var vSrc = oSource.getAggregation(sName);
          var vCl = oClone.getAggregation(sName);
          if (!vSrc || !vCl) {
            return;
          }
          var aSrc = Array.isArray(vSrc) ? vSrc : [vSrc];
          var aCl = Array.isArray(vCl) ? vCl : [vCl];
          aSrc.forEach(function (oChild, i) {
            if (
              aCl[i] &&
              oChild &&
              oChild.isA &&
              oChild.isA("sap.ui.core.Element")
            ) {
              that._copyBindingMeta(oChild, aCl[i]);
            }
          });
        });
      },

      // clone() also copies live model binding infos; drop them so the
      // snapshot shows plain values (data bindings live in _bindingMeta).
      _stripLiveBindings: function (oClone) {
        Object.keys(oClone.mBindingInfos || {}).forEach(function (sName) {
          var oInfo = oClone.mBindingInfos[sName];
          if (oInfo.kind === "property") {
            oClone.unbindProperty(sName);
          } else if (oInfo.kind === "aggregation") {
            oClone.unbindAggregation(sName);
          } else {
            oClone.unbindObject(sName);
          }
        });
      },

      _copyControl: function (oControl) {
        // Dispose any previous clipboard snapshot
        if (
          this._oClipboard &&
          this._oClipboard.control &&
          !this._oClipboard.control.bIsDestroyed
        ) {
          this._oClipboard.control.destroy();
        }
        var oClone = oControl.clone();
        this._stripLiveBindings(oClone);
        // clone() copies style classes - strip the transient selection highlight.
        // Non-rendering Elements (e.g. FormElement) have no removeStyleClass.
        if (oClone.removeStyleClass) {
          oClone.removeStyleClass("controlSelected");
        }
        this._copyBindingMeta(oControl, oClone);
        this._oClipboard = {
          control: oClone,
          sourceId: oControl.getId(),
          parentId: oControl.getParent() ? oControl.getParent().getId() : null,
        };
        MessageToast.show(this._i18n("toast.controlCopied"));
      },

      // Return the multiple aggregation of oContainer that should receive oControl
      // when pasting into it, or null when the container cannot hold the control.
      // Prefers the container's main content aggregation and never uses "dependents"
      // (which holds non-rendered helper controls).
      _getAcceptingAggregation: function (oContainer, oControl) {
        if (!oContainer || !oControl) {
          return null;
        }
        var oAggregations = oContainer.getMetadata().getAllAggregations();

        var fnAccepts = function (sName) {
          var oAgg = oAggregations[sName];
          if (!oAgg || !oAgg.multiple || sName === "dependents") {
            return false;
          }
          var sAggType = oAgg.type || "sap.ui.core.Element";
          return oControl.isA(sAggType);
        };

        // Prefer the container's main content aggregation
        var aPreferred = ["content", "items", "children", "controls", "pages"];
        for (var i = 0; i < aPreferred.length; i++) {
          if (fnAccepts(aPreferred[i])) {
            return aPreferred[i];
          }
        }
        // Fall back to the first accepting multiple aggregation
        for (var sName in oAggregations) {
          if (fnAccepts(sName)) {
            return sName;
          }
        }
        return null;
      },

      // Palette of control types offered by the "추가" (add) context menu.
      _getControlPalette: function () {
        return [
          { name: "Button", type: "sap.m.Button" },
          { name: "Text", type: "sap.m.Text" },
          { name: "Input", type: "sap.m.Input" },
          { name: "Label", type: "sap.m.Label" },
          { name: "CheckBox", type: "sap.m.CheckBox" },
          { name: "Title", type: "sap.m.Title" },
          { name: "Link", type: "sap.m.Link" },
          { name: "Image", type: "sap.m.Image" },
          { name: "HBox", type: "sap.m.HBox" },
          { name: "VBox", type: "sap.m.VBox" },
          { name: "Panel", type: "sap.m.Panel" },
          { name: "ToolbarSpacer", type: "sap.m.ToolbarSpacer" },
        ];
      },

      // Metadata-based aggregation detection for "add". Returns the multiple
      // aggregation of oContainer that can receive a control of class sChildType,
      // or null when none fits. Uses the child class's inheritance chain instead
      // of instantiating a control. Prefers main content aggregations and skips
      // "dependents" and private (underscore) aggregations.
      _getAddAggregation: function (oContainer, sChildType) {
        if (!oContainer || !sChildType) {
          return null;
        }
        var fnClass = jQuery.sap.getObject(sChildType);
        if (!fnClass) {
          // Class may not be loaded yet (lazy load). Try a synchronous require
          // so that metadata-based aggregation matching works for all palette
          // types (e.g. sap.m.ToolbarSpacer, which isn't loaded until first used).
          try {
            jQuery.sap.require(sChildType);
            fnClass = jQuery.sap.getObject(sChildType);
          } catch (e) {
            return null;
          }
        }
        if (!fnClass || typeof fnClass.getMetadata !== "function") {
          return null;
        }
        var oChildMeta = fnClass.getMetadata();
        var oAggregations = oContainer.getMetadata().getAllAggregations();

        var fnAccepts = function (sName) {
          var oAgg = oAggregations[sName];
          if (
            !oAgg ||
            !oAgg.multiple ||
            sName === "dependents" ||
            sName.charAt(0) === "_"
          ) {
            return false;
          }
          var sAggType = oAgg.type || "sap.ui.core.Element";
          // Walk the child's inheritance chain to see if it satisfies the agg type
          var oMeta = oChildMeta;
          while (oMeta) {
            if (oMeta.getName() === sAggType) {
              return true;
            }
            oMeta = oMeta.getParent();
          }
          return false;
        };

        var aPreferred = ["content", "items", "children", "controls", "pages"];
        for (var i = 0; i < aPreferred.length; i++) {
          if (fnAccepts(aPreferred[i])) {
            return aPreferred[i];
          }
        }
        for (var sName in oAggregations) {
          if (fnAccepts(sName)) {
            return sName;
          }
        }
        return null;
      },

      // Create a new control of the given palette type and append it to the
      // target's accepting aggregation.
      _addControlToTarget: function (oTarget, sName, sType) {
        var sAggregation = this._getAddAggregation(oTarget, sType);
        if (!sAggregation) {
          return;
        }
        var oModel = this.getOwnerComponent().getModel("appModel");
        var iCount = (oModel.getProperty("/controlCount") || 0) + 1;
        oModel.setProperty("/controlCount", iCount);
        var oControl = this._createControl(sName, sType, iCount);
        if (!oControl) {
          return;
        }
        this._attachSelectionHandler(oControl);
        this._attachSelectionToAll(oControl);
        oTarget.addAggregation(sAggregation, oControl);
        this._selectControl(oControl);
        this._afterCanvasChange();
        MessageToast.show(this._i18n("toast.controlAdded", [sName]));
      },

      // Return the name of the target's primary (main content) multiple aggregation
      // - used as the default selection in the "Add Control" dialog.
      _getPrimaryAggregationName: function (oTarget) {
        if (!oTarget) {
          return null;
        }
        var oAggregations = oTarget.getMetadata().getAllAggregations();
        var aPreferred = ["content", "items", "children", "controls", "pages"];
        for (var i = 0; i < aPreferred.length; i++) {
          var oAgg = oAggregations[aPreferred[i]];
          if (oAgg && oAgg.multiple) {
            return aPreferred[i];
          }
        }
        var oTechExclude = {
          customData: true,
          layoutData: true,
          tooltip: true,
          dependents: true,
          dragDropConfig: true,
        };
        var sFirstSingle = null;
        for (var sName in oAggregations) {
          var oA = oAggregations[sName];
          if (!oTechExclude[sName] && sName.charAt(0) !== "_") {
            if (oA.multiple) {
              return sName;
            }
            if (!sFirstSingle) {
              sFirstSingle = sName;
            }
          }
        }
        // No multiple aggregation - fall back to the first single-cardinality
        // aggregation so "add" stays available (e.g. sap.m.Column in UI5 1.150
        // has only header/footer, both 0..1; adding replaces the existing child).
        return sFirstSingle;
      },

      // Return all usable aggregations of oTarget (non-technical, sorted with
      // preferred content aggregations first). Includes aggregations from the
      // target's class and all semantic parent classes (e.g. sap.m.ListBase for
      // sap.m.Table), but excludes technical aggregations inherited from
      // sap.ui.core.Control, sap.ui.core.Element, and sap.ui.base.ManagedObject.
      _getUsableAggregations: function (oTarget) {
        if (!oTarget) {
          return [];
        }
        var oAggs = oTarget.getMetadata().getAllAggregations();

        // Collect technical aggregation names from base classes to exclude
        var oTechAggs = {};
        [
          "sap.ui.base.ManagedObject",
          "sap.ui.core.Element",
          "sap.ui.core.Control",
        ].forEach(function (sClass) {
          var fnClass = jQuery.sap.getObject(sClass);
          if (fnClass && fnClass.getMetadata) {
            var oBaseAggs = fnClass.getMetadata().getAggregations();
            Object.keys(oBaseAggs).forEach(function (sName) {
              oTechAggs[sName] = true;
            });
          }
        });
        var aResult = [];
        var aSeen = {};
        var aPreferred = ["content", "items", "children", "controls", "pages"];
        aPreferred.forEach(function (sName) {
          var oAgg = oAggs[sName];
          if (oAgg && !oTechAggs[sName]) {
            aResult.push({
              name: sName,
              type: oAgg.type || "sap.ui.core.Element",
              multiple: !!oAgg.multiple,
            });
            aSeen[sName] = true;
          }
        });
        Object.keys(oAggs)
          .sort()
          .forEach(function (sName) {
            if (aSeen[sName]) {
              return;
            }
            var oAgg = oAggs[sName];
            if (
              sName === "customData" ||
              sName === "layoutData" ||
              sName === "tooltip" ||
              sName === "dependents" ||
              sName === "dragDropConfig" ||
              sName.charAt(0) === "_" ||
              oTechAggs[sName]
            ) {
              return;
            }
            aResult.push({
              name: sName,
              type: oAgg.type || "sap.ui.core.Element",
              multiple: !!oAgg.multiple,
            });
          });
        return aResult;
      },

      // Check whether sChildType can be added to oTarget's specific aggregation
      // sAggName. Checks both the inheritance chain and implemented interfaces
      // (e.g. sap.m.IBar for subHeader/footer/customHeader).
      //
      // Performance: results are cached by (aggregationType, childType) because
      // this is called for every catalog entry when opening the dialog. We do NOT
      // call jQuery.sap.require here - synchronous module loading for 400+ entries
      // blocks the UI for many seconds. Only already-loaded classes are matched;
      // unloaded classes are triggered by the background loader in the dialog.
      _fitsCache: null,
      _controlFitsAggregation: function (oTarget, sAggName, sChildType) {
        var oAgg = oTarget.getMetadata().getAllAggregations()[sAggName];
        if (!oAgg) {
          return false;
        }
        var sAggType = oAgg.type || "sap.ui.core.Element";

        if (!this._fitsCache) {
          this._fitsCache = {};
        }
        var sCacheKey = sAggType + "|" + sChildType;
        if (sCacheKey in this._fitsCache) {
          return this._fitsCache[sCacheKey];
        }

        var fnClass = jQuery.sap.getObject(sChildType);
        if (!fnClass || typeof fnClass.getMetadata !== "function") {
          // Class not loaded yet - treat as not matching (background loader will
          // refresh the list once it is available).
          this._fitsCache[sCacheKey] = false;
          return false;
        }
        // Check inheritance chain
        var oMeta = fnClass.getMetadata();
        while (oMeta) {
          if (oMeta.getName() === sAggType) {
            this._fitsCache[sCacheKey] = true;
            return true;
          }
          oMeta = oMeta.getParent();
        }
        // Check implemented interfaces (e.g. sap.m.IBar)
        var aInterfaces = fnClass.getMetadata().getInterfaces();
        var bResult = !!(aInterfaces && aInterfaces.indexOf(sAggType) > -1);
        this._fitsCache[sCacheKey] = bResult;
        return bResult;
      },

      // Declared type of the target's primary aggregation (for deciding whether the
      // container is generic or type-specific).
      _getTargetAggregationType: function (oTarget) {
        var sName = this._getPrimaryAggregationName(oTarget);
        if (!sName) {
          return null;
        }
        var oAgg = oTarget.getMetadata().getAllAggregations()[sName];
        return oAgg.type || "sap.ui.core.Element";
      },

      // Flatten the category-grouped control catalog into a single array.
      _flattenCatalog: function () {
        var aResult = [];
        if (!this._controlCatalog) {
          return aResult;
        }
        Object.keys(this._controlCatalog).forEach(
          function (sCategory) {
            this._controlCatalog[sCategory].forEach(function (oEntry) {
              aResult.push(oEntry);
            });
          }.bind(this),
        );
        return aResult;
      },

      // Build the candidate list for the "Add Control" dialog for a specific
      // aggregation. Generic aggregations (sap.ui.core.Control/Element) default to
      // the frequently used palette; type-specific aggregations show only catalog
      // entries that match via _controlFitsAggregation.
      _getAddDialogCandidates: function (oTarget, sAggName, sQuery) {
        var that = this;
        var oAgg = oTarget.getMetadata().getAllAggregations()[sAggName];
        if (!oAgg) {
          return [];
        }
        var sAggType = oAgg.type || "sap.ui.core.Element";
        var bGeneric =
          sAggType === "sap.ui.core.Control" ||
          sAggType === "sap.ui.core.Element";
        var sQueryLower = (sQuery || "").toLowerCase();

        var fnMatches = function (oEntry) {
          if (bGeneric) {
            return true;
          }
          return that._controlFitsAggregation(oTarget, sAggName, oEntry.type);
        };

        var aPool;
        if (bGeneric && !sQueryLower) {
          // Frequently used palette for generic aggregations (default view)
          aPool = this._getControlPalette()
            .filter(fnMatches)
            .map(function (oEntry) {
              return {
                name: oEntry.name,
                type: oEntry.type,
                icon: that._getIconForType(oEntry.type),
              };
            });
        } else {
          // Full catalog filtered by aggregation compatibility
          aPool = this._flattenCatalog()
            .filter(fnMatches)
            .map(function (oEntry) {
              return {
                name: oEntry.name,
                type: oEntry.type,
                icon: oEntry.icon,
              };
            });
        }

        if (sQueryLower) {
          aPool = aPool.filter(function (oEntry) {
            return (
              oEntry.name.toLowerCase().indexOf(sQueryLower) > -1 ||
              oEntry.type.toLowerCase().indexOf(sQueryLower) > -1
            );
          });
        }
        return aPool;
      },

      // Add a control to a specific aggregation of the target.
      // For single-cardinality aggregations (0..1), replaces the existing child.
      _addControlToAggregation: function (oTarget, sAggName, sName, sType) {
        if (!this._controlFitsAggregation(oTarget, sAggName, sType)) {
          MessageToast.show(
            this._i18n("toast.cannotAddToAgg", [sName, sAggName]),
          );
          return;
        }
        // For single aggregations, replace existing child
        var oAgg = oTarget.getMetadata().getAllAggregations()[sAggName];
        if (oAgg && !oAgg.multiple) {
          oTarget.destroyAggregation(sAggName);
        }
        var oModel = this.getOwnerComponent().getModel("appModel");
        var iCount = (oModel.getProperty("/controlCount") || 0) + 1;
        oModel.setProperty("/controlCount", iCount);
        var oControl = this._createControl(sName, sType, iCount);
        if (!oControl) {
          return;
        }
        this._attachSelectionHandler(oControl);
        this._attachSelectionToAll(oControl);
        // Use setAggregation for 0..1 (replaces existing), addAggregation for 0..n
        if (oAgg && !oAgg.multiple) {
          oTarget.setAggregation(sAggName, oControl);
        } else {
          oTarget.addAggregation(sAggName, oControl);
        }
        this._selectControl(oControl);
        this._afterCanvasChange();
        MessageToast.show(
          this._i18n("toast.addedToAgg", [sName, sAggName]),
        );
      },

      // Open the searchable "Add Control to: <aggregation>" dialog for the target,
      // with a dropdown to select among all usable aggregations. sAggName (optional)
      // preselects the aggregation - used by outline aggregation-node context menus.
      _openAddControlDialog: function (oTarget, sAggName) {
        var that = this;
        var aAggregations = this._getUsableAggregations(oTarget);
        if (aAggregations.length === 0) {
          MessageToast.show(this._i18n("toast.cannotAddHere"));
          return;
        }

        // Default to the requested aggregation (aggregation-node mode), otherwise
        // the primary aggregation or the first usable one
        var sCurrentAgg = sAggName;
        if (
          !sCurrentAgg ||
          !aAggregations.some(function (oAgg) {
            return oAgg.name === sAggName;
          })
        ) {
          sCurrentAgg =
            this._getPrimaryAggregationName(oTarget) || aAggregations[0].name;
        }

        // Recreate the dialog each time
        if (this._oAddDialog && !this._oAddDialog.bIsDestroyed) {
          this._oAddDialog.destroy();
        }

        // Aggregation selector dropdown
        var oSelect = new sap.m.Select({ width: "100%" });
        aAggregations.forEach(function (oAgg) {
          var sLabel =
            oAgg.name + (oAgg.multiple ? "" : "  (0..1)") + "  —  " + oAgg.type;
          oSelect.addItem(
            new sap.ui.core.Item({ key: oAgg.name, text: sLabel }),
          );
        });
        oSelect.setSelectedKey(sCurrentAgg);
        oSelect.addStyleClass("sapUiSmallMarginBottom");

        var oModel = new JSONModel({
          items: this._getAddDialogCandidates(oTarget, sCurrentAgg, ""),
        });

        // Item template
        var oIcon = new sap.ui.core.Icon({ src: "{icon}", size: "0.95rem" });
        oIcon.addStyleClass("addCtrlIcon");
        var oName = new sap.m.Text({ text: "{name}", wrapping: false });
        oName.addStyleClass("addCtrlName");
        var oType = new sap.m.Text({ text: "{type}", wrapping: false });
        oType.addStyleClass("addCtrlType");
        var oRow = new sap.m.HBox({
          alignItems: "Center",
          items: [oIcon, oName, oType],
        });
        oRow.addStyleClass("addCtrlRow");

        var oList = new sap.m.List({ noDataText: this._i18n("search.noResults") });
        oList.addStyleClass("addCtrlList");
        oList.setModel(oModel);
        oList.bindAggregation("items", {
          path: "/items",
          template: new sap.m.CustomListItem({
            type: "Active",
            content: oRow,
          }),
        });
        oList.attachItemPress(function (oEvent) {
          var oContext = oEvent.getParameter("listItem").getBindingContext();
          var sName = oContext.getProperty("name");
          var sType = oContext.getProperty("type");
          that._oAddDialog.close();
          that._addControlToAggregation(oTarget, sCurrentAgg, sName, sType);
        });

        var oSearchField = new sap.m.SearchField({
          placeholder: this._i18n("search.controlPlaceholder"),
          width: "100%",
          liveChange: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            oModel.setProperty(
              "/items",
              that._getAddDialogCandidates(oTarget, sCurrentAgg, sQuery),
            );
          },
        });

        // Refresh list when aggregation changes
        var fnRefreshList = function () {
          oSearchField.setValue("");
          oModel.setProperty(
            "/items",
            that._getAddDialogCandidates(oTarget, sCurrentAgg, ""),
          );
          that._oAddDialog.setTitle("Add Control to: " + sCurrentAgg);
        };
        oSelect.attachChange(function (oEvent) {
          sCurrentAgg = oEvent.getParameter("selectedItem").getKey();
          fnRefreshList();
        });

        var oContent = new sap.m.VBox({
          items: [oSelect, oSearchField, oList],
        });
        oContent.addStyleClass("sapUiSmallMargin");

        this._oAddDialog = new sap.m.Dialog({
          title: "Add Control to: " + sCurrentAgg,
          contentWidth: "440px",
          contentHeight: "500px",
          content: [oContent],
          endButton: new sap.m.Button({
            text: this._i18n("button.close"),
            press: function () {
              that._oAddDialog.close();
            },
          }),
        });
        this._oAddDialog.addStyleClass("addCtrlDialog");

        this._oAddDialog.open();

        // Background-load catalog classes that are not loaded yet, so the list
        // can show the full set of usable controls without blocking the initial
        // open. Only classes already in memory are matched synchronously above;
        // once the rest finish loading we refresh the visible list.
        setTimeout(function () {
          var aUnloaded = [];
          var aEntries = that._flattenCatalog();
          for (var i = 0; i < aEntries.length; i++) {
            if (!jQuery.sap.getObject(aEntries[i].type)) {
              aUnloaded.push(aEntries[i].type.replace(/\./g, "/"));
            }
          }
          if (aUnloaded.length === 0 || typeof sap.ui.require !== "function") {
            return;
          }
          try {
            sap.ui.require(aUnloaded, function () {
              that._fitsCache = null;
              if (that._oAddDialog && that._oAddDialog.isOpen()) {
                var sQuery = oSearchField.getValue();
                oModel.setProperty(
                  "/items",
                  that._getAddDialogCandidates(oTarget, sCurrentAgg, sQuery),
                );
              }
            });
          } catch (e) {
            // Ignore - dialog still works with the initially loaded classes
          }
        }, 0);
      },

      // Whether the copy can be inserted as a sibling of oTarget, i.e. whether the
      // parent aggregation that holds oTarget also accepts the copied control's
      // type. This is what enables "Before"/"After" not just for same-level siblings
      // but also for the parent's siblings and grandparents - anywhere the copy can
      // legally sit next to the target.
      _canInsertAsSibling: function (oTarget, oCopy) {
        var oParent = oTarget.getParent();
        if (!oParent) {
          return false;
        }
        var oAggregations = oParent.getMetadata().getAllAggregations();
        for (var sName in oAggregations) {
          if (!oAggregations[sName].multiple) {
            continue;
          }
          if (oParent.indexOfAggregation(sName, oTarget) === -1) {
            continue;
          }
          var sAggType = oAggregations[sName].type || "sap.ui.core.Element";
          return oCopy.isA(sAggType);
        }
        return false;
      },

      // Whether oTarget is a descendant of the control identified by sAncestorId.
      // Pasting a container into its own children would create a recursive structure,
      // so this check is used to suppress paste on the copy source's descendants.
      _isDescendantOf: function (oTarget, sAncestorId) {
        if (!sAncestorId) {
          return false;
        }
        var oAncestor = sap.ui.getCore().byId(sAncestorId);
        if (!oAncestor) {
          return false;
        }
        var oParent = oTarget.getParent();
        while (oParent) {
          if (oParent === oAncestor) {
            return true;
          }
          oParent = oParent.getParent();
        }
        return false;
      },

      // Compute the paste operations available for the given target control.
      // Returns null when the clipboard is empty. "Paste" appends into the target
      // when it is a container that accepts the copied control, otherwise inserts
      // right after the target. "Before"/"After" insert the copy as a sibling of the
      // target, so they are offered wherever the target's parent aggregation accepts
      // the copy - same level, the parent's siblings, grandparents, etc. They are
      // only suppressed on the copy's own parent (where "paste" appends into it) and
      // on any descendant of the copy source (to prevent recursive nesting).
      _getPasteInfo: function (oTarget) {
        var oClip = this._oClipboard;
        if (!oClip || !oClip.control || oClip.control.bIsDestroyed) {
          return null;
        }
        var oCopy = oClip.control;
        var bIsSelf = oTarget.getId() === oClip.sourceId;
        var bIsParentOfCopy =
          !!oClip.parentId && oTarget.getId() === oClip.parentId;
        var bIsDescendantOfSource =
          !bIsSelf && this._isDescendantOf(oTarget, oClip.sourceId);
        var sIntoAggregation = this._getAcceptingAggregation(oTarget, oCopy);
        var oTargetAggInfo = this._findAggregationInfo(oTarget);
        return {
          copy: oCopy,
          isSelf: bIsSelf,
          canPaste:
            !bIsDescendantOfSource && (!!sIntoAggregation || !!oTargetAggInfo),
          canBeforeAfter:
            !bIsDescendantOfSource &&
            !bIsParentOfCopy &&
            this._canInsertAsSibling(oTarget, oCopy),
          intoAggregation: sIntoAggregation,
          targetAggInfo: oTargetAggInfo,
        };
      },

      // Paste the clipboard control relative to the target. sPosition is "before",
      // "after" or omitted (default: append as the last child of the target when it
      // is a container that accepts the copy, otherwise insert right after it).
      // When the target is the designPage, the designCanvas, or any ancestor of
      // the canvas, the paste is redirected into the designPage so the result
      // remains visible in the outline and on the canvas.
      _pasteControl: function (oTarget, sPosition) {
        var oInfo = this._getPasteInfo(oTarget);
        if (!oInfo || !oInfo.canPaste) {
          return;
        }
        var oClone = oInfo.copy.clone();
        this._stripLiveBindings(oClone);
        // Non-rendering Elements (e.g. FormElement) have no removeStyleClass
        if (oClone.removeStyleClass) {
          oClone.removeStyleClass("controlSelected");
        }
        this._copyBindingMeta(oInfo.copy, oClone);

        // Redirect pastes on the designPage, designCanvas, or their ancestors
        // into the designPage itself
        var oPage = this.byId("designPage");
        var oCanvas = this.byId("designCanvas");
        var bIsCanvasOrAncestor = oTarget === oCanvas || oTarget === oPage;
        if (!bIsCanvasOrAncestor) {
          var oCheck = oCanvas.getParent();
          while (oCheck) {
            if (oCheck === oTarget) {
              bIsCanvasOrAncestor = true;
              break;
            }
            oCheck = oCheck.getParent();
          }
        }
        if (bIsCanvasOrAncestor) {
          var sPageAgg = this._getAcceptingAggregation(oPage, oClone);
          if (sPageAgg) {
            if (sPosition === "before") {
              oPage.insertAggregation(sPageAgg, oClone, 0);
            } else {
              oPage.addAggregation(sPageAgg, oClone);
            }
          } else {
            oClone.destroy();
            return;
          }
        } else if (!sPosition && oInfo.intoAggregation) {
          // Append as the last child of the target container
          oTarget.addAggregation(oInfo.intoAggregation, oClone);
        } else if (oInfo.targetAggInfo) {
          // Insert as a sibling of the target
          var iIndex =
            oInfo.targetAggInfo.index + (sPosition === "before" ? 0 : 1);
          oInfo.targetAggInfo.parent.insertAggregation(
            oInfo.targetAggInfo.aggregation,
            oClone,
            iIndex,
          );
        } else {
          oClone.destroy();
          return;
        }

        this._attachSelectionHandler(oClone);
        this._attachSelectionToAll(oClone);
        this._afterCanvasChange();
        MessageToast.show(this._i18n("toast.pasted"));
      },

      // Delete the given control from the canvas and reset the selection
      _deleteControl: function (oControl) {
        // Protect the canvas root, design page and App root from deletion
        if (
          oControl === this.byId("designCanvas") ||
          oControl === this.byId("designPage") ||
          this._isDesignApp(oControl)
        ) {
          return;
        }
        var oInfo = this._findAggregationInfo(oControl);
        if (oInfo) {
          oInfo.parent.removeAggregation(oInfo.aggregation, oControl);
        }
        oControl.destroy();

        var oModel = this.getOwnerComponent().getModel("appModel");
        oModel.setProperty("/selectedControl", { type: "", id: "" });
        this._sSelectedControlId = null;
        this.byId("noSelection").setVisible(true);
        this.byId("propertiesContent").setVisible(false);

        var iCount = oModel.getProperty("/controlCount") || 0;
        if (iCount > 0) {
          oModel.setProperty("/controlCount", iCount - 1);
        }
        this._afterCanvasChange();
        MessageToast.show(this._i18n("toast.deleted"));
      },

      // Refresh XML + outline after any structural canvas change
      _afterCanvasChange: function () {
        this._updateXmlFromCanvas();
        this._refreshOutline();
      },

      // Framework-internal classes (focus states such as sapMFocus /
      // sapMInputFocused, plus the editor selection highlight) are never
      // user assignments - hide them from the panel, tree and XML.
      _isUserStyleClass: function (sCls) {
        if (!sCls || sCls === "controlSelected") {
          return false;
        }
        return !/^sap(M|Ui|F|T|Ushell)/i.test(sCls);
      },

      // Read the user-assigned CSS classes of a control.
      // getCustomStyleClasses() was removed in newer UI5 versions (1.150),
      // so fall back to the internal array kept by addStyleClass().
      // Only user classes are returned (see _isUserStyleClass).
      _styleClassesOf: function (oControl) {
        if (!oControl) {
          return [];
        }
        var aAll =
          typeof oControl.getCustomStyleClasses === "function"
            ? oControl.getCustomStyleClasses()
            : (oControl.aCustomStyleClasses || []).slice();
        return aAll.filter(this._isUserStyleClass);
      },

      // Build properties panel dynamically using getMetadata()
      _buildPropertiesPanel: function (oControl) {
        var oPropsContainer = this.byId("dynamicProperties");
        var oEventsContainer = this.byId("dynamicEvents");

        // Clear existing editors
        oPropsContainer.removeAllItems();
        oEventsContainer.removeAllItems();

        var oMetadata = oControl.getMetadata();

        // Use getAllProperties() to include inherited properties
        var oProperties = oMetadata.getAllProperties();

        // Add ID field first (special, read-only)
        oPropsContainer.addItem(
          this._createPropertyEditor(
            "id",
            { type: "string" },
            oControl.getId(),
            oControl,
            true,
          ),
        );

        // Pin the control's primary property right below the id field, like
        // SAP BAS does (text for Text/Button/Title/Label, value for Input,
        // title for Page/Panel/Form).
        var oPrimaryProps = {
          "sap.m.Text": "text",
          "sap.m.Button": "text",
          "sap.m.Title": "text",
          "sap.m.Label": "text",
          "sap.m.Link": "text",
          "sap.m.Input": "value",
          "sap.m.TextArea": "value",
          "sap.m.Page": "title",
          "sap.m.Panel": "title",
          "sap.ui.layout.form.Form": "title",
          "sap.ui.layout.form.FormContainer": "title",
        };
        var sPrimaryProp = oPrimaryProps[oMetadata.getName()];
        if (!sPrimaryProp && oProperties.text) {
          sPrimaryProp = "text";
        } else if (!sPrimaryProp && oProperties.value) {
          sPrimaryProp = "value";
        } else if (!sPrimaryProp && oProperties.title) {
          sPrimaryProp = "title";
        }
        if (sPrimaryProp && oProperties[sPrimaryProp]) {
          oPropsContainer.addItem(
            this._createPropertyEditor(
              sPrimaryProp,
              oProperties[sPrimaryProp],
              oControl.getProperty(sPrimaryProp),
              oControl,
              false,
            ),
          );
        }

        // CSS class editor (special: "class" is not a metadata property,
        // it is applied via addStyleClass on sap.ui.core.Control). Built here
        // but appended at the very end of the panel (right above the delete
        // button).
        var oClassBox = null;
        if (oControl.isA && oControl.isA("sap.ui.core.Control")) {
          var aUserClasses = this._styleClassesOf(oControl).filter(
            function (sCls) {
              return sCls !== "controlSelected";
            },
          );
          oClassBox = new sap.m.VBox();
          oClassBox.addStyleClass("sapUiTinyMarginTop");
          oClassBox.addItem(new sap.m.Label({ text: "class" }));
          oClassBox.addItem(
            new sap.m.Input({
              value: aUserClasses.join(" "),
              width: "100%",
              change: function (oEvent) {
                this._applyStyleClasses(
                  oControl,
                  oEvent.getParameter("value"),
                );
              }.bind(this),
            }),
          );
        }

        // Add all properties from metadata
        Object.keys(oProperties).forEach(
          function (sPropName) {
            // Already pinned directly under the id field
            if (sPropName === sPrimaryProp) {
              return;
            }
            var oPropDef = oProperties[sPropName];
            var vCurrentValue = oControl.getProperty(sPropName);
            oPropsContainer.addItem(
              this._createPropertyEditor(
                sPropName,
                oPropDef,
                vCurrentValue,
                oControl,
                false,
              ),
            );
          }.bind(this),
        );

        // class editor goes last in the properties panel
        if (oClassBox) {
          oPropsContainer.addItem(oClassBox);
        }

        // Add all events from metadata, excluding:
        // 1. Events inherited from sap.ui.base.ManagedObject
        // 2. Deprecated events
        var oEvents = oMetadata.getAllEvents();

        // Collect event names from sap.ui.base.ManagedObject to exclude
        var oManagedEvents = {};
        var fnManagedObject = jQuery.sap.getObject("sap.ui.base.ManagedObject");
        if (fnManagedObject && fnManagedObject.getMetadata) {
          var oManagedEventDefs = fnManagedObject.getMetadata().getEvents();
          Object.keys(oManagedEventDefs).forEach(function (sName) {
            oManagedEvents[sName] = true;
          });
        }

        Object.keys(oEvents).forEach(
          function (sEventName) {
            var oEventDef = oEvents[sEventName];
            // Skip deprecated events
            if (
              oEventDef.deprecated ||
              (oEventDef.appData && oEventDef.appData.deprecated)
            ) {
              return;
            }
            // Skip events from sap.ui.base.ManagedObject
            if (oManagedEvents[sEventName]) {
              return;
            }

            // Show any previously saved handler for this event.
            // The saved value is either a plain handler name (string) or an
            // SE24 method mapping object { method, params }.
            var vSaved =
              (oControl._bindingMeta &&
                oControl._bindingMeta.events &&
                oControl._bindingMeta.events[sEventName]) ||
              "";
            var sSavedHandler =
              typeof vSaved === "object" && vSaved !== null
                ? vSaved.method
                : vSaved;
            var oInput = new sap.m.Input({
              value: sSavedHandler,
              placeholder: "handler function name",
              change: function (oEvent) {
                var sValue = (oEvent.getParameter("value") || "").trim();
                if (!oControl._bindingMeta) {
                  oControl._bindingMeta = { props: {}, events: {} };
                }
                if (sValue) {
                  // Manual entry replaces any SE24 method mapping
                  oControl._bindingMeta.events[sEventName] = sValue;
                } else {
                  delete oControl._bindingMeta.events[sEventName];
                }
                this._afterCanvasChange();
              }.bind(this),
            });
            oInput.setLayoutData(new sap.m.FlexItemData({ growFactor: 1 }));
            var oEventRow = new sap.m.HBox({
              alignItems: "Center",
              items: [
                oInput,
                new sap.m.Button({
                  icon: "sap-icon://search",
                  type: "Transparent",
                  tooltip: this._i18n("se24.tooltip.selectMethod"),
                  press: function () {
                    this._openMethodSelectDialog(oControl, sEventName);
                  }.bind(this),
                }),
              ],
            });
            var aEventItems = [new sap.m.Label({ text: sEventName }), oEventRow];
            if (typeof vSaved === "object" && vSaved !== null) {
              var iParamCount = Object.keys(vSaved.params || {}).length;
              aEventItems.push(
                new sap.m.Text({
                  text:
                    "SE24 method" +
                    (iParamCount > 0
                      ? " " + this._i18n("se24.tooltip.paramsMapped", [iParamCount])
                      : ""),
                }).addStyleClass("boundPropHint"),
              );
            }
            var oVBox = new sap.m.VBox({
              items: aEventItems,
            });
            oVBox.addStyleClass("sapUiTinyMarginTop");
            oEventsContainer.addItem(oVBox);
          }.bind(this),
        );
      },

      // Resolve an enum type object from its fully qualified name (e.g. "sap.m.ButtonType").
      // Returns the enum object (plain key->value map), or null if the type is not an enum.
      _resolveEnumType: function (sTypeName) {
        if (!sTypeName || sTypeName.indexOf(".") === -1) {
          return null; // primitive types (string, int, boolean, ...) are not enums
        }
        var aParts = sTypeName.split(".");
        var oCurrent = window;
        for (var i = 0; i < aParts.length; i++) {
          oCurrent = oCurrent[aParts[i]];
          if (oCurrent === undefined || oCurrent === null) {
            return null; // not resolvable at runtime -> not an enum (e.g. sap.ui.core.CSSSize)
          }
        }
        // Enums are plain objects (key->value maps); classes/constructors are functions
        if (typeof oCurrent !== "object" || Array.isArray(oCurrent)) {
          return null;
        }
        // Enum: every own enumerable property is a primitive value (string/number).
        // DataType objects (e.g. sap.ui.core.CSSSize) expose functions -> not enums.
        var aKeys = Object.keys(oCurrent);
        if (aKeys.length === 0) {
          return null;
        }
        var bIsEnum = aKeys.every(function (sKey) {
          var v = oCurrent[sKey];
          return typeof v === "string" || typeof v === "number";
        });
        return bIsEnum ? oCurrent : null;
      },

      // Create a single property editor based on property type
      _createPropertyEditor: function (
        sName,
        oDef,
        vValue,
        oControl,
        bReadOnly,
      ) {
        var sType = oDef.type || "string";
        var oEditor;
        var that = this;

        // Enum type -> render as Select dropdown populated with the enum values
        var oEnum = this._resolveEnumType(sType);
        if (oEnum) {
          oEditor = new sap.m.Select({
            width: "100%",
            selectedKey:
              vValue === null || vValue === undefined ? "" : String(vValue),
            enabled: !bReadOnly,
            change: function (oEvent) {
              var oSelected = oEvent.getParameter("selectedItem");
              that._applyProperty(
                oControl,
                sName,
                oSelected ? oSelected.getKey() : "",
              );
            },
          });
          Object.keys(oEnum).forEach(function (sKey) {
            var vEnumVal = oEnum[sKey];
            if (typeof vEnumVal === "string" || typeof vEnumVal === "number") {
              oEditor.addItem(
                new sap.ui.core.Item({
                  key: String(vEnumVal),
                  text: sKey,
                }),
              );
            }
          });
        } else if (sType === "boolean") {
          oEditor = new sap.m.Switch({
            state: !!vValue,
            enabled: !bReadOnly,
            change: function (oEvent) {
              var bState = oEvent.getParameter("state");
              that._applyProperty(oControl, sName, bState);
            },
          });
        } else if (sType === "int" || sType === "float") {
          oEditor = new sap.m.Input({
            value:
              vValue === null || vValue === undefined ? "" : String(vValue),
            type: "Number",
            editable: !bReadOnly,
            change: function (oEvent) {
              var sVal = oEvent.getParameter("value");
              var vNum =
                sType === "int" ? parseInt(sVal, 10) : parseFloat(sVal);
              if (!isNaN(vNum)) {
                that._applyProperty(oControl, sName, vNum);
              }
            },
          });
        } else {
          // string, CSSSize, object, any, etc.
          var bIsIconProp = /icon$/i.test(sName);
          var oInputSettings = {
            value:
              vValue === null || vValue === undefined ? "" : String(vValue),
            editable: !bReadOnly,
            change: function (oEvent) {
              var sVal = oEvent.getParameter("value");
              that._applyProperty(oControl, sName, sVal);
            },
          };
          if (bIsIconProp) {
            oInputSettings.showValueHelp = true;
            oInputSettings.valueHelpRequest = function () {
              that._openIconSelectDialog(oControl, sName);
            };
          }
          oEditor = new sap.m.Input(oInputSettings);
        }

        var oVBox = new sap.m.VBox();
        oVBox.addStyleClass("sapUiTinyMarginTop");
        oVBox.addItem(new sap.m.Label({ text: sName }));

        // Check whether this property already has a data binding expression
        var sBindingExpr =
          (oControl._bindingMeta &&
            oControl._bindingMeta.props &&
            oControl._bindingMeta.props[sName]) ||
          "";

        if (sBindingExpr && !bReadOnly) {
          // Property is data-bound: show the expression and a remove-binding button
          oVBox.addItem(
            new sap.m.HBox({
              alignItems: "Center",
              items: [
                that._createLiteralText(sBindingExpr, "boundPropExpr")
                  .setLayoutData(new sap.m.FlexItemData({ growFactor: 1 })),
                new sap.m.Button({
                  icon: "sap-icon://delete",
                  type: "Transparent",
                  tooltip: that._i18n("se24.tooltip.unbind"),
                  press: function () {
                    delete oControl._bindingMeta.props[sName];
                    // Fall back to the control id as the canvas display text
                    that._syncBindingDisplay(oControl, sName, oControl.getId());
                    that._afterCanvasChange();
                    that._selectControl(oControl);
                  },
                }),
              ],
            }),
          );
        } else {
          // Normal editor plus a bind button that opens the binding dialog
          oEditor.setLayoutData(new sap.m.FlexItemData({ growFactor: 1 }));
          var aRowItems = [oEditor];
          if (!bReadOnly) {
            aRowItems.push(
              new sap.m.Button({
                icon: "sap-icon://chain-link",
                type: "Transparent",
                tooltip: that._i18n("se24.tooltip.dataBinding"),
                press: function () {
                  that._openBindingDialog(oControl, sName);
                },
              }),
            );
          }
          oVBox.addItem(
            new sap.m.HBox({
              alignItems: "Center",
              items: aRowItems,
            }),
          );
        }

        return oVBox;
      },

      // Create a Text control that displays a binding expression literally. UI5 would
      // otherwise parse "{model>/path}" as a real data binding and render an empty
      // value, so we write the raw string directly into mProperties, bypassing
      // setText() which triggers binding parsing.
      _createLiteralText: function (sText, sClass) {
        var oText = new sap.m.Text();
        if (sClass) {
          oText.addStyleClass(sClass);
        }
        oText.mProperties["text"] = sText;
        return oText;
      },

      // SE24 class mapping - toolbar entry point. Opens a dialog to configure
      // the SE24 class whose public attributes back data bindings and whose
      // public methods back button actions.
      onPressSe24: function () {
        this._openSe24Dialog();
      },

      _openSe24Dialog: function () {
        var that = this;
        var oModel = this.getOwnerComponent().getModel("appModel");
        var oSe24 = oModel.getProperty("/se24") || {};

        // The class is mapped 1:1 at app creation time - once mapped it is
        // locked and can only be re-read, never changed here.
        var bLocked = !!oSe24.className;

        var oConfigModel = this.getOwnerComponent().getModel("config");
        var sDefaultEndpoint =
          (oConfigModel && oConfigModel.getProperty("/se24/endpoint")) || "";
        // SAP client (e.g. 800) - central setting, appended as sap-client
        var sSe24Client =
          (oConfigModel && oConfigModel.getProperty("/se24/client")) || "";

        var oClassInput = new sap.m.Input({
          value: oSe24.className || "",
          placeholder: "ZCL_LAYOUT_DEMO",
          width: "100%",
          editable: !bLocked,
        });
        var oEndpointInput = new sap.m.Input({
          value: oSe24.endpoint || sDefaultEndpoint,
          placeholder: this._i18n("se24.endpointPlaceholder"),
          width: "100%",
        });
        var oInfoModel = new JSONModel({
          attributes: oSe24.attributes || [],
          methods: oSe24.methods || [],
        });
        var oStatusText = new sap.m.Text({
          text: bLocked
            ? this._i18n("se24.classLocked")
            : "",
        });

        var oAttrList = new sap.m.List({
          headerText: "Public Attributes",
          noDataText: this._i18n("se24.loadMetadataFirst"),
          items: {
            path: "/attributes",
            template: new sap.m.StandardListItem({
              title: "{name}",
              description: "{description}",
              info: "{type}",
              icon: "sap-icon://tag",
            }),
          },
        });
        oAttrList.setModel(oInfoModel);
        var oMethodList = new sap.m.List({
          headerText: "Public Methods",
          noDataText: this._i18n("se24.loadMetadataFirst"),
          items: {
            path: "/methods",
            template: new sap.m.StandardListItem({
              title: "{name}",
              description: "{description}",
              icon: "sap-icon://methods",
            }),
          },
        });
        oMethodList.setModel(oInfoModel);

        var oPendingMeta = null;

        var oDialog = new sap.m.Dialog({
          title: this._i18n("se24.dialogTitle"),
          contentWidth: "520px",
          contentHeight: "600px",
          content: [
            new sap.m.VBox({
              items: [
                new sap.m.Label({ text: this._i18n("se24.className") }),
                oClassInput,
                new sap.m.Label({ text: "Endpoint" }).addStyleClass(
                  "sapUiTinyMarginTop",
                ),
                oEndpointInput,
                new sap.m.HBox({
                  alignItems: "Center",
                  items: [
                    new sap.m.Button({
                      text: this._i18n("se24.loadMetadata"),
                      icon: "sap-icon://refresh",
                      type: "Transparent",
                      press: function () {
                        var sClass = oClassInput.getValue().trim().toUpperCase();
                        var sEndpoint = oEndpointInput.getValue().trim();
                        if (!sClass) {
                          MessageToast.show(that._i18n("toast.enterClassName"));
                          return;
                        }
                        oStatusText.setText(that._i18n("se24.loading"));
                        Se24Service.getMetadata(sEndpoint, sClass, sSe24Client)
                          .then(function (oMeta) {
                            oPendingMeta = oMeta;
                            oInfoModel.setProperty(
                              "/attributes",
                              oMeta.attributes || [],
                            );
                            oInfoModel.setProperty("/methods", oMeta.methods || []);
                            oStatusText.setText(
                              that._i18n("se24.loadComplete", [
                                (oMeta.attributes || []).length,
                                (oMeta.methods || []).length,
                              ]),
                            );
                          })
                          .catch(function (oError) {
                            oPendingMeta = null;
                            oInfoModel.setProperty("/attributes", []);
                            oInfoModel.setProperty("/methods", []);
                            oStatusText.setText(
                              that._i18n("se24.loadFailed", [oError.message]),
                            );
                          });
                      },
                    }),
                    oStatusText.addStyleClass("sapUiSmallMarginBegin"),
                  ],
                }).addStyleClass("sapUiTinyMarginTop"),
                oAttrList,
                oMethodList,
              ],
            }).addStyleClass("sapUiSmallMargin"),
          ],
          beginButton: new sap.m.Button({
            text: this._i18n("button.ok"),
            type: "Emphasized",
            press: function () {
              var sClass = oClassInput.getValue().trim().toUpperCase();
              var sEndpoint = oEndpointInput.getValue().trim();
              if (!sClass) {
                MessageToast.show(that._i18n("toast.enterClassName"));
                return;
              }
              if (bLocked) {
                // Class fixed - only endpoint/metadata refresh is applied
                if (oPendingMeta && oPendingMeta.className === sClass) {
                  oSe24.attributes = oPendingMeta.attributes || [];
                  oSe24.methods = oPendingMeta.methods || [];
                }
                oSe24.endpoint = sEndpoint || oSe24.endpoint;
                oModel.setProperty("/se24", oSe24);
                var sLockedAppId = oModel.getProperty("/currentAppId");
                var aLockedApps = oModel.getProperty("/apps") || [];
                var oLockedApp = aLockedApps.find(function (app) {
                  return app.appId === sLockedAppId;
                });
                if (oLockedApp) {
                  oLockedApp.se24 = oSe24;
                  ZappsRepository.saveApp(oLockedApp);
                }
                oDialog.close();
                MessageToast.show(that._i18n("toast.se24Saved"));
                return;
              }
              if (!oPendingMeta || oPendingMeta.className !== sClass) {
                MessageToast.show(that._i18n("toast.loadMetadataFirst"));
                return;
              }
              var oConfig = {
                className: sClass,
                endpoint: sEndpoint || sDefaultEndpoint,
                attributes: oPendingMeta.attributes || [],
                methods: oPendingMeta.methods || [],
              };
              oModel.setProperty("/se24", oConfig);
              // Persist on the app record right away
              var sAppId = oModel.getProperty("/currentAppId");
              var aApps = oModel.getProperty("/apps") || [];
              var oApp = aApps.find(function (app) {
                return app.appId === sAppId;
              });
              if (oApp) {
                oApp.se24 = oConfig;
                ZappsRepository.saveApp(oApp);
              }
              oDialog.close();
              MessageToast.show(that._i18n("toast.mappingSaved", [sClass]));
            },
          }),
          endButton: new sap.m.Button({
            text: this._i18n("button.cancel"),
            press: function () {
              oDialog.close();
            },
          }),
          afterClose: function () {
            oDialog.destroy();
          },
        });
        oDialog.addStyleClass("addCtrlDialog");
        oDialog.open();
      },

      // SE24 method search help for an event - lists the public methods of the
      // mapped class. Picking a method stores { method, params } on the control's
      // _bindingMeta; methods with importing parameters open the param dialog.
      _openMethodSelectDialog: function (oControl, sEventName) {
        var that = this;
        var oSe24 = this.getOwnerComponent()
          .getModel("appModel")
          .getProperty("/se24");
        if (!oSe24 || !oSe24.methods || oSe24.methods.length === 0) {
          MessageToast.show(this._i18n("toast.mapClassFirst"));
          return;
        }
        var oModel = new JSONModel({ methods: oSe24.methods });
        var oDialog;
        var oList = new sap.m.List({
          items: {
            path: "/methods",
            template: new sap.m.CustomListItem({
              type: "Active",
              content: [
                new sap.m.HBox({
                  alignItems: "Center",
                  items: [
                    new sap.ui.core.Icon({
                      src: "sap-icon://methods",
                      size: "1.1rem",
                    }).addStyleClass("addCtrlIcon"),
                    new sap.m.VBox({
                      items: [
                        new sap.m.Text({ text: "{name}" }).addStyleClass(
                          "addCtrlName",
                        ),
                        new sap.m.Text({
                          text: "{description}",
                        }).addStyleClass("boundPropHint"),
                      ],
                    }),
                  ],
                }).addStyleClass("addCtrlRow"),
              ],
              press: function (oEvent) {
                var oCtx = oEvent.getSource().getBindingContext();
                var oMethod = oCtx.getObject();
                oDialog.close();
                var aImporting = (oMethod.params || []).filter(function (oP) {
                  return (oP.direction || "importing") === "importing";
                });
                if (aImporting.length > 0) {
                  that._openMethodParamsDialog(
                    oControl,
                    sEventName,
                    oMethod.name,
                    aImporting,
                  );
                } else {
                  that._applyMethodBinding(oControl, sEventName, oMethod.name, {});
                }
              },
            }),
          },
        });
        oList.setModel(oModel);
        oList.addStyleClass("addCtrlList");

        oDialog = new sap.m.Dialog({
          title: this._i18n("se24.methodSelectTitle", [oSe24.className]),
          contentWidth: "440px",
          contentHeight: "420px",
          content: [oList],
          endButton: new sap.m.Button({
            text: this._i18n("button.cancel"),
            press: function () {
              oDialog.close();
            },
          }),
          afterClose: function () {
            oDialog.destroy();
          },
        });
        oDialog.addStyleClass("addCtrlDialog");
        oDialog.open();
      },

      // Map each importing parameter of the chosen method to a constant or an
      // SE24 attribute binding ({/ATTR}).
      _openMethodParamsDialog: function (
        oControl,
        sEventName,
        sMethodName,
        aParams,
      ) {
        var that = this;
        var oSe24 = this.getOwnerComponent()
          .getModel("appModel")
          .getProperty("/se24");
        var aAttributes = (oSe24 && oSe24.attributes) || [];
        var vExisting =
          oControl._bindingMeta &&
          oControl._bindingMeta.events &&
          oControl._bindingMeta.events[sEventName];
        var oExistingParams =
          typeof vExisting === "object" && vExisting !== null && vExisting.method === sMethodName
            ? vExisting.params || {}
            : {};

        var aRows = [];
        var oParamInputs = {};
        aParams.forEach(function (oParam) {
          var sExisting = oExistingParams[oParam.name] || "";
          var bIsAttr = /^\{(?:zapp>)?\/.+\}$/.test(sExisting);
          var oConstInput = new sap.m.Input({
            value: bIsAttr ? "" : sExisting,
            placeholder: that._i18n("se24.constantValue"),
            enabled: !bIsAttr,
            width: "100%",
          });
          var oAttrSelect = new sap.m.Select({
            width: "100%",
            selectedKey: bIsAttr ? sExisting : "",
            change: function (oEvent) {
              var sKey = oEvent.getParameter("selectedItem").getKey();
              oConstInput.setEnabled(!sKey);
              if (sKey) {
                oConstInput.setValue("");
              }
            },
          });
          oAttrSelect.addItem(
            new sap.ui.core.Item({ key: "", text: that._i18n("se24.noAttribute") }),
          );
          aAttributes.forEach(function (oAttr) {
            oAttrSelect.addItem(
              new sap.ui.core.Item({
                key: "{/" + oAttr.name + "}",
                text: oAttr.name,
              }),
            );
          });
          oParamInputs[oParam.name] = { input: oConstInput, select: oAttrSelect };
          aRows.push(
            new sap.m.Label({ text: oParam.name + " (" + oParam.type + ")" }),
            oAttrSelect,
            oConstInput,
          );
        });

        var oDialog = new sap.m.Dialog({
          title: this._i18n("se24.paramDialogTitle", [sMethodName]),
          contentWidth: "420px",
          content: [
            new sap.m.VBox({ items: aRows }).addStyleClass("sapUiSmallMargin"),
          ],
          beginButton: new sap.m.Button({
            text: this._i18n("button.apply"),
            type: "Emphasized",
            press: function () {
              var oParams = {};
              aParams.forEach(function (oParam) {
                var oWidgets = oParamInputs[oParam.name];
                var sAttr = oWidgets.select.getSelectedKey();
                var sConst = oWidgets.input.getValue().trim();
                if (sAttr) {
                  oParams[oParam.name] = sAttr;
                } else if (sConst) {
                  oParams[oParam.name] = sConst;
                }
              });
              oDialog.close();
              that._applyMethodBinding(
                oControl,
                sEventName,
                sMethodName,
                oParams,
              );
            },
          }),
          endButton: new sap.m.Button({
            text: this._i18n("button.cancel"),
            press: function () {
              oDialog.close();
            },
          }),
          afterClose: function () {
            oDialog.destroy();
          },
        });
        oDialog.open();
      },

      // Store the SE24 method mapping on the control and refresh the panel
      _applyMethodBinding: function (oControl, sEventName, sMethod, oParams) {
        if (!oControl._bindingMeta) {
          oControl._bindingMeta = { props: {}, events: {} };
        }
        oControl._bindingMeta.events[sEventName] = {
          method: sMethod,
          params: oParams || {},
        };
        this._afterCanvasChange();
        this._selectControl(oControl);
      },

      // Open a small dialog to enter a data binding expression ({model>/path}) for a
      // control property. The expression is stored on the control's _bindingMeta and
      // later serialized into the generated XML.
      _openBindingDialog: function (oControl, sPropName) {
        var that = this;

        // Target context decides which nodes may be bound: a sap.m.Table
        // takes a whole table attribute (saved on the items aggregation),
        // controls inside a table row template take table fields (relative
        // path in the row context), everything else takes struct fields only.
        function detectTargetKind(oCtrl) {
          if (oCtrl.isA && oCtrl.isA("sap.m.Table")) {
            return "table";
          }
          var oParent = oCtrl.getParent ? oCtrl.getParent() : null;
          while (oParent) {
            if (oParent.isA && oParent.isA("sap.m.ListItemBase")) {
              return "row";
            }
            oParent = oParent.getParent ? oParent.getParent() : null;
          }
          return "scalar";
        }
        var sTargetKind = detectTargetKind(oControl);
        var sSaveKey = sTargetKind === "table" ? "items" : sPropName;

        var sCurrent =
          (oControl._bindingMeta &&
            oControl._bindingMeta.props &&
            oControl._bindingMeta.props[sSaveKey]) ||
          "";
        var oInput = new sap.m.Input({
          value: sCurrent,
          placeholder: "{/path}",
          width: "100%",
        });

        // SE24 attribute tree picker (BAS style) - left tree grouped by
        // struct / table with nested fields. UI5 1.150: hierarchy must be
        // expressed via tree model binding (items template with nested
        // children), StandardTreeItem no longer has an "info" property.
        var oSe24 = this.getOwnerComponent()
          .getModel("appModel")
          .getProperty("/se24");

        function attrKind(oAttr) {
          if (oAttr.kind === "table" || oAttr.kind === "struct") {
            return oAttr.kind;
          }
          return oAttr.fields && oAttr.fields.length ? "struct" : "scalar";
        }

        function buildFieldNodes(aFields, sParentPath, sFilter, sRootKind) {
          var aNodes = [];
          (aFields || []).forEach(function (oField) {
            var sPath = sParentPath + "/" + oField.name;
            var bMatch = !sFilter || oField.name.indexOf(sFilter) > -1;
            var aChildren =
              oField.fields && oField.fields.length
                ? buildFieldNodes(
                    oField.fields,
                    sPath,
                    bMatch ? "" : sFilter,
                    sRootKind,
                  )
                : [];
            if (!bMatch && aChildren.length === 0) {
              return;
            }
            aNodes.push({
              title: oField.name,
              typeLabel: oField.type || "",
              path: sPath,
              group: false,
              rootKind: sRootKind,
              children: aChildren,
            });
          });
          return aNodes;
        }

        function buildTreeData(sFilter) {
          var aNodes = [];
          var aAttrs = (oSe24 && oSe24.attributes) || [];
          var aGroups = [
            { label: that._i18n("binding.groupStruct"), kind: "struct" },
            { label: that._i18n("binding.groupTable"), kind: "table" },
          ];
          aGroups.forEach(function (oGroup) {
            var aGroupAttrs = aAttrs.filter(function (oAttr) {
              return attrKind(oAttr) === oGroup.kind;
            });
            if (aGroupAttrs.length === 0) {
              return;
            }
            var aAttrNodes = [];
            aGroupAttrs.forEach(function (oAttr) {
              var bAttrMatch =
                !sFilter || oAttr.name.indexOf(sFilter) > -1;
              var aChildren = buildFieldNodes(
                oAttr.fields,
                oAttr.name,
                bAttrMatch ? "" : sFilter,
                oGroup.kind,
              );
              if (sFilter && !bAttrMatch && aChildren.length === 0) {
                return;
              }
              aAttrNodes.push({
                title: oAttr.name,
                typeLabel: oAttr.type || "",
                path: oAttr.name,
                group: false,
                rootKind: oGroup.kind,
                children: aChildren,
              });
            });
            if (aAttrNodes.length === 0) {
              return;
            }
            aNodes.push({
              title:
                oGroup.label +
                " (" +
                aAttrNodes.length +
                ")",
              typeLabel: "",
              path: "",
              group: true,
              children: aAttrNodes,
            });
          });
          return aNodes;
        }

        var oTreeModel = new sap.ui.model.json.JSONModel({
          tree: buildTreeData(""),
        });

        // CustomTreeItem template: title left, ABAP type kind right.
        // The tree binding flattens all hierarchy levels, so one shared
        // template renders every level (indentation is applied via level).
        function makeItemTemplate() {
          var oTitleText = new sap.m.Text({
            text: {
              parts: ["bindingTree>title", "bindingTree>group"],
              formatter: function (sTitle, bGroup) {
                return bGroup ? "\u25a0 " + sTitle : sTitle;
              },
            },
          });
          return new sap.m.CustomTreeItem({
            content: [
              new sap.m.HBox({
                width: "100%",
                justifyContent: "SpaceBetween",
                alignItems: "Center",
                items: [
                  oTitleText,
                  new sap.m.Text({
                    text: "{bindingTree>typeLabel}",
                  }).addStyleClass("bindingTypeLabel"),
                ],
              }),
            ],
          });
        }

        var oTree = new sap.m.Tree({
          width: "100%",
          items: {
            path: "bindingTree>/tree",
            parameters: {
              arrayNames: ["children"],
              numberOfExpandedLevels: 1,
            },
            template: makeItemTemplate(),
          },
          selectionChange: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (!oItem) {
              return;
            }
            var oCtx = oItem.getBindingContext("bindingTree");
            if (!oCtx) {
              return;
            }
            var oNode = oCtx.getObject();
            if (oNode.group || !oNode.path) {
              return; // group header click - ignore
            }
            var oInfo = nodeBindingInfo(oNode);
            if (!oInfo.valid) {
              return; // not bindable for this target kind
            }
            oInput.setValue(oInfo.expr);
          },
        });
        oTree.setModel(oTreeModel, "bindingTree");

        // Decide whether a node may be bound onto the current target and
        // build the matching expression (relative path inside row context).
        function nodeBindingInfo(oNode) {
          var bTableRoot = oNode.rootKind === "table";
          var bFieldLevel = oNode.path.indexOf("/") > -1;
          if (sTargetKind === "table") {
            if (bTableRoot && !bFieldLevel) {
              return { valid: true, expr: "{/" + oNode.path + "}" };
            }
            return { valid: false, reasonKey: "binding.invalidFieldForTable" };
          }
          if (sTargetKind === "row") {
            if (bTableRoot && bFieldLevel) {
              // Relative binding resolved against the row context at runtime
              return {
                valid: true,
                expr: "{" + oNode.path.split("/").pop() + "}",
              };
            }
            return { valid: false, reasonKey: "binding.invalidStructForRow" };
          }
          // scalar target: struct fields only
          if (!bTableRoot && bFieldLevel) {
            return { valid: true, expr: "{/" + oNode.path + "}" };
          }
          if (bTableRoot) {
            return {
              valid: false,
              reasonKey: bFieldLevel
                ? "binding.invalidFieldForScalar"
                : "binding.invalidTableForScalar",
            };
          }
          return { valid: false, reasonKey: "binding.structFieldRequired" };
        }

        function findNodeByPath(sPath) {
          var aStack = (oTreeModel.getData().tree || []).slice();
          while (aStack.length) {
            var oNode = aStack.pop();
            if (oNode.path === sPath) {
              return oNode;
            }
            (oNode.children || []).forEach(function (oChild) {
              aStack.push(oChild);
            });
          }
          return null;
        }

        // Double click applies the binding immediately (or rejects the node
        // when it is not bindable for the current target kind).
        oTree.attachBrowserEvent("dblclick", function (oEvent) {
          var oLi =
            oEvent.target && oEvent.target.closest
              ? oEvent.target.closest("li[id]")
              : null;
          if (!oLi) {
            return;
          }
          var oItem = sap.ui.getCore().byId(oLi.id);
          if (!oItem || typeof oItem.getBindingContext !== "function") {
            return;
          }
          var oCtx = oItem.getBindingContext("bindingTree");
          if (!oCtx) {
            return;
          }
          var oNode = oCtx.getObject();
          if (!oNode || oNode.group || !oNode.path) {
            return;
          }
          var oInfo = nodeBindingInfo(oNode);
          if (!oInfo.valid) {
            MessageToast.show(that._i18n(oInfo.reasonKey));
            return;
          }
          oInput.setValue(oInfo.expr);
          applyBinding();
        });

        function rebuildTree(sFilter) {
          oTreeModel.setData({ tree: buildTreeData(sFilter) });
        }

        var oSearch = new sap.m.SearchField({
          placeholder: that._i18n("binding.fieldSearch"),
          width: "100%",
          liveChange: function (oEvent) {
            rebuildTree(oEvent.getParameter("newValue").toUpperCase());
          },
        });

        rebuildTree("");

        function applyBinding() {
          var sValue = oInput.getValue().trim();
          // Reject typed binding expressions that violate the target-kind rules
          var oMatch = sValue.match(/^\{(?:zapp>)?\/([^}]+)\}$/);
          if (oMatch) {
            var oNode = findNodeByPath(oMatch[1].replace(/^\//, ""));
            if (oNode) {
              var oInfo = nodeBindingInfo(oNode);
              if (!oInfo.valid) {
                MessageToast.show(that._i18n(oInfo.reasonKey));
                return;
              }
            }
          }
          if (!oControl._bindingMeta) {
            oControl._bindingMeta = { props: {}, events: {} };
          }
          if (sValue) {
            oControl._bindingMeta.props[sSaveKey] = sValue;
            // Show the expression on the canvas control itself
            that._syncBindingDisplay(oControl, sSaveKey, sValue);
            MessageToast.show(that._i18n("binding.applied", [sValue]));
          } else {
            delete oControl._bindingMeta.props[sSaveKey];
            // Fall back to the control id as the canvas display text
            that._syncBindingDisplay(oControl, sSaveKey, oControl.getId());
          }
          oDialog.close();
          that._afterCanvasChange();
          that._selectControl(oControl);
        }

        var oDialog = new sap.m.Dialog({
          title: that._i18n("binding.dialogTitle", [sPropName]),
          contentWidth: "auto",
          contentHeight: "520px",
          draggable: true,
          resizable: true,
          content: [
            new sap.m.HBox({
              height: "100%",
              items: [
                new sap.m.VBox({
                  width: "380px",
                  height: "100%",
                  layoutData: new sap.m.FlexItemData({ growFactor: 1 }),
                  items: [
                    oSearch,
                    new sap.m.ScrollContainer({
                      height: "100%",
                      vertical: true,
                      layoutData: new sap.m.FlexItemData({ growFactor: 1 }),
                      content: [oTree],
                    }).addStyleClass("sapUiTinyMarginTop bindingDialogTreeScroll"),
                  ],
                }).addStyleClass("sapUiSmallMarginEnd"),
                new sap.m.VBox({
                  width: "280px",
                  items: [
                    new sap.m.Label({ text: that._i18n("binding.expression") }),
                    oInput,
                    new sap.m.Text({
                      text: that._i18n("binding.expressionHint"),
                    }).addStyleClass("sapUiTinyMarginTop boundPropHint"),
                  ],
                }).addStyleClass("sapUiSmallMarginTop"),
              ],
            }).addStyleClass("bindingDialogInner"),
          ],
          beginButton: new sap.m.Button({
            text: that._i18n("button.apply"),
            type: "Emphasized",
            press: function () {
              applyBinding();
            },
          }),
          endButton: new sap.m.Button({
            text: that._i18n("button.cancel"),
            press: function () {
              oDialog.close();
            },
          }),
          afterClose: function () {
            oDialog.destroy();
          },
        });
        oDialog.addStyleClass("addCtrlDialog bindingDialog");
        oDialog.open();
      },

      // Mirror a binding expression onto the canvas control so the designer
      // sees {/PATH} directly in the design view. Passing undefined restores
      // an empty value. Only plain string properties can carry the text.
      _syncBindingDisplay: function (oControl, sName, vValue) {
        var oProp = oControl.getMetadata().getAllProperties()[sName];
        if (!oProp || oProp.type !== "string") {
          return;
        }
        oControl.setProperty(sName, vValue === undefined ? "" : vValue);
      },

      // Mirror every bound string property's expression onto the control
      // (covers Input/value, Label/text, Text/text, TextArea/value,
      // Page/title ... anything with a string-typed property).
      _syncAllBindingDisplays: function (oControl) {
        var oBound =
          (oControl._bindingMeta && oControl._bindingMeta.props) || {};
        var that = this;
        Object.keys(oBound).forEach(function (sName) {
          that._syncBindingDisplay(oControl, sName, oBound[sName]);
        });
      },

      // Open a searchable SAP icon selection dialog (like the search-help in SE80).
      // Picking an icon applies "sap-icon://<name>" to the given property.
      _openIconSelectDialog: function (oControl, sPropName) {
        var that = this;
        var aAllIcons = sap.ui.core.IconPool.getIconNames().map(function (sName) {
          return { name: sName, uri: "sap-icon://" + sName };
        });
        var oModel = new JSONModel({ icons: aAllIcons });

        var oList = new sap.m.List({
          growing: true,
          growingThreshold: 200,
          items: {
            path: "/icons",
            template: new sap.m.CustomListItem({
              type: "Active",
              content: [
                new sap.m.HBox({
                  alignItems: "Center",
                  items: [
                    new sap.ui.core.Icon({ src: "{uri}", size: "1.1rem" })
                      .addStyleClass("addCtrlIcon"),
                    new sap.m.Text({ text: "{name}" }).addStyleClass("addCtrlName"),
                  ],
                }).addStyleClass("addCtrlRow"),
              ],
              press: function (oEvent) {
                var sUri = oEvent
                  .getSource()
                  .getBindingContext()
                  .getProperty("uri");
                that._applyProperty(oControl, sPropName, sUri);
                oDialog.close();
                that._selectControl(oControl);
              },
            }),
          },
        });
        oList.setModel(oModel);
        oList.addStyleClass("addCtrlList");

        var oSearchField = new sap.m.SearchField({
          placeholder: this._i18n("search.iconPlaceholder"),
          width: "100%",
          liveChange: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") || "").toLowerCase();
            oModel.setProperty(
              "/icons",
              aAllIcons.filter(function (oIcon) {
                return oIcon.name.indexOf(sQuery) > -1;
              }),
            );
          },
        });

        var oContent = new sap.m.VBox({
          items: [oSearchField, oList],
        });
        oContent.addStyleClass("sapUiSmallMargin");

        var oDialog = new sap.m.Dialog({
          title: "Select Icon",
          contentWidth: "440px",
          contentHeight: "500px",
          content: [oContent],
          endButton: new sap.m.Button({
            text: this._i18n("button.close"),
            press: function () {
              oDialog.close();
            },
          }),
          afterClose: function () {
            oDialog.destroy();
          },
        });
        oDialog.addStyleClass("addCtrlDialog");
        oDialog.open();
      },

      // Apply property change to control via setter
      _applyProperty: function (oControl, sPropName, vValue) {
        var sSetter =
          "set" + sPropName.charAt(0).toUpperCase() + sPropName.slice(1);
        if (typeof oControl[sSetter] === "function") {
          oControl[sSetter](vValue);
          this._updateXmlFromCanvas();
        }
      },

      // Apply the "class" pseudo-property: sync addStyleClass/removeStyleClass
      // with the space-separated value entered in the Properties panel.
      // The transient selection highlight (controlSelected) is never touched.
      _applyStyleClasses: function (oControl, sValue) {
        if (!oControl || !oControl.addStyleClass) {
          return;
        }
        var aNew = (sValue || "")
          .trim()
          .split(/\s+/)
          .filter(function (sCls) {
            return sCls && sCls !== "controlSelected";
          });
        var aOld = this._styleClassesOf(oControl).filter(function (sCls) {
          return sCls !== "controlSelected";
        });
        aOld.forEach(function (sCls) {
          if (aNew.indexOf(sCls) === -1) {
            oControl.removeStyleClass(sCls);
          }
        });
        aNew.forEach(function (sCls) {
          if (aOld.indexOf(sCls) === -1) {
            oControl.addStyleClass(sCls);
          }
        });
        this._updateXmlFromCanvas();
      },

      // Refresh the outline tree from the current canvas hierarchy
      _refreshOutline: function () {
        var oTree = this.byId("outlineTree");
        if (!oTree) {
          return;
        }
        var aData = this._buildOutlineData();
        var oModel = new JSONModel({ tree: aData });
        oTree.setModel(oModel);
        oTree.bindAggregation("items", {
          path: "/tree",
          parameters: { arrayNames: ["nodes"] },
          template: new sap.m.StandardTreeItem({
            title: "{title}",
            icon: "{icon}",
            type: "Active",
          }),
        });
        oTree.expandToLevel(99);

        // Restore selection for the currently selected control
        var oSelected = this.getOwnerComponent()
          .getModel("appModel")
          .getProperty("/selectedControl");
        if (oSelected && oSelected.id) {
          var oTargetItem = this._findOutlineItem(oTree, oSelected.id);
          if (oTargetItem) {
            oTree.setSelectedItem(oTargetItem);
          }
        }
      },

      // Build outline data reflecting the actual canvas hierarchy
      _buildOutlineData: function () {
        var that = this;
        var oCanvas = this.byId("designCanvas");

        function buildNode(oControl) {
          var sType = oControl.getMetadata().getName();
          var oNode = {
            title: sType,
            icon: that._getIconForType(sType),
            controlId: oControl.getId(),
            nodes: [],
          };
          var oAggregations = oControl.getMetadata().getAllAggregations();
          Object.keys(oAggregations).forEach(function (sAggName) {
            // Skip technical aggregations that should not appear in the outline
            if (that._isTechnicalAggregation(sAggName)) {
              return;
            }
            var vContent = oControl.getAggregation(sAggName);
            if (!vContent) {
              return;
            }
            var aContent = Array.isArray(vContent) ? vContent : [vContent];
            // Include Elements (not just Controls) so structural Elements like
            // sap.m.Column, form containers, etc. appear in the outline.
            var aChildControls = aContent.filter(function (oChild) {
              return oChild && oChild.isA && oChild.isA("sap.ui.core.Element");
            });
            if (aChildControls.length > 0) {
              // Aggregation nodes carry the owner control id + aggregation name so
              // right-clicking the folder can offer "add" into that aggregation.
              oNode.nodes.push({
                title: sAggName,
                icon: "sap-icon://folder",
                aggControlId: oControl.getId(),
                aggregation: sAggName,
                nodes: aChildControls.map(function (oChild) {
                  return buildNode(oChild);
                }),
              });
            }
          });
          return oNode;
        }

        // Collect direct children of the canvas
        var aCanvasChildren = [];
        var oCanvasAggs = oCanvas.getMetadata().getAllAggregations();
        Object.keys(oCanvasAggs).forEach(function (sAggName) {
          var vContent = oCanvas.getAggregation(sAggName);
          if (!vContent) {
            return;
          }
          var aContent = Array.isArray(vContent) ? vContent : [vContent];
          aContent.forEach(function (oChild) {
            if (oChild && oChild.isA && oChild.isA("sap.ui.core.Control")) {
              aCanvasChildren.push(buildNode(oChild));
            }
          });
        });

        return [
          {
            title: "App.view.xml",
            icon: "sap-icon://document",
            nodes: [
              {
                title: "sap.m.App",
                icon: "sap-icon://iphone",
                controlId: that._getDesignApp().getId(),
                nodes: [
                  {
                    title: "pages",
                    icon: "sap-icon://folder",
                    aggControlId: that._getDesignApp().getId(),
                    aggregation: "pages",
                    nodes: aCanvasChildren,
                  },
                ],
              },
            ],
          },
        ];
      },

      // Get an appropriate icon for a control type.
      // NOTE: only icon names that exist in the SAP-icons font may be used
      // (verified via IconPool.getIconInfo). Invalid names render as blanks.
      _getIconForType: function (sType) {
        var oIconMap = {
          "sap.m.Button": "sap-icon://action",
          "sap.m.Text": "sap-icon://text-align-justified",
          "sap.m.Input": "sap-icon://edit",
          "sap.m.Label": "sap-icon://tag",
          "sap.m.Title": "sap-icon://text-align-center",
          "sap.m.VBox": "sap-icon://resize-vertical",
          "sap.m.HBox": "sap-icon://resize-horizontal",
          "sap.m.Image": "sap-icon://picture",
          "sap.m.CheckBox": "sap-icon://check-availability",
          "sap.m.Link": "sap-icon://chain-link",
          "sap.m.Panel": "sap-icon://group-2",
          "sap.m.Table": "sap-icon://table-view",
          "sap.m.List": "sap-icon://list",
        };
        return oIconMap[sType] || "sap-icon://widgets";
      },

      // Right-click on an outline tree item - open the same context menu as the
      // canvas, anchored to the tree item so it appears at the mouse pointer.
      _onOutlineContextMenu: function (oItem, oEvent) {
        // Always suppress the browser's native menu inside the outline
        oEvent.preventDefault();
        oEvent.stopPropagation();

        var oContext = oItem.getBindingContext();
        if (!oContext) {
          return;
        }
        var sControlId = oContext.getProperty("controlId");
        if (!sControlId) {
          // Aggregation node (folder): offer "add" into this aggregation, e.g.
          // adding another Column under a Table's "columns" node.
          var sAggName = oContext.getProperty("aggregation");
          var sAggOwnerId = oContext.getProperty("aggControlId");
          if (sAggName && sAggOwnerId) {
            var oAggOwner = sap.ui.getCore().byId(sAggOwnerId);
            if (oAggOwner) {
              this._openContextMenu(oAggOwner, oEvent, oItem, sAggName);
            }
          }
          return; // structural / aggregation node - no control actions
        }
        var oControl = sap.ui.getCore().byId(sControlId);
        if (!oControl) {
          return;
        }
        this._selectControl(oControl);
        this._openContextMenu(oControl, oEvent, oItem);
      },

      // Outline node selection - select the corresponding control
      onOutlineSelect: function (oEvent) {
        var oItem = oEvent.getParameter("listItem");
        var oContext = oItem.getBindingContext();
        if (!oContext) {
          return;
        }
        var sControlId = oContext.getProperty("controlId");
        if (sControlId) {
          var oControl = sap.ui.getCore().byId(sControlId);
          if (oControl) {
            this._selectControl(oControl);
          }
        }
      },

      // Update XML from canvas - recursively serialize the canvas control tree
      // so the Code view always mirrors the Outline hierarchy.
      _updateXmlFromCanvas: function () {
        var that = this;
        var oCanvas = this.byId("designCanvas");
        if (!oCanvas) {
          return;
        }

        // Namespace prefix map (sap.m is the default namespace)
        var oPrefixMap = {
          "sap.m": "",
          "sap.ui.core": "core",
          "sap.ui.layout": "layout",
          "sap.f": "f",
          "sap.ui.table": "table",
          "sap.ui.unified": "unified",
          "sap.ui.comp": "comp",
          "sap.suite.ui.commons": "suite",
        };
        var oUsedNamespaces = {};

        function escapeXml(sValue) {
          return String(sValue)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        }

        function getTagName(sType) {
          var iLastDot = sType.lastIndexOf(".");
          var sNs = sType.substring(0, iLastDot);
          var sLocal = sType.substring(iLastDot + 1);
          var sPrefix = oPrefixMap[sNs];
          if (sPrefix === undefined) {
            sPrefix = sNs.split(".").pop();
          }
          oUsedNamespaces[sNs] = sPrefix;
          return sPrefix ? sPrefix + ":" + sLocal : sLocal;
        }

        // Serialize only properties that differ from their metadata default
        function serializeProps(oControl) {
          var sResult = "";
          var oProps = oControl.getMetadata().getAllProperties();
          var oBoundProps =
            (oControl._bindingMeta && oControl._bindingMeta.props) || {};
          Object.keys(oProps).forEach(function (sName) {
            if (sName === "id") {
              return; // skip auto-generated ids
            }
            // Data-bound property: emit the binding expression instead of the value
            if (oBoundProps[sName]) {
              sResult +=
                " " + sName + '="' + escapeXml(oBoundProps[sName]) + '"';
              return;
            }
            var vValue = oControl.getProperty(sName);
            if (vValue === null || vValue === undefined || vValue === "") {
              return;
            }
            // Skip complex values (arrays/objects) - not simple XML attributes
            if (typeof vValue === "object") {
              return;
            }
            var vDefault = oProps[sName].defaultValue;
            if (vValue === vDefault) {
              return;
            }
            // Skip natural zero-values when the metadata default is null (e.g. maxLines: null -> 0)
            if (vDefault === null && (vValue === 0 || vValue === false)) {
              return;
            }
            sResult += " " + sName + '="' + escapeXml(vValue) + '"';
          });
          // Aggregation bindings saved by the binding dialog that are not
          // metadata properties (e.g. items="{/GT_LLIST}" on a Table)
          Object.keys(oBoundProps).forEach(function (sName) {
            if (sName === "id" || oProps[sName]) {
              return;
            }
            sResult +=
              " " + sName + '="' + escapeXml(oBoundProps[sName]) + '"';
          });
          return sResult;
        }

        // Serialize saved event bindings as event=".handlerName" attributes so the
        // generated XML wires each control's events to controller methods.
        // The saved value is either a string or an SE24 mapping object { method, params }.
        function serializeEvents(oControl) {
          var sResult = "";
          if (oControl._bindingMeta && oControl._bindingMeta.events) {
            Object.keys(oControl._bindingMeta.events).forEach(
              function (sEvent) {
                var vHandler = oControl._bindingMeta.events[sEvent];
                var sHandler =
                  typeof vHandler === "object" && vHandler !== null
                    ? vHandler.method
                    : vHandler;
                if (sHandler) {
                  sResult += " " + sEvent + '=".' + escapeXml(sHandler) + '"';
                }
              },
            );
          }
          return sResult;
        }

        // Recursively serialize a control and its aggregation children
        function serializeControl(oControl, sIndent) {
          var oMeta = oControl.getMetadata();
          var sTag = getTagName(oMeta.getName());
          var sProps = serializeProps(oControl);
          // CSS classes assigned via the Properties panel ("class" attribute)
          if (oControl.isA && oControl.isA("sap.ui.core.Control")) {
            var aClasses = that._styleClassesOf(oControl).filter(
              function (sCls) {
                return sCls !== "controlSelected";
              },
            );
            if (aClasses.length > 0) {
              sProps += ' class="' + escapeXml(aClasses.join(" ")) + '"';
            }
          }
          var sEvents = serializeEvents(oControl);

          // Default aggregation children are written inline (no wrapper tag).
          // UI5's XML parser rejects an aggregation wrapper whose namespace
          // differs from the parent control's namespace (e.g. a bare <content>
          // under layout:Grid resolves to sap.m and is misread as control
          // sap.m.content -> 404). Inline children avoid this entirely.
          var oDefaultAgg = oMeta.getDefaultAggregation
            ? oMeta.getDefaultAggregation()
            : null;
          var sDefaultAggName = oDefaultAgg ? oDefaultAgg.name : null;

          var aDefaultChildren = [];
          var aWrappedEntries = [];
          var oAggs = oMeta.getAllAggregations();
          Object.keys(oAggs).forEach(function (sAggName) {
            // Skip technical aggregations in the serialized XML
            if (that._isTechnicalAggregation(sAggName)) {
              return;
            }
            var vContent = oControl.getAggregation(sAggName);
            if (!vContent) {
              return;
            }
            var aContent = Array.isArray(vContent) ? vContent : [vContent];
            // Include Elements (not just Controls) so structural Elements like
            // sap.m.Column are serialized into the XML.
            var aChildControls = aContent.filter(function (oChild) {
              return oChild && oChild.isA && oChild.isA("sap.ui.core.Element");
            });
            if (aChildControls.length === 0) {
              return;
            }
            if (sAggName === sDefaultAggName) {
              aDefaultChildren = aDefaultChildren.concat(aChildControls);
            } else {
              aWrappedEntries.push({ name: sAggName, children: aChildControls });
            }
          });

          if (aDefaultChildren.length === 0 && aWrappedEntries.length === 0) {
            return sIndent + "<" + sTag + sProps + sEvents + "/>\n";
          }

          var sResult = sIndent + "<" + sTag + sProps + sEvents + ">\n";
          // Default aggregation children inline
          aDefaultChildren.forEach(function (oChild) {
            sResult += serializeControl(oChild, sIndent + "    ");
          });
          // Non-default aggregations keep their wrapper tag. The wrapper must
          // carry the parent control's namespace prefix, otherwise the parser
          // resolves it to the default namespace and misreads it as a control.
          var iColon = sTag.indexOf(":");
          var sWrapperPrefix = iColon > -1 ? sTag.substring(0, iColon + 1) : "";
          aWrappedEntries.forEach(function (oEntry) {
            var sWrapperTag = sWrapperPrefix + oEntry.name;
            sResult += sIndent + "    <" + sWrapperTag + ">\n";
            oEntry.children.forEach(function (oChild) {
              sResult += serializeControl(oChild, sIndent + "        ");
            });
            sResult += sIndent + "    </" + sWrapperTag + ">\n";
          });
          sResult += sIndent + "</" + sTag + ">\n";
          return sResult;
        }

        // Serialize the design page's content children directly. The canvas
        // VBox wrapper and the editor's designPage itself are scaffolding -
        // serializing them would produce a nested Page whose header duplicates
        // the title and whose content area collapses to zero height at runtime.
        var sVBox = "";
        if (oCanvas) {
          var oDesignPage = this.byId("designPage");
          if (oDesignPage) {
            (oDesignPage.getContent() || []).forEach(function (oChild) {
              sVBox += serializeControl(oChild, "            ");
            });
          }
        }
        // The generated App/Page tags live in sap.m - keep the namespace declared
        oUsedNamespaces["sap.m"] = oUsedNamespaces["sap.m"] || "";

        // Attributes of the canvas Page itself (title, class, ...) - only
        // values that differ from the metadata defaults are emitted.
        var oPage = this.byId("designPage");
        var sPageAttrs = "";
        if (oPage) {
          sPageAttrs = serializeProps(oPage) + serializeEvents(oPage);
          var aPageClasses = that._styleClassesOf(oPage);
          if (aPageClasses.length > 0) {
            sPageAttrs += ' class="' + escapeXml(aPageClasses.join(" ")) + '"';
          }
        }

        // Attributes of the App root (backgroundColor, homeIcon, ...) - only
        // values that differ from the metadata defaults are emitted.
        var oDesignApp = that._getDesignApp();
        var sAppAttrs = serializeProps(oDesignApp) + serializeEvents(oDesignApp);
        var aAppClasses = that._styleClassesOf(oDesignApp);
        if (aAppClasses.length > 0) {
          sAppAttrs += ' class="' + escapeXml(aAppClasses.join(" ")) + '"';
        }

        // Build namespace declarations from the namespaces actually used
        var sXmlns = "";
        Object.keys(oUsedNamespaces).forEach(function (sNs) {
          var sPrefix = oUsedNamespaces[sNs];
          if (sPrefix === "") {
            sXmlns += ' xmlns="' + sNs + '"';
          } else {
            sXmlns += " xmlns:" + sPrefix + '="' + sNs + '"';
          }
        });

        var sXml = '<mvc:View xmlns:mvc="sap.ui.core.mvc"' + sXmlns + ">\n";
        sXml += "    <App" + sAppAttrs + ">\n";
        // App's default aggregation is "pages" and Page's is "content", so the
        // children are written inline (no <pages>/<content> wrapper tags).
        sXml += "        <Page" + sPageAttrs + ">\n";
        sXml += sVBox;
        sXml += "        </Page>\n";
        sXml += "    </App>\n";
        sXml += "</mvc:View>";

        var oModel = this.getOwnerComponent().getModel("appModel");
        oModel.setProperty("/currentXml", sXml);
      },

      // Delete control
      onPressDeleteControl: function () {
        var oModel = this.getOwnerComponent().getModel("appModel");
        var oSelected = oModel.getProperty("/selectedControl");

        if (!oSelected.id) {
          MessageToast.show(this._i18n("toast.selectControlToDelete"));
          return;
        }

        var oControl = sap.ui.getCore().byId(oSelected.id);
        // The App root can never be deleted from the Properties panel
        if (this._isDesignApp(oControl)) {
          MessageToast.show(this._i18n("toast.cannotDeleteRoot"));
          return;
        }
        if (oControl) {
          var oParent = oControl.getParent();
          if (oParent && oParent.removeItem) {
            oParent.removeItem(oControl);
          }
        }

        // Reset selection
        oModel.setProperty("/selectedControl", {
          type: "",
          id: "",
        });

        this.byId("noSelection").setVisible(true);
        this.byId("propertiesContent").setVisible(false);

        var iCount = oModel.getProperty("/controlCount") || 0;
        if (iCount > 0) {
          oModel.setProperty("/controlCount", iCount - 1);
        }

        this._updateXmlFromCanvas();
        this._refreshOutline();
        MessageToast.show(this._i18n("toast.deleted"));
      },

      // Save layout - persists the app record into the ZAPPS store.
      // The record mirrors the future SE11 table ZAPPS:
      //   layout.xml  -> LAYOUT_XML   (generated view XML, for SE24/runtime)
      //   layout.tree -> LAYOUT_TREE  (editor tree JSON, for maintenance)
      onPressSave: function () {
        this._updateXmlFromCanvas();
        var oModel = this.getOwnerComponent().getModel("appModel");
        var sAppId = oModel.getProperty("/currentAppId");
        var sXml = oModel.getProperty("/currentXml");
        var aTree = this._buildCanvasTree();

        var aApps = oModel.getProperty("/apps") || [];
        var oApp = aApps.find(function (app) {
          return app.appId === sAppId;
        });
        if (!oApp) {
          // App record missing from the in-memory list (deep link) - create it
          oApp = {
            appId: sAppId,
            appName: sAppId,
            appType: "SAPUI5",
            description: "",
            createdAt: new Date().toISOString().split("T")[0],
            status: "Draft",
            statusState: "Warning",
            layout: {},
          };
          aApps.push(oApp);
        }
        oApp.layout = {
          xml: sXml,
          tree: aTree,
          pageProps: this._collectPageProps(),
          appProps: this._collectAppProps(),
        };
        oApp.se24 = oModel.getProperty("/se24") || null;
        oApp.updatedAt = new Date().toISOString().split("T")[0];
        oModel.setProperty("/apps", aApps);
        ZappsRepository.saveApp(oApp);

        MessageToast.show(
          this._i18n("toast.layoutSaved", [sAppId])
        );
      },

      // Preview the current canvas design as a standalone web app in a new
      // browser window. The generated view XML is embedded into a self-contained
      // HTML page that bootstraps SAPUI5 from the CDN and renders the XML view.
      // Bound event handlers (press=".onXxx") are stubbed with a controller that
      // shows a toast.
      onPressPreview: function () {
        this._updateXmlFromCanvas();
        var oModel = this.getOwnerComponent().getModel("appModel");
        var sXml = oModel.getProperty("/currentXml");
        if (!sXml) {
          MessageToast.show(this._i18n("toast.noLayoutToRun"));
          return;
        }
        var sAppId = oModel.getProperty("/currentAppId") || "Layout Preview";
        var oHandlers = this._collectHandlerNames();

        // SE24 runtime config: data comes from the class attributes (default
        // model), event handlers call the class methods via the SICF protocol.
        var oSe24 = oModel.getProperty("/se24");
        var oSe24Config = null;
        if (oSe24 && oSe24.className && oSe24.endpoint) {
          var oCfgModel = this.getOwnerComponent().getModel("config");
          oSe24Config = {
            className: oSe24.className,
            endpoint: oSe24.endpoint,
            client: (oCfgModel && oCfgModel.getProperty("/se24/client")) || "",
            methods: (oSe24.methods || []).map(function (oMethod) {
              return oMethod.name;
            }),
            eventParams: oHandlers.eventParams,
          };
        }
        var sHtml = this._buildRunPageHtml(
          sAppId,
          sXml,
          oHandlers.names,
          oSe24Config,
        );

        var oWin = window.open("", "_blank");
        if (!oWin) {
          MessageToast.show(this._i18n("toast.popupBlocked"));
          return;
        }
        oWin.document.open();
        oWin.document.write(sHtml);
        oWin.document.close();
      },

      // Collect the distinct event handler names defined on the canvas tree
      // (via _bindingMeta.events) so the run page can implement them.
      // Also collect the SE24 parameter mappings keyed by method name.
      _collectHandlerNames: function () {
        var oSeen = {};
        var aResult = [];
        var oEventParams = {};
        function walk(oControl) {
          if (!oControl) {
            return;
          }
          if (oControl._bindingMeta && oControl._bindingMeta.events) {
            Object.keys(oControl._bindingMeta.events).forEach(function (sEvent) {
              var vHandler = oControl._bindingMeta.events[sEvent];
              var sHandler =
                typeof vHandler === "object" && vHandler !== null
                  ? vHandler.method
                  : vHandler;
              if (!sHandler) {
                return;
              }
              if (!oSeen[sHandler]) {
                oSeen[sHandler] = true;
                aResult.push(sHandler);
              }
              if (typeof vHandler === "object" && vHandler !== null) {
                oEventParams[sHandler] = vHandler.params || {};
              }
            });
          }
          if (!oControl.getMetadata) {
            return;
          }
          var oAggs = oControl.getMetadata().getAllAggregations();
          Object.keys(oAggs).forEach(function (sName) {
            var vContent = oControl.getAggregation(sName);
            if (!vContent) {
              return;
            }
            var aContent = Array.isArray(vContent) ? vContent : [vContent];
            aContent.forEach(walk);
          });
        }
        walk(this.byId("designCanvas"));
        return { names: aResult, eventParams: oEventParams };
      },

      // Build the self-contained HTML page for the standalone run window.
      // When oSe24Config is present the page loads the class attribute values
      // into the default JSONModel (also registered as "zapp" for backward
      // compatibility) and event handlers call the mapped SE24 methods
      // through the SICF protocol (see docs/SE24_SICF_HANDLER.md).
      _buildRunPageHtml: function (sTitle, sXml, aHandlers, oSe24Config) {
        // Embed the XML as a JS string literal; escape "</" so it cannot terminate
        // the surrounding <script> block.
        var sXmlJs = JSON.stringify(sXml).replace(/<\//g, "<\\/");
        var sHandlersJs = JSON.stringify(aHandlers);
        var sSe24Js = JSON.stringify(oSe24Config || null);

        // UI5 version/theme/libs come from config/appConfig.json
        var oConfigModel = this.getOwnerComponent().getModel("config");
        var oUi5Cfg = (oConfigModel && oConfigModel.getProperty("/ui5")) || {};
        var sCdn = oUi5Cfg.cdn || "https://sapui5.hana.ondemand.com";
        var sCoreSrc =
          sCdn +
          (oUi5Cfg.version ? "/" + oUi5Cfg.version : "") +
          "/resources/sap-ui-core.js";
        var sTheme = oUi5Cfg.theme || "sap_horizon";
        var sLibs =
          oUi5Cfg.libs || "sap.m,sap.ui.layout,sap.f,sap.ui.unified,sap.ui.table,sap.uxap";
        var sCompat = oUi5Cfg.compatVersion || "edge";

        return [
          "<!DOCTYPE html>",
          "<html>",
          "<head>",
          '  <meta charset="utf-8">',
          "  <title>" + sTitle + "</title>",
          "  <style>html,body,#content{height:100%;margin:0;}</style>",
          '  <script id="sap-ui-bootstrap"',
          '    src="' + sCoreSrc + '"',
          '    data-sap-ui-theme="' + sTheme + '"',
          '    data-sap-ui-libs="' + sLibs + '"',
          '    data-sap-ui-compatVersion="' + sCompat + '">',
          "  <\/script>",
          "</head>",
          '<body class="sapUiBody" id="content">',
          "  <script>",
          "  sap.ui.getCore().attachInit(function () {",
          "    var sXml = " + sXmlJs + ";",
          "    var aHandlers = " + sHandlersJs + ";",
          "    var SE24 = " + sSe24Js + ";",
          "    var oZappModel = null;",
          "",
          "    // ---- SE24 gateway helpers (protocol mirror of Se24Service) ----",
          "    function clientParam(sSep) {",
          "      return SE24 && SE24.client ? (sSep || '&') + 'sap-client=' + encodeURIComponent(SE24.client) : '';",
          "    }",
          "    function loadDataUrl() {",
          '      return SE24.endpoint + "/data?class=" + encodeURIComponent(SE24.className) + clientParam();',
          "    }",
          "    function resolveParam(vValue) {",
          '      if (typeof vValue === "string") {',
          '        var oMatch = /^\\{(?:zapp>)?\\/(.+)\\}$/.exec(vValue);',
          '        if (oMatch && oZappModel) { return oZappModel.getProperty("/" + oMatch[1]); }',
          "      }",
          "      return vValue;",
          "    }",
          "    function applyResponseData(oData) {",
          "      if (oData && oZappModel) {",
          "        Object.keys(oData).forEach(function (sKey) {",
          '          oZappModel.setProperty("/" + sKey, oData[sKey]);',
          "        });",
          "      }",
          "    }",
          "    function callSe24Method(sName) {",
          "      var oCfg = (SE24 && SE24.eventParams && SE24.eventParams[sName]) || {};",
          "      var oParams = {};",
          "      Object.keys(oCfg).forEach(function (sKey) {",
          "        oParams[sKey] = resolveParam(oCfg[sKey]);",
          "      });",
          '        fetch(SE24.endpoint + "/call" + clientParam("?"), {',
          '          method: "POST",',
          '          credentials: "include",',
          '          headers: { "Content-Type": "application/json" },',
          "          body: JSON.stringify({ class: SE24.className, method: sName, params: oParams })",
          "        }).then(function (r) { return r.json(); }).then(function (oResult) {",
          "          applyResponseData(oResult.data);",
          '          sap.m.MessageToast.show((oResult.success ? "" : "' + this._i18n("run.failed") + '") + (oResult.message || sName));',
          "        }).catch(function (oErr) {",
          '            sap.m.MessageToast.show("' + this._i18n("run.callFailed", [""]) + '" + oErr.message);',
          "          });",
          "    }",
          "",
          "    // ---- controller methods ----",
          "    var oMethods = {};",
          "    aHandlers.forEach(function (sName) {",
          "      oMethods[sName] = function () {",
          "        var bIsSe24 = SE24 && SE24.className &&",
          "          SE24.methods.indexOf(sName) > -1;",
          "        if (bIsSe24) {",
          "          callSe24Method(sName);",
          "        } else {",
          '          sap.m.MessageToast.show(sName + "' + this._i18n("run.eventCalled", [""]) + '");',
          "        }",
          "      };",
          "    });",
          "",
          "    function startView(oData) {",
          "      if (oData) {",
          '        sap.ui.require(["sap/ui/model/json/JSONModel"], function (JSONModel) {',
          "          oZappModel = new JSONModel(oData);",
          "          createView();",
          "        });",
          "      } else {",
          "        createView();",
          "      }",
          "    }",
          "    function createView() {",
          '      sap.ui.require(["sap/ui/core/mvc/Controller"], function (Controller) {',
          '        var RunController = Controller.extend("run.PreviewController", oMethods);',
          "        var oView = sap.ui.xmlview({",
          "          viewContent: sXml,",
          "          controller: new RunController()",
          "        });",
          '        if (oZappModel) { oView.setModel(oZappModel); oView.setModel(oZappModel, "zapp"); }',
          '        oView.placeAt("content");',
          "      });",
          "    }",
          "    if (SE24 && SE24.className) {",
          "      fetch(loadDataUrl(), { credentials: 'include' }).then(function (r) { return r.json(); })",
          "        .then(function (oBase) {",
          "          startView(oBase);",
          "        }).catch(function () { startView(null); });",
          "    } else {",
          "      startView(null);",
          "    }",
          "  });",
          "  <\/script>",
          "</body>",
          "</html>",
        ].join("\n");
      },

      // Undo/Redo — TODO: 기록 기반 실제 Undo/Redo 구현 (현재는 토스트만 표시)
      onPressUndo: function () {
        MessageToast.show(this._i18n("toast.undo"));
      },

      onPressRedo: function () {
        MessageToast.show(this._i18n("toast.redo"));
      },

      // Zoom — TODO: Canvas 확대/축소 구현 (현재는 토스트만 표시)
      onZoomIn: function () {
        MessageToast.show(this._i18n("toast.zoomIn"));
      },

      onZoomOut: function () {
        MessageToast.show(this._i18n("toast.zoomOut"));
      },

      // TODO: 전체화면 전환 구현 (현재는 토스트만 표시)
      onFullScreen: function () {
        MessageToast.show(this._i18n("toast.fullscreen"));
      },
    });
  },
);
