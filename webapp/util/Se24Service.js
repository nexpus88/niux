sap.ui.define([], function () {
  "use strict";

  /**
   * Se24Service - protocol abstraction for the SE24 class gateway.
   *
   * Protocol contract (implemented by the ABAP SICF handler, see
   * docs/SE24_SICF_HANDLER.md):
   *   GET  {endpoint}/metadata?class=ZCL_X
   *        -> { className, attributes: [{name,type,description}],
   *             methods: [{name,description,params:[{name,type,direction}]}] }
   *   GET  {endpoint}/data?class=ZCL_X
   *        -> { ATTR: value, ... }
   *   POST {endpoint}/call   body { class, method, params }
   *        -> { success, message, data: {changed attributes} }
   *
   * The endpoint and SAP client are central settings in
   * config/appConfig.json (se24.endpoint / se24.client).
   */

  // Reject calls without a configured endpoint with a clear message so a
  // misconfigured appConfig.json surfaces instead of a confusing fetch error.
  function requireEndpoint(sEndpoint) {
    if (!sEndpoint) {
      return Promise.reject(
        new Error(
          "SE24 endpoint가 설정되지 않았습니다 (config/appConfig.json /se24/endpoint)",
        ),
      );
    }
    return Promise.resolve();
  }

  function fetchJson(sUrl) {
    // credentials: include - real SICF endpoints need the SAP logon cookie
    // (cross-origin; the handler must echo Origin + Allow-Credentials).
    return fetch(sUrl, {
      headers: { Accept: "application/json" },
      credentials: "include",
    }).then(
      function (oResponse) {
        if (!oResponse.ok) {
          throw new Error("HTTP " + oResponse.status + " (" + sUrl + ")");
        }
        return oResponse.json();
      },
    );
  }

  // SAP client parameter (e.g. sap-client=800) appended to real endpoints.
  function clientParam(sClient, sSeparator) {
    return sClient
      ? (sSeparator || "&") + "sap-client=" + encodeURIComponent(sClient)
      : "";
  }

  return {
    /**
     * Read the class metadata (attributes + methods).
     */
    getMetadata: function (sEndpoint, sClassName, sClient) {
      return requireEndpoint(sEndpoint).then(function () {
        return fetchJson(
          sEndpoint +
            "/metadata?class=" +
            encodeURIComponent(sClassName) +
            clientParam(sClient),
        );
      });
    },

    /**
     * Read the current attribute values.
     */
    getData: function (sEndpoint, sClassName, sClient) {
      return requireEndpoint(sEndpoint).then(function () {
        return fetchJson(
          sEndpoint +
            "/data?class=" +
            encodeURIComponent(sClassName) +
            clientParam(sClient),
        );
      });
    },

    /**
     * Call a public method of the class with the given importing parameters.
     * Resolves with { success, message, data }.
     */
    callMethod: function (sEndpoint, sClassName, sMethod, oParams, sClient) {
      return requireEndpoint(sEndpoint).then(function () {
        return fetch(sEndpoint + "/call" + clientParam(sClient, "?"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            class: sClassName,
            method: sMethod,
            params: oParams || {},
          }),
        }).then(function (oResponse) {
          return oResponse.json();
        });
      });
    },
  };
});
