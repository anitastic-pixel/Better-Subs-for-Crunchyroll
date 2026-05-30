/**
 * lib/protocol.js — single source of truth for the cross-world wire format.
 *
 * Three crossings need to agree on names:
 *   1. content.js (isolated world) ↔ interceptor.js (MAIN world)
 *      via DOM attributes on <html> and a token-guarded postMessage.
 *   2. content.js ↔ background.js / popup.js
 *      via chrome.runtime.sendMessage.
 *   3. content.js ↔ chrome.storage settings
 *      via the SETTINGS schema (lib/settings-schema.js owns those names).
 *
 * Settings attributes live in settings-schema.js.  Everything else lives here.
 *
 * Loaded into all four contexts (MAIN-world content_scripts, isolated-world
 * content_scripts, popup, service worker) so any rename only touches one file.
 */
(function () {
  'use strict';

  // <html> data attributes shared between content.js and interceptor.js.
  // JP_STATUS / JP_ACTIVE are written by interceptor.js, read by content.js;
  // TOGGLE_TOKEN is written by interceptor.js and echoed by content.js inside
  // its CR_SUB_TOGGLE postMessage.  It rejects accidental/unrelated messages of
  // the same type; it is not a hard security boundary (interceptor runs in the
  // MAIN world and writes the token to the page DOM, so a page script could read
  // it).  The guarded action — toggling the subtitle overlay — is non-sensitive.
  const ATTR = {
    JP_STATUS:    'data-cr-jp-status',
    JP_ACTIVE:    'data-cr-jp-active',
    TOGGLE_TOKEN: 'data-cr-toggle-token',
    // JSON-encoded {source, audio, remaster} populated by interceptor.js
    // so the popup can show what's actually playing right now (active
    // Source locale, audio dub locale, remaster state).  Updated on
    // source/audio change and on remaster completion.
    ACTIVE_INFO:  'data-cr-active-info',
  };

  // Values written into ATTR.JP_STATUS by interceptor.js.  The popup reads this
  // and renders a status pill; the badge reflects ATTR.JP_ACTIVE separately.
  const STATUS = {
    NONE:        'none',
    READY:       'ready',
    ACTIVE:      'active',
    RELOAD:      'reload',
    ERROR:       'error',
    UNAVAILABLE: 'unavailable',
  };

  // chrome.runtime.sendMessage `type` values.
  const MSG = {
    TOGGLE_JP_CC: 'TOGGLE_JP_CC',  // background → content (keyboard shortcut)
    GET_STATUS:   'GET_STATUS',    // popup       → content (status query)
    SET_BADGE:    'setBadge',      // content     → background (badge update)
  };

  // window.postMessage `type` value sent from content.js (isolated world) to
  // interceptor.js (MAIN world) when the keyboard shortcut fires.
  const POST = {
    CR_SUB_TOGGLE: 'CR_SUB_TOGGLE',
  };

  const protocol = { ATTR, STATUS, MSG, POST };

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.protocol = protocol;
})();
