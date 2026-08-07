sap.ui.define([], function () {
  "use strict";

  /**
   * ZappsRepository - persistent storage for layout editor apps.
   *
   * The record structure mirrors the future SAP on-premise SE11 table ZAPPS,
   * so the local storage can later be swapped for an OData/RFC backend
   * without changing the callers:
   *
   *   TABLE ZAPPS
   *     APP_ID        CHAR(20)   KEY   e.g. ZAPPA_001
   *     APP_NAME      CHAR(40)
   *     APP_TYPE      CHAR(10)
   *     DESCRIPTION   CHAR(255)
   *     STATUS        CHAR(10)
   *     CREATED_AT    CHAR(10)
   *     UPDATED_AT    CHAR(10)
   *     LAYOUT_XML    STRING           generated view XML (runtime / SE24)
   *     LAYOUT_TREE   STRING           editor tree JSON (maintenance)
   *
   * Current implementation: localStorage under the key "zapps".
   */
  var STORAGE_KEY = "zapps";

  function readAll() {
    try {
      var sData = localStorage.getItem(STORAGE_KEY);
      if (sData) {
        var oData = JSON.parse(sData);
        if (oData && Array.isArray(oData.apps)) {
          return oData.apps;
        }
      }
    } catch (e) {
      /* corrupted storage - fall through to empty result */
    }
    return [];
  }

  function writeAll(aApps) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ apps: aApps, changedAt: new Date().toISOString() })
      );
    } catch (e) {
      /* quota exceeded or storage disabled */
    }
  }

  return {
    /**
     * Load all app records. Returns [] when nothing is stored yet.
     */
    loadApps: function () {
      return readAll();
    },

    /**
     * Persist the complete app list (used after seed/create/delete/copy).
     */
    persistApps: function (aApps) {
      writeAll(aApps);
    },

    /**
     * Read a single app record by appId (case-insensitive).
     */
    readApp: function (sAppId) {
      var aApps = readAll();
      for (var i = 0; i < aApps.length; i++) {
        if (aApps[i].appId === sAppId) {
          return aApps[i];
        }
      }
      return null;
    },

    /**
     * Insert or update a single app record.
     */
    saveApp: function (oApp) {
      var aApps = readAll();
      var bFound = false;
      for (var i = 0; i < aApps.length; i++) {
        if (aApps[i].appId === oApp.appId) {
          aApps[i] = oApp;
          bFound = true;
          break;
        }
      }
      if (!bFound) {
        aApps.push(oApp);
      }
      writeAll(aApps);
    },

    /**
     * Delete an app record by appId.
     */
    deleteApp: function (sAppId) {
      var aApps = readAll().filter(function (oApp) {
        return oApp.appId !== sAppId;
      });
      writeAll(aApps);
    },
  };
});
