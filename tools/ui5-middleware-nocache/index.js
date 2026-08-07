"use strict";

/**
 * UI5 tooling middleware that disables browser caching for every resource
 * served by `ui5 serve`. The dev server normally answers with ETags only,
 * which lets browsers keep stale CSS/XML/JS files across code changes.
 */
module.exports = async function () {
  return function (req, res, next) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  };
};
