/**
 * lib/iso-bundle.js — GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node tools/build-iso-bundle.mjs
 *
 * Isolated-world dependency bundle for content.js, concatenated from
 * lib/settings-schema.js + lib/protocol.js.  It exists only because of a Chrome
 * MV3 quirk: when the same content_script file path appears in two entries —
 * one with world:"MAIN" and one without — Chrome injects it only in the
 * MAIN-world entry, silently dropping it from the isolated world.  Giving the
 * isolated world its own physical file path sidesteps that deduplication.
 *
 * Edit the SOURCE modules (settings-schema.js / protocol.js) and re-run the
 * build; never edit this file directly.
 */

// ===== generated from lib/settings-schema.js =====
(function () {
  'use strict';

  const SCHEMA = [
    { key: 'enabled',              attr: 'data-cr-sub-fix',        default: true,       type: 'bool'   },
    { key: 'autoActivate',         attr: 'data-cr-auto-activate',  default: false,      type: 'bool'   },
    { key: 'hideOfficialSubs',     attr: 'data-cr-hide-official',  default: false,      type: 'bool'   },
    { key: 'subScale',             attr: 'data-cr-sub-scale',      default: 1,          type: 'float'  },
    { key: 'subOffset',            attr: 'data-cr-sub-offset',     default: 0,          type: 'float'  },
    { key: 'subBottomFloor',       attr: 'data-cr-sub-bottom-floor', default: 6,        type: 'int'    },
    { key: 'styleOverride',        attr: 'data-cr-style-override', default: false,      type: 'bool'   },
    { key: 'overrideFontFamily',   attr: 'data-cr-font-family',    default: '',         type: 'string' },
    { key: 'overrideTextColor',    attr: 'data-cr-override-color', default: '#ffffff',  type: 'string' },
    { key: 'overrideTextOpacity',  attr: 'data-cr-text-opacity',   default: 100,        type: 'int'    },
    { key: 'overrideOutlineColor', attr: 'data-cr-outline-color',  default: '#000000',  type: 'string' },
    { key: 'overrideBord',         attr: 'data-cr-bord-size',      default: 2,          type: 'float'  },
    { key: 'overrideShad',         attr: 'data-cr-shad-size',      default: 1,          type: 'float'  },
    { key: 'overrideShadStyle',    attr: 'data-cr-shad-style',     default: 'hard',     type: 'string' },
    { key: 'overrideShadOpacity',  attr: 'data-cr-shad-opacity',   default: 80,         type: 'int'    },
    { key: 'overrideBgBox',        attr: 'data-cr-bg-box',         default: false,      type: 'bool'   },
    { key: 'overrideBgColor',      attr: 'data-cr-bg-color',       default: '#000000',  type: 'string' },
    { key: 'overrideBgOpacity',    attr: 'data-cr-bg-opacity',     default: 70,         type: 'int'    },
    { key: 'overrideBgRadius',     attr: 'data-cr-bg-radius',      default: 4,          type: 'int'    },
    { key: 'overrideBgPaddingX',   attr: 'data-cr-bg-padding-x',   default: 10,         type: 'int'    },
    { key: 'overrideBgPaddingY',   attr: 'data-cr-bg-padding-y',   default: 2,          type: 'int'    },
    { key: 'overrideBgGlass',      attr: 'data-cr-bg-glass',       default: false,      type: 'bool'   },
    { key: 'overrideBgGlassBlur',  attr: 'data-cr-bg-glass-blur',  default: 8,          type: 'int'    },
    { key: 'overrideBgGlassSat',   attr: 'data-cr-bg-glass-sat',   default: 160,        type: 'int'    },
    { key: 'overrideBgGlassHue',   attr: 'data-cr-bg-glass-hue',   default: 0,          type: 'int'    },
  ];

  function defaults() {
    const o = {};
    for (const e of SCHEMA) o[e.key] = e.default;
    return o;
  }

  function encode(entry, value) {
    if (entry.type === 'bool') return (value === true || value === 'true') ? 'true' : 'false';
    if (value == null) value = entry.default;
    return String(value);
  }

  function decode(entry, raw) {
    switch (entry.type) {
      case 'bool':
        if (raw === 'true')  return true;
        if (raw === 'false') return false;
        return entry.default;
      case 'float': {
        const v = parseFloat(raw);
        return isFinite(v) ? v : entry.default;
      }
      case 'int': {
        const v = parseInt(raw, 10);
        return isFinite(v) ? v : entry.default;
      }
      case 'string':
      default:
        return (raw == null || raw === '') ? entry.default : raw;
    }
  }

  function writeAttrs(el, settings) {
    for (const e of SCHEMA) el.setAttribute(e.attr, encode(e, settings[e.key]));
  }

  function readAll(el) {
    const o = {};
    for (const e of SCHEMA) o[e.key] = decode(e, el.getAttribute(e.attr));
    return o;
  }

  function read(el, key) {
    const e = SCHEMA.find(s => s.key === key);
    return e ? decode(e, el.getAttribute(e.attr)) : undefined;
  }

  const ATTRS = SCHEMA.map(e => e.attr);

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.settings = { SCHEMA, ATTRS, defaults, writeAttrs, readAll, read };
})();

// ===== generated from lib/protocol.js =====
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
