/**
 * content.js — isolated world (has Chrome API access).
 *
 * Bridges chrome.storage settings → <html> data attributes readable by
 * interceptor.js (MAIN world) via the shared schema in lib/settings-schema.js.
 * Also relays messages between popup/background and interceptor.js.
 *
 * Status attributes read here (written by interceptor.js):
 *   data-cr-jp-status   "none"|"ready"|"active"|"error"|"unavailable"
 *   data-cr-jp-active   "true" | "false"
 */

(function () {
  'use strict';

  // Diagnostic: log bail reason so we can see why content.js stops in DevTools.
  if (!self.CRSubFix) {
    console.warn('[CR Sub Fix] content.js bail: self.CRSubFix is undefined');
    return;
  }
  if (!self.CRSubFix.settings) {
    console.warn('[CR Sub Fix] content.js bail: CRSubFix.settings missing. Keys:', Object.keys(self.CRSubFix));
    return;
  }
  if (!self.CRSubFix.protocol) {
    console.warn('[CR Sub Fix] content.js bail: CRSubFix.protocol missing. Keys:', Object.keys(self.CRSubFix));
    return;
  }

  const SETTINGS = self.CRSubFix.settings;
  const { ATTR, STATUS, MSG, POST } = self.CRSubFix.protocol;

  // Cache the latest settings so the restore observer can re-apply them
  // without going back to chrome.storage on every wipe.
  let latestSettings = SETTINGS.defaults();

  function applySettings(s) {
    latestSettings = s;
    SETTINGS.writeAttrs(document.documentElement, s);
  }

  chrome.storage.local.get(SETTINGS.defaults(), applySettings);

  // Keep in sync with popup changes in real time
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'local') return;
    chrome.storage.local.get(SETTINGS.defaults(), applySettings);
  });

  // Crunchyroll's React hydration recovery (errors #418 / #423 in the
  // console before each SPA nav) removes the data-* attributes we write
  // on <html>.  Without this restore observer, the interceptor reads
  // every setting as its default (autoActivate=false) after the first
  // SPA nav, which is why auto-activate only worked on initial page load.
  //
  // Watch our attrs for removal (getAttribute returns null when the attr
  // has been deleted) and re-apply the cached bundle in a microtask.  The
  // microtask flag coalesces bursts so we re-write at most once per task.
  let reapplyScheduled = false;
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (document.documentElement.getAttribute(m.attributeName) !== null) continue;
      if (reapplyScheduled) return;
      reapplyScheduled = true;
      queueMicrotask(() => {
        reapplyScheduled = false;
        SETTINGS.writeAttrs(document.documentElement, latestSettings);
      });
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: SETTINGS.ATTRS,
  });

  // ── Message relay ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Keyboard shortcut from background → forward to MAIN world
    if (msg.type === MSG.TOGGLE_JP_CC) {
      const token = document.documentElement.getAttribute(ATTR.TOGGLE_TOKEN);
      window.postMessage({ type: POST.CR_SUB_TOGGLE, token }, window.location.origin);
      return;
    }

    // Status query from popup → read DOM attributes set by interceptor.js
    if (msg.type === MSG.GET_STATUS) {
      let activeInfo = null;
      try {
        const raw = document.documentElement.getAttribute(ATTR.ACTIVE_INFO);
        if (raw) activeInfo = JSON.parse(raw);
      } catch (_) {}
      sendResponse({
        jpStatus:   document.documentElement.getAttribute(ATTR.JP_STATUS) ?? STATUS.NONE,
        jpActive:   document.documentElement.getAttribute(ATTR.JP_ACTIVE) === 'true',
        activeInfo,
      });
      return true; // keep sendResponse channel open
    }

    // Diagnostics bundle for the popup's "Report an issue".  Assembled here in
    // the isolated world, which shares the page's sessionStorage + DOM with the
    // interceptor.  The trace is redacted of signed CDN tokens before it leaves —
    // the bundle ends up in a public GitHub issue.
    if (msg.type === MSG.GET_DIAG) {
      let trace = '';
      try { trace = JSON.parse(sessionStorage.getItem('crSubFix_trace') || '[]').join('\n'); } catch (_) {}
      trace = trace.replace(/(https?:\/\/[^\s|?]+)\?[^\s|]*/gi, '$1?<redacted>');
      if (trace.length > 5000) trace = '…(older trimmed)\n' + trace.slice(-5000);  // keep most recent
      let activeInfo = null;
      try {
        const raw = document.documentElement.getAttribute(ATTR.ACTIVE_INFO);
        if (raw) activeInfo = JSON.parse(raw);
      } catch (_) {}
      let settings = {};
      try { settings = SETTINGS.readAll(document.documentElement); } catch (_) {}
      sendResponse({
        url:      location.href,
        jpStatus: document.documentElement.getAttribute(ATTR.JP_STATUS) ?? STATUS.NONE,
        jpActive: document.documentElement.getAttribute(ATTR.JP_ACTIVE) === 'true',
        activeInfo,
        settings,
        trace,
      });
      return true; // async sendResponse
    }
  });

  // ── Badge relay ──────────────────────────────────────────────────────────
  // Watch interceptor.js-controlled attribute and notify background to update badge
  new MutationObserver(() => {
    const active = document.documentElement.getAttribute(ATTR.JP_ACTIVE) === 'true';
    try { chrome.runtime.sendMessage({ type: MSG.SET_BADGE, active }).catch(() => {}); } catch (_) {}
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTR.JP_ACTIVE],
  });

  // ── Version stash for error reports ────────────────────────────────────────
  // The MAIN world (interceptor.js) builds + sends the error report but has no
  // chrome.runtime, so it can't read the manifest version.  Stash it in
  // sessionStorage — shared across worlds, survives Crunchyroll's DOM churn — for
  // it to read.
  try { sessionStorage.setItem('crSubFix_version', chrome.runtime.getManifest().version); } catch (_) {}
})();
